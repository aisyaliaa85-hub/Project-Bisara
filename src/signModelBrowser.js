const MODEL_URL = `${import.meta.env.BASE_URL}models/sign_forest.json`
const MODEL_FORMAT = 'bisara-random-forest-v1'
const STATIC_SEQUENCE_LENGTH = 45
const CAPTURE_SEQUENCE_LENGTH = 90
const LANDMARK_VALUES_PER_FRAME = 126
const FEATURES_PER_HAND = 65
const MODEL_FEATURES_PER_FRAME = FEATURES_PER_HAND * 2
const MIN_FRAMES_WITH_HANDS = 8
const MIN_HAND_COUNT_CONSISTENCY = 0.7
const MIN_PREDICTION_CONFIDENCE = 0.6
const PALM_SCALE_FLOOR = 1e-4

let modelPromise

function hydrateModel(payload) {
  if (payload.format !== MODEL_FORMAT || payload.featureVersion !== 5 || payload.sequenceLength !== 32) {
    throw new Error('Aset model BISARA untuk browser tidak cocok dengan versi fitur.')
  }
  return {
    ...payload,
    trees: payload.trees.map((tree) => ({
      left: Int32Array.from(tree.left),
      right: Int32Array.from(tree.right),
      feature: Int32Array.from(tree.feature),
      threshold: Float32Array.from(tree.threshold),
      values: Float32Array.from(tree.values.flat()),
    })),
  }
}

