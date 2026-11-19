import { useCallback, useEffect, useRef, useState } from 'react'
import visionWasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import visionWasmLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import handLandmarkerModelUrl from './model AI/hand_landmarker.task?url'
import { loadSignModel, predictSignSequence } from './signModelBrowser.js'

// Match the tester's take length based on the first detected hand count.
const SINGLE_HAND_CAPTURE_FRAMES = 45
const TWO_HAND_CAPTURE_FRAMES = 90
const HAND_COUNT_SETTLE_FRAMES = 18
const MAX_INFERENCE_DIMENSION = 640
const HANDS = 2
const POINTS_PER_HAND = 21
const COORDINATES_PER_POINT = 3
const FRAME_INTERVAL_MS = 33
const TEXT_CONFIDENCE_THRESHOLD = 0.6
const MIN_LANDMARK_RATIO = 0.8
const MIN_HAND_COUNT_CONSISTENCY = 0.8
const WASM_FILES = {
  wasmLoaderPath: visionWasmLoaderUrl,
  wasmBinaryPath: visionWasmBinaryUrl,
}

const signLabels = {
  antre: 'Antre',
  halo: 'Halo',
  maaf: 'Maaf',
  sakit: 'Sakit',
  terima_kasih: 'Terima kasih',
  tidak: 'Tidak',
  tolong: 'Tolong',
  ya: 'Ya',
}

function landmarksToFrame(result, previousCenters) {
  const hands = Array.from({ length: HANDS }, () => Array(POINTS_PER_HAND * COORDINATES_PER_POINT).fill(0))
  const handPresent = Array(HANDS).fill(false)
  const detectedHands = (result.landmarks || []).map((landmarks) => ({
    centerX: landmarks.reduce((total, point) => total + point.x, 0) / landmarks.length,
    landmarks,
  }))
  let assignedHands = Array(HANDS).fill(null)

  if (detectedHands.length === HANDS && previousCenters.every((center) => center !== null)) {
    const directCost = detectedHands.reduce(
      (total, hand, index) => total + Math.abs(hand.centerX - previousCenters[index]),
      0,
    )
    const swappedCost = detectedHands.reduce(
      (total, hand, index) => total + Math.abs(hand.centerX - previousCenters[HANDS - 1 - index]),
      0,
    )
    assignedHands = directCost <= swappedCost ? detectedHands : detectedHands.slice().reverse()
  } else if (detectedHands.length === 1 && previousCenters.some((center) => center !== null)) {
    const available = previousCenters
      .map((center, index) => ({ center, index }))
      .filter(({ center }) => center !== null)
    const slot = available.reduce((best, current) =>
      Math.abs(detectedHands[0].centerX - current.center) < Math.abs(detectedHands[0].centerX - best.center)
        ? current
        : best,
    ).index
    assignedHands[slot] = detectedHands[0]
  } else {
    detectedHands.sort((left, right) => left.centerX - right.centerX)
    assignedHands = detectedHands.slice(0, HANDS)
  }

  assignedHands.forEach((hand, handIndex) => {
    if (!hand) return
    previousCenters[handIndex] = hand.centerX
    const values = hand.landmarks.slice(0, POINTS_PER_HAND).flatMap(({ x, y, z }) => [x, y, z])
    if (values.length !== POINTS_PER_HAND * COORDINATES_PER_POINT) return
    hands[handIndex] = values
    handPresent[handIndex] = true
  })

  return { landmarks: hands.flat(), hand_present: handPresent }
}