export function loadSignModel() {
  if (!modelPromise) {
    modelPromise = fetch(MODEL_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Model prediksi tidak dapat dimuat (${response.status}).`)
        return response.json()
      })
      .then(hydrateModel)
      .catch((error) => {
        modelPromise = null
        throw error
      })
  }
  return modelPromise
}

function normalizeFrame(frame) {
  if (!Array.isArray(frame?.landmarks) || frame.landmarks.length !== LANDMARK_VALUES_PER_FRAME) {
    throw new Error('Format landmark tidak valid. Ulangi take gestur.')
  }
  if (!Array.isArray(frame.hand_present) || frame.hand_present.length !== 2) {
    throw new Error('Status tangan tidak valid. Ulangi take gestur.')
  }
  const values = Float32Array.from(frame.landmarks)
  if (Array.from(values).some((value) => !Number.isFinite(value))) {
    throw new Error('Landmark mengandung koordinat tidak valid. Ulangi take gestur.')
  }
  const present = frame.hand_present.map((value) => value === true)
  const active = present.flatMap((isPresent, index) => isPresent ? [index] : [])
  const output = new Float32Array(MODEL_FEATURES_PER_FRAME)
  if (active.length === 0) return output

  const wristPositions = Array.from({ length: 2 }, (_, hand) => {
    const offset = hand * 63
    return [values[offset], values[offset + 1], values[offset + 2]]
  })
  const origin = [0, 1, 2].map((axis) => {
    let sum = 0
    for (const hand of active) sum = Math.fround(sum + wristPositions[hand][axis])
    return Math.fround(sum / active.length)
  })
  const scales = active.map((hand) => {
    const wrist = hand * 63
    const palm = wrist + 9 * 3
    const dx = Math.fround(values[palm] - values[wrist])
    const dy = Math.fround(values[palm + 1] - values[wrist + 1])
    return Math.fround(Math.hypot(dx, dy))
  }).sort((left, right) => left - right)
  const medianScale = scales.length === 1
    ? scales[0]
    : Math.fround((scales[0] + scales[1]) / 2)
  const scale = Math.max(medianScale, PALM_SCALE_FLOOR)

  for (let hand = 0; hand < 2; hand += 1) {
    const handOffset = hand * FEATURES_PER_HAND
    if (present[hand]) {
      const landmarkOffset = hand * 63
      for (let index = 0; index < 63; index += 1) {
        output[handOffset + index] = Math.fround(Math.fround(values[landmarkOffset + index] - origin[index % 3]) / scale)
      }
      output[handOffset + 63] = wristPositions[hand][0]
      output[handOffset + 64] = wristPositions[hand][1]
    }
  }
  return output
}

function buildFeatures(frames, model) {
  if (!Array.isArray(frames) || ![model.sequenceLength, STATIC_SEQUENCE_LENGTH, CAPTURE_SEQUENCE_LENGTH].includes(frames.length)) {
    throw new Error('Take kamera tidak memiliki jumlah frame yang sesuai. Ulangi gestur.')
  }

  const handCounts = { 1: 0, 2: 0 }
  let framesWithHands = 0
  const normalizedFrames = frames.map((frame) => {
    const normalized = normalizeFrame(frame)
    const handCount = frame.hand_present.filter((present) => present === true).length
    if (handCount > 0) {
      framesWithHands += 1
      handCounts[handCount] += 1
    }
    return normalized
  })
  if (framesWithHands < MIN_FRAMES_WITH_HANDS) {
    throw new Error('Tangan belum terdeteksi dengan cukup jelas. Tunjukkan tangan ke kamera lalu coba lagi.')
  }

  const sequenceLength = model.sequenceLength
  const features = new Float32Array(sequenceLength * MODEL_FEATURES_PER_FRAME)
  for (let frameIndex = 0; frameIndex < sequenceLength; frameIndex += 1) {
    const position = sequenceLength === 1 ? 0 : frameIndex * (normalizedFrames.length - 1) / (sequenceLength - 1)
    const left = Math.floor(position)
    const right = Math.ceil(position)
    const weight = position - left
    for (let featureIndex = 0; featureIndex < MODEL_FEATURES_PER_FRAME; featureIndex += 1) {
      const leftValue = normalizedFrames[left][featureIndex]
      const rightValue = normalizedFrames[right][featureIndex]
      features[frameIndex * MODEL_FEATURES_PER_FRAME + featureIndex] = Math.fround(leftValue * (1 - weight) + rightValue * weight)
    }
  }

  const dominantHands = handCounts[2] > handCounts[1] ? 2 : 1
  return {
    features,
    detectedHands: dominantHands,
    consistency: handCounts[dominantHands] / framesWithHands,
  }
}

function swapHandSlots(features, sequenceLength) {
  const swapped = new Float32Array(features.length)
  for (let frame = 0; frame < sequenceLength; frame += 1) {
    const offset = frame * MODEL_FEATURES_PER_FRAME
    swapped.set(features.subarray(offset + FEATURES_PER_HAND, offset + MODEL_FEATURES_PER_FRAME), offset)
    swapped.set(features.subarray(offset, offset + FEATURES_PER_HAND), offset + FEATURES_PER_HAND)
  }
  return swapped
}

function forestProbabilities(model, features) {
  const classCount = model.classes.length
  const probabilities = new Float64Array(classCount)
  for (const tree of model.trees) {
    let node = 0
    while (tree.left[node] !== tree.right[node]) {
      const featureIndex = tree.feature[node]
      node = features[featureIndex] <= tree.threshold[node] ? tree.left[node] : tree.right[node]
    }
    const valueOffset = node * classCount
    let total = 0
    for (let classIndex = 0; classIndex < classCount; classIndex += 1) total += tree.values[valueOffset + classIndex]
    if (total > 0) {
      for (let classIndex = 0; classIndex < classCount; classIndex += 1) {
        probabilities[classIndex] += tree.values[valueOffset + classIndex] / total
      }
    }
  }
  for (let classIndex = 0; classIndex < classCount; classIndex += 1) probabilities[classIndex] /= model.trees.length
  return probabilities
}

export function predictSignSequence(frames, model) {
  if (!model) throw new Error('Model prediksi BISARA belum siap. Aktifkan kamera kembali.')
  const { features, detectedHands, consistency } = buildFeatures(frames, model)
  const candidates = []
  for (const [slotOrder, input] of [features, swapHandSlots(features, model.sequenceLength)].entries()) {
    const probabilities = forestProbabilities(model, input)
    const allowed = model.classes
      .map((label, index) => ({ label, index }))
      .filter(({ label }) => model.expectedHands[label] === detectedHands)
    const compatibleTotal = allowed.reduce((sum, item) => sum + probabilities[item.index], 0)
    if (compatibleTotal > 0) {
      for (const { label, index } of allowed) candidates.push({ confidence: probabilities[index], label, slotOrder })
    }
  }

  candidates.sort((left, right) => right.confidence - left.confidence)
  const best = candidates[0] || { confidence: 0, label: '', slotOrder: -1 }
  const handCountMatches = candidates.length > 0 && consistency >= MIN_HAND_COUNT_CONSISTENCY
  const recognized = handCountMatches && best.confidence >= MIN_PREDICTION_CONFIDENCE
  return {
    success: true,
    recognized,
    label: recognized ? best.label : '',
    confidence: best.confidence,
    expectedHands: model.expectedHands[best.label] ?? null,
    detectedHands,
    handCountConsistency: consistency,
    reason: recognized ? '' : !handCountMatches ? 'hand-count-mismatch' : 'low-confidence',
    slotOrder: best.slotOrder,
    featureVersion: model.featureVersion,
  }
}