function drawLandmarks(canvas, video, result, connections, previousLandmarks) {
  if (!canvas || !video.videoWidth || !video.videoHeight) return []
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
  }

  const context = canvas.getContext('2d')
  if (!context) return []
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.lineWidth = Math.max(2, canvas.width * 0.004)
  context.lineCap = 'round'
  context.lineJoin = 'round'

  const smoothedLandmarks = (result.landmarks || []).map((landmarks, handIndex) =>
    landmarks.map((point, pointIndex) => {
      const previous = previousLandmarks[handIndex]?.[pointIndex]
      if (!previous) return point
      const oldWeight = 0.4
      return {
        x: previous.x * oldWeight + point.x * (1 - oldWeight),
        y: previous.y * oldWeight + point.y * (1 - oldWeight),
        z: previous.z * oldWeight + point.z * (1 - oldWeight),
      }
    }),
  )

  smoothedLandmarks.forEach((landmarks, handIndex) => {
    const color = result.handedness?.[handIndex]?.[0]?.categoryName?.toLowerCase() === 'left' ? '#83e6cf' : '#c5baff'
    context.strokeStyle = color
    context.fillStyle = '#ffffff'
    for (const { start, end } of connections) {
      const startPoint = landmarks[start]
      const endPoint = landmarks[end]
      if (!startPoint || !endPoint) continue
      context.beginPath()
      context.moveTo(startPoint.x * canvas.width, startPoint.y * canvas.height)
      context.lineTo(endPoint.x * canvas.width, endPoint.y * canvas.height)
      context.stroke()
    }

    for (const point of landmarks) {
      context.beginPath()
      context.arc(point.x * canvas.width, point.y * canvas.height, Math.max(3, canvas.width * 0.006), 0, Math.PI * 2)
      context.fill()
      context.strokeStyle = color
      context.lineWidth = Math.max(2, canvas.width * 0.003)
      context.stroke()
    }
  })
  return smoothedLandmarks
}

export function useSignRecognition({ enabled, videoRef, canvasRef, onPrediction }) {
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [prediction, setPrediction] = useState(null)
  const [takeProgress, setTakeProgress] = useState(null)
  const predictionCallbackRef = useRef(onPrediction)
  const pendingTakeRef = useRef(null)
  const cancelTakeRef = useRef(false)

  useEffect(() => {
    predictionCallbackRef.current = onPrediction
  }, [onPrediction])

  const clearPrediction = useCallback(() => setPrediction(null), [])
  const startTake = useCallback(() => {
    pendingTakeRef.current = { frameCount: 0, handCount: 0 }
    cancelTakeRef.current = false
    setPrediction(null)
    setError('')
    setTakeProgress({ phase: 'waiting', captured: 0, total: 0, handCount: 0 })
    setStatus('waiting-for-hands')
  }, [])
  const cancelTake = useCallback(() => {
    pendingTakeRef.current = null
    cancelTakeRef.current = true
    setTakeProgress(null)
    setStatus('ready')
  }, [])

  useEffect(() => {
    if (!enabled) {
      pendingTakeRef.current = null
      cancelTakeRef.current = false
      return undefined
    }

    let cancelled = false
    let animationFrame = 0
    let landmarker
    let browserModel
    const overlayCanvas = canvasRef.current
    let activeTake = null
    let lastCapturedAt = 0
    let lastVideoTime = -1
    let lastTimestamp = 0
    let handConnections = []
    let previousHandCenters = Array(HANDS).fill(null)
    let previousDrawnLandmarks = []
    const inferenceCanvas = document.createElement('canvas')

    const classifySequence = async (sequence) => {
      try {
        const result = predictSignSequence(sequence, browserModel)
        if (cancelled) return
        const label = String(result.label || '')
        const confidence = Number(result.confidence || 0)
        const recognized = result.recognized === true && confidence >= TEXT_CONFIDENCE_THRESHOLD && signLabels[label]
        const handMismatch = result.reason === 'hand-count-mismatch' || result.reason === 'unstable-hand-count'
        if (!recognized) {
          setStatus(handMismatch ? 'hand-mismatch' : 'low-confidence')
          setError('')
          return
        }

        const candidate = {
          label,
          text: signLabels[label],
          confidence,
          expectedHands: result.expectedHands,
          detectedHands: result.detectedHands,
          shouldSpeak: true,
        }
        setPrediction(candidate)
        setStatus('detected')
        setError('')

        predictionCallbackRef.current?.(candidate)
      } catch (requestError) {
        if (cancelled) return
        setStatus('error')
        setError(requestError?.message || 'Prediksi isyarat di browser gagal. Muat ulang halaman dan coba lagi.')
      } finally {
        setTakeProgress(null)
      }
    }

    const processVideoFrame = () => {
      if (cancelled) return
      animationFrame = window.requestAnimationFrame(processVideoFrame)
      const video = videoRef.current
      if (!landmarker || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return

      const now = performance.now()
      if (video.currentTime === lastVideoTime || now - lastCapturedAt < FRAME_INTERVAL_MS) return
      lastVideoTime = video.currentTime
      lastCapturedAt = now
      lastTimestamp = Math.max(now, lastTimestamp + 1)

      try {
        const inferenceScale = Math.min(1, MAX_INFERENCE_DIMENSION / Math.max(video.videoWidth, video.videoHeight))
        const inferenceWidth = Math.max(1, Math.round(video.videoWidth * inferenceScale))
        const inferenceHeight = Math.max(1, Math.round(video.videoHeight * inferenceScale))
        if (inferenceCanvas.width !== inferenceWidth || inferenceCanvas.height !== inferenceHeight) {
          inferenceCanvas.width = inferenceWidth
          inferenceCanvas.height = inferenceHeight
        }
        const inferenceContext = inferenceCanvas.getContext('2d')
        if (!inferenceContext) throw new Error('Kanvas kamera tidak tersedia.')
        inferenceContext.save()
        inferenceContext.translate(inferenceCanvas.width, 0)
        inferenceContext.scale(-1, 1)
        inferenceContext.drawImage(video, 0, 0, inferenceCanvas.width, inferenceCanvas.height)
        inferenceContext.restore()

        const result = landmarker.detectForVideo(inferenceCanvas, lastTimestamp)
        if (cancelTakeRef.current) {
          activeTake = null
          cancelTakeRef.current = false
          previousHandCenters = Array(HANDS).fill(null)
          previousDrawnLandmarks = []
          setStatus('ready')
        }

        if (!activeTake && pendingTakeRef.current) {
          activeTake = { ...pendingTakeRef.current, frames: [], handsSeen: [], handCountProbe: [] }
          pendingTakeRef.current = null
          previousHandCenters = Array(HANDS).fill(null)
          previousDrawnLandmarks = []
        }

        previousDrawnLandmarks = drawLandmarks(
          overlayCanvas,
          video,
          result,
          handConnections,
          previousDrawnLandmarks,
        )
        const frame = landmarksToFrame(result, previousHandCenters)

        if (activeTake) {
          const handCount = frame.hand_present.filter(Boolean).length
          let handCountJustLocked = false
          if (activeTake.frameCount === 0 && handCount > 0) {
            activeTake.handCountProbe.push({ frame, handCount })
            if (activeTake.handCountProbe.length >= HAND_COUNT_SETTLE_FRAMES) {
              const twoHandDetections = activeTake.handCountProbe.filter((sample) => sample.handCount === 2).length
              activeTake.handCount = twoHandDetections >= 2 ? 2 : 1
              activeTake.frameCount = activeTake.handCount === 2
                ? TWO_HAND_CAPTURE_FRAMES
                : SINGLE_HAND_CAPTURE_FRAMES
              // Ignore early single-hand frames while the second hand is still
              // entering view; retain only warm-up frames matching the decision.
              activeTake.handCountProbe
                .filter((sample) => sample.handCount === activeTake.handCount)
                .forEach((sample) => {
                  activeTake.frames.push(sample.frame)
                  activeTake.handsSeen.push(sample.handCount)
                })
              activeTake.handCountProbe = []
              handCountJustLocked = true
            } else {
              setTakeProgress({
                phase: 'checking-hands',
                captured: activeTake.handCountProbe.length,
                total: HAND_COUNT_SETTLE_FRAMES,
                handCount: 0,
              })
              setStatus('checking-hands')
            }
          }
          // Capture only detected-hand frames; don't duplicate the last probe frame.
          if (activeTake.frameCount > 0 && handCount > 0 && !handCountJustLocked) {
            activeTake.frames.push(frame)
            activeTake.handsSeen.push(handCount)
          }

          if (activeTake.frames.length === 0) {
            if (activeTake.handCountProbe.length === 0) setStatus('waiting-for-hands')
          } else {
            const progress = {
              phase: 'recording',
              captured: activeTake.frames.length,
              total: activeTake.frameCount,
              handCount: activeTake.handCount,
            }
            if (activeTake.frames.length % 3 === 0 || activeTake.frames.length >= activeTake.frameCount) {
              setTakeProgress(progress)
              setStatus('capturing')
            }

            if (activeTake.frames.length >= activeTake.frameCount) {
              const completedTake = activeTake
              activeTake = null
              previousHandCenters = Array(HANDS).fill(null)
              previousDrawnLandmarks = []
              const validRatio = completedTake.handsSeen.filter((count) => count > 0).length
                / completedTake.handsSeen.length
              const detectedCounts = completedTake.handsSeen.filter((count) => count > 0)
              const twoHandRatio = detectedCounts.filter((count) => count === 2).length
                / detectedCounts.length
              const handCountIsStable = completedTake.handCount === 2
                ? twoHandRatio >= MIN_HAND_COUNT_CONSISTENCY
                : twoHandRatio <= 1 - MIN_HAND_COUNT_CONSISTENCY

              if (validRatio < MIN_LANDMARK_RATIO) {
                setTakeProgress(null)
                setStatus('low-confidence')
                setError(`Landmark hanya terdeteksi ${Math.round(validRatio * 100)}% dari take. Coba ulangi dengan tangan terlihat jelas.`)
              } else if (handCountIsStable) {
                setStatus('processing')
                setTakeProgress({ ...progress, phase: 'processing' })
                void classifySequence(completedTake.frames)
              } else {
                setTakeProgress(null)
                setStatus('hand-mismatch')
                setError(`Jumlah tangan berubah selama take (${Math.round(twoHandRatio * 100)}% frame dua tangan). Ulangi dengan jumlah tangan tetap.`)
              }
            }
          }
        }
      } catch {
        setStatus('error')
        setError('Kamera belum siap diproses. Pastikan kamera tetap aktif dan coba lagi.')
        return
      }

    }

    const initialize = async () => {
      setStatus('loading')
      setError('')
      try {
        const signModelPromise = loadSignModel()
        const { HandLandmarker } = await import('@mediapipe/tasks-vision')
        handConnections = HandLandmarker.HAND_CONNECTIONS
        const options = {
          runningMode: 'VIDEO',
          numHands: HANDS,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        }
        try {
          landmarker = await HandLandmarker.createFromOptions(WASM_FILES, {
            ...options,
            baseOptions: { modelAssetPath: handLandmarkerModelUrl, delegate: 'GPU' },
          })
        } catch {
          landmarker = await HandLandmarker.createFromOptions(WASM_FILES, {
            ...options,
            baseOptions: { modelAssetPath: handLandmarkerModelUrl, delegate: 'CPU' },
          })
        }
        browserModel = await signModelPromise
        if (cancelled) {
          landmarker.close()
          return
        }
        setStatus('ready')
        animationFrame = window.requestAnimationFrame(processVideoFrame)
      } catch (initializationError) {
        if (cancelled) return
        setStatus('error')
        setError(initializationError?.message || 'Model isyarat tidak dapat dimuat. Periksa file model dan dukungan WebAssembly/GPU browser.')
      }
    }

    void initialize()
    return () => {
      cancelled = true
      window.cancelAnimationFrame(animationFrame)
      landmarker?.close()
      const context = overlayCanvas?.getContext('2d')
      if (context && overlayCanvas) context.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height)
    }
  }, [canvasRef, enabled, videoRef])

  return {
    status: enabled ? status : 'idle',
    error: enabled ? error : '',
    prediction: enabled ? prediction : null,
    takeProgress: enabled ? takeProgress : null,
    startTake,
    cancelTake,
    clearPrediction,
  }
}
