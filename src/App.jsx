import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Camera,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Hand,
  Headphones,
  HeartHandshake,
  History,
  Home,
  Info,
  LayoutDashboard,
  Languages,
  LoaderCircle,
  Mic,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Trash2,
  Volume2,
  Waves,
  X,
  Zap,
} from 'lucide-react'
import Login from './Login.jsx'
import { useSignRecognition } from './useSignRecognition.js'
import './App.css'

const pagePaths = {
  landing: '/',
  dashboard: '/dashboard',
  sign: '/sign',
  voice: '/voice',
  history: '/history',
  about: '/about',
  login: '/login',
  register: '/register',
}

const pathPages = Object.fromEntries(Object.entries(pagePaths).map(([key, value]) => [value, key]))

const navigation = [
  { id: 'landing', label: 'Beranda', icon: Home },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'sign', label: 'Isyarat ke Teks', icon: Hand },
  { id: 'voice', label: 'Suara ke Teks', icon: AudioLines },
  { id: 'history', label: 'Riwayat Terjemahan', icon: History },
  { id: 'about', label: 'Tentang BISARA', icon: Info },
]

const waveBars = [18, 30, 43, 26, 54, 35, 22, 47, 29, 58, 34, 20, 42, 28, 51, 24, 39, 19, 47, 31, 56, 23, 38, 17, 44, 27, 52, 33, 21, 41, 25, 50, 30, 19, 45, 28]
const TRANSCRIPTION_API_URL = import.meta.env.VITE_TRANSCRIPTION_API_URL || 'http://127.0.0.1:8000'
const TRANSCRIPTION_SEGMENT_MS = 5000

function mergeTranscript(previousText, nextText) {
  const previous = previousText.trim()
  const next = nextText.trim()
  if (!next) return previous
  if (!previous) return next

  const normalize = (word) => word.toLocaleLowerCase('id-ID').replace(/[^\p{L}\p{N}]/gu, '')
  const previousWords = previous.split(/\s+/)
  const nextWords = next.split(/\s+/)
  const previousNormalized = previousWords.map(normalize)
  const nextNormalized = nextWords.map(normalize)

  if (previousNormalized.join(' ') === nextNormalized.join(' ')) return previous

  const maxOverlap = Math.min(previousWords.length, nextWords.length, 24)
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const previousEnd = previousNormalized.slice(-overlap).join(' ')
    const nextStart = nextNormalized.slice(0, overlap).join(' ')
    if (previousEnd && previousEnd === nextStart) {
      return `${previous} ${nextWords.slice(overlap).join(' ')}`.trim()
    }
  }
  return `${previous} ${next}`
}

function speakIndonesian(text) {
  if (!text || !('speechSynthesis' in window)) return false
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'id-ID'
  window.speechSynthesis.speak(utterance)
  return true
}

function Brand({ onClick, inverse = false }) {
  return (
    <button className={`brand ${inverse ? 'brand-inverse' : ''}`} type="button" onClick={onClick} aria-label="BISARA, kembali ke beranda">
      <span className="brand-mark"><Hand size={21} strokeWidth={2.2} /></span>
      <span className="brand-name">BISARA<span>.</span></span>
    </button>
  )
}

function App() {
  const [page, setPage] = useState(() => pathPages[window.location.pathname] || 'landing')
  const [loginDestination, setLoginDestination] = useState('dashboard')
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [listening, setListening] = useState(false)
  const [startingRecording, setStartingRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [voiceStatus, setVoiceStatus] = useState('ready')
  const [voiceError, setVoiceError] = useState('')
  const [history, setHistory] = useState([])
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const recorderRef = useRef(null)
  const audioStreamRef = useRef(null)
  const audioChunksRef = useRef([])
  const transcriptRef = useRef('')
  const listeningRef = useRef(false)
  const startingRef = useRef(false)
  const recordingSessionRef = useRef(0)
  const finalizedSessionRef = useRef(0)
  const pendingTranscriptionsRef = useRef(0)
  const transcriptionQueueRef = useRef(Promise.resolve())
  const transcriptionControllersRef = useRef(new Set())
  const chunkTimerRef = useRef(null)

  const finishListeningSession = useCallback((sessionId) => {
    if (sessionId !== recordingSessionRef.current || listeningRef.current || pendingTranscriptionsRef.current > 0) return
    if (finalizedSessionRef.current === sessionId) return

    finalizedSessionRef.current = sessionId
    audioStreamRef.current?.getTracks().forEach((track) => track.stop())
    audioStreamRef.current = null
    const finalText = transcriptRef.current.trim()
    setListening(false)
    setVoiceStatus(finalText ? 'done' : 'ready')
    if (finalText) {
      setHistory((items) => [{ text: finalText, time: 'Baru saja', kind: 'suara', id: Date.now() }, ...items].slice(0, 20))
    }
  }, [])

  const stopListening = useCallback(() => {
    if (startingRef.current) {
      recordingSessionRef.current += 1
      startingRef.current = false
      setStartingRecording(false)
      setVoiceStatus(transcriptRef.current.trim() ? 'done' : 'ready')
      return
    }

    const sessionId = recordingSessionRef.current
    listeningRef.current = false
    setListening(false)
    window.clearTimeout(chunkTimerRef.current)
    chunkTimerRef.current = null
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      setVoiceStatus('processing')
      recorder.stop()
    } else if (pendingTranscriptionsRef.current > 0) {
      setVoiceStatus('processing')
    } else {
      finishListeningSession(sessionId)
    }
  }, [finishListeningSession])

  useEffect(() => {
    if (page === 'sign' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
    }
  }, [cameraOn, page])

  useEffect(() => {
    const handlePopState = () => {
      if (listeningRef.current || startingRef.current) stopListening()
      setPage(pathPages[window.location.pathname] || 'landing')
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [stopListening])

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    listeningRef.current = false
    recordingSessionRef.current += 1
    window.clearTimeout(chunkTimerRef.current)
    transcriptionControllersRef.current.forEach((controller) => controller.abort())
    transcriptionControllersRef.current.clear()
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    audioStreamRef.current?.getTracks().forEach((track) => track.stop())
  }, [])

  const navigate = (nextPage) => {
    if (nextPage !== 'voice' && (listeningRef.current || startingRef.current)) stopListening()
    setPage(nextPage)
    window.history.pushState({}, '', pagePaths[nextPage] || '/')
    setMobileMenuOpen(false)
    setNotice('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const requestLogin = (destination = 'dashboard') => {
    setLoginDestination(destination)
    navigate('login')
  }

  const handleSignPrediction = useCallback(({ text, confidence, shouldSpeak }) => {
    if (shouldSpeak) speakIndonesian(text)
    setHistory((items) => {
      if (items[0]?.kind === 'isyarat' && items[0]?.text === text) return items
      return [{ text, confidence, time: 'Baru saja', kind: 'isyarat', id: Date.now() }, ...items].slice(0, 20)
    })
  }, [])

  const startCamera = async () => {
    setCameraError('')
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Browser ini belum mendukung akses kamera.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', frameRate: { ideal: 30 } },
        audio: false,
      })
      streamRef.current = stream
      setCameraOn(true)
    } catch (error) {
      setCameraError(error.name === 'NotAllowedError'
        ? 'Izin kamera belum diberikan. Periksa pengaturan browser Anda.'
        : 'Kamera tidak dapat diakses. Pastikan kamera terhubung dan coba lagi.')
    }
  }

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCameraOn(false)
  }

  const transcribeAudioSegment = (audioBlob, sessionId) => {
    if (!audioBlob.size || sessionId !== recordingSessionRef.current) return
    pendingTranscriptionsRef.current += 1
    setVoiceStatus('processing')

    const transcription = transcriptionQueueRef.current.catch(() => {}).then(async () => {
      if (sessionId !== recordingSessionRef.current) return
      const controller = new AbortController()
      transcriptionControllersRef.current.add(controller)
      const formData = new FormData()
      const extension = audioBlob.type.includes('ogg') ? 'ogg' : audioBlob.type.includes('mp4') ? 'm4a' : 'webm'
      formData.append('file', audioBlob, `bisara-${Date.now()}.${extension}`)

      try {
        const response = await fetch(`${TRANSCRIPTION_API_URL}/transcribe`, {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok || !result.success) {
          throw new Error(result.detail || 'Audio gagal ditranskripsi. Coba berbicara lebih jelas.')
        }
        if (sessionId !== recordingSessionRef.current) return

        const newText = (result.text || '').trim()
        if (!newText) return
        const mergedText = mergeTranscript(transcriptRef.current, newText)
        transcriptRef.current = mergedText
        setTranscript(mergedText)
        setVoiceError('')
      } catch (error) {
        if (error.name === 'AbortError' || sessionId !== recordingSessionRef.current) return
        setVoiceError(error instanceof TypeError
          ? 'Backend lokal tidak dapat dihubungi. Pastikan FastAPI berjalan di http://127.0.0.1:8000.'
          : error.message || 'Terjadi kesalahan saat memproses segmen audio.')
      } finally {
        transcriptionControllersRef.current.delete(controller)
      }
    }).finally(() => {
      pendingTranscriptionsRef.current = Math.max(0, pendingTranscriptionsRef.current - 1)
      if (sessionId !== recordingSessionRef.current) return
      if (pendingTranscriptionsRef.current > 0) {
        setVoiceStatus('processing')
      } else if (listeningRef.current) {
        setVoiceStatus('listening')
      } else {
        finishListeningSession(sessionId)
      }
    })

    transcriptionQueueRef.current = transcription
  }

  const startRecordingSegment = (audioStream, sessionId) => {
    if (sessionId !== recordingSessionRef.current || !listeningRef.current) return
    const supportedTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
    const mimeType = supportedTypes.find((type) => MediaRecorder.isTypeSupported(type))
    const recorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined)
    audioChunksRef.current = []
    recorderRef.current = recorder
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunksRef.current.push(event.data)
    }
    recorder.onerror = () => {
      if (sessionId !== recordingSessionRef.current) return
      listeningRef.current = false
      setListening(false)
      setVoiceStatus('error')
      setVoiceError('Perekaman audio terganggu. Periksa mikrofon dan coba mulai lagi.')
      window.clearTimeout(chunkTimerRef.current)
      chunkTimerRef.current = null
      audioChunksRef.current = []
      recorderRef.current = null
      audioStream.getTracks().forEach((track) => track.stop())
      audioStreamRef.current = null
    }
    recorder.onstop = () => {
      if (recorderRef.current === recorder) recorderRef.current = null
      const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
      audioChunksRef.current = []
      if (sessionId !== recordingSessionRef.current) return

      if (listeningRef.current) startRecordingSegment(audioStream, sessionId)
      if (audioBlob.size > 0) {
        transcribeAudioSegment(audioBlob, sessionId)
      } else if (!listeningRef.current && pendingTranscriptionsRef.current === 0) {
        finishListeningSession(sessionId)
      }
    }

    try {
      recorder.start()
      setListening(true)
      setVoiceStatus(pendingTranscriptionsRef.current ? 'processing' : 'listening')
      chunkTimerRef.current = window.setTimeout(() => {
        chunkTimerRef.current = null
        if (recorderRef.current === recorder && recorder.state === 'recording') recorder.stop()
      }, TRANSCRIPTION_SEGMENT_MS)
    } catch (error) {
      listeningRef.current = false
      setListening(false)
      setVoiceStatus('error')
      setVoiceError(error.message || 'Perekaman audio tidak dapat dimulai.')
      audioStream.getTracks().forEach((track) => track.stop())
      audioStreamRef.current = null
    }
  }

  const startListening = async () => {
    if (listeningRef.current || startingRef.current || voiceStatus === 'processing') return

    startingRef.current = true
    const sessionId = recordingSessionRef.current + 1
    recordingSessionRef.current = sessionId
    finalizedSessionRef.current = 0
    pendingTranscriptionsRef.current = 0
    transcriptionQueueRef.current = Promise.resolve()
    setStartingRecording(true)
    setVoiceError('')
    setNotice('')
    try {
      const healthResponse = await fetch(`${TRANSCRIPTION_API_URL}/health`)
      const health = await healthResponse.json().catch(() => ({}))
      if (!healthResponse.ok || !health.model_loaded) {
        throw new Error(health.detail || 'Backend lokal belum siap. Jalankan backend BISARA di localhost:8000.')
      }
      if (sessionId !== recordingSessionRef.current) return
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Akses mikrofon tidak tersedia. Buka BISARA melalui localhost atau HTTPS dan periksa dukungan browser.')
      }
      if (typeof MediaRecorder === 'undefined') {
        throw new Error('Browser ini belum mendukung perekaman audio. Gunakan Chrome, Edge, atau Firefox terbaru.')
      }

      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      if (sessionId !== recordingSessionRef.current) {
        audioStream.getTracks().forEach((track) => track.stop())
        return
      }
      audioStreamRef.current = audioStream
      listeningRef.current = true
      startRecordingSegment(audioStream, sessionId)
    } catch (error) {
      if (sessionId !== recordingSessionRef.current) return
      listeningRef.current = false
      setListening(false)
      setVoiceStatus('error')
      setVoiceError(error.name === 'NotAllowedError'
        ? 'Izin mikrofon ditolak. Izinkan akses mikrofon pada pengaturan situs di browser.'
        : error.name === 'NotFoundError'
          ? 'Mikrofon tidak ditemukan. Sambungkan atau pilih perangkat mikrofon yang tersedia.'
          : error instanceof TypeError
            ? 'Backend lokal belum aktif. Jalankan FastAPI pada http://127.0.0.1:8000 terlebih dahulu.'
            : error.message || 'Mikrofon tidak dapat dimulai. Periksa izin dan perangkat audio.')
      audioStreamRef.current?.getTracks().forEach((track) => track.stop())
      audioStreamRef.current = null
    } finally {
      if (sessionId === recordingSessionRef.current) {
        startingRef.current = false
        setStartingRecording(false)
      }
    }
  }

  const clearTranscript = () => {
    recordingSessionRef.current += 1
    startingRef.current = false
    setStartingRecording(false)
    window.clearTimeout(chunkTimerRef.current)
    chunkTimerRef.current = null
    transcriptionControllersRef.current.forEach((controller) => controller.abort())
    transcriptionControllersRef.current.clear()
    pendingTranscriptionsRef.current = 0
    listeningRef.current = false
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    audioStreamRef.current?.getTracks().forEach((track) => track.stop())
    audioStreamRef.current = null
    recorderRef.current = null
    audioChunksRef.current = []
    setListening(false)
    transcriptRef.current = ''
    setTranscript('')
    setVoiceStatus('ready')
    setVoiceError('')
    setNotice('')
  }

  const copyText = async (text) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setNotice('Teks berhasil disalin.')
    } catch {
      setNotice('Tidak dapat menyalin teks. Periksa izin clipboard browser.')
    }
  }

  const speakText = (text) => {
    if (!speakIndonesian(text)) {
      setNotice('Text-to-Speech tidak tersedia di browser ini.')
    }
  }

  if (page === 'landing') {
    return <LandingPage onNavigate={navigate} onRequestLogin={requestLogin} mobileMenuOpen={mobileMenuOpen} setMobileMenuOpen={setMobileMenuOpen} />
  }

  if (page === 'login' || page === 'register') {
    return <Login onNavigate={navigate} redirectTo={loginDestination} />
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand-wrap"><Brand onClick={() => navigate('landing')} /><span className="brand-caption">AI ACCESSIBILITY</span></div>
        <div className="sidebar-section-label">MENU UTAMA</div>
        <nav className="side-nav" aria-label="Navigasi utama">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              className={`side-link ${page === id ? 'active' : ''}`}
              key={id}
              onClick={() => navigate(id)}
              type="button"
              aria-current={page === id ? 'page' : undefined}
            >
              <Icon size={18} strokeWidth={1.85} />
              <span>{label}</span>
              {page === id && <ChevronRight className="nav-chevron" size={16} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-promo">
            <span className="promo-icon"><HeartHandshake size={18} /></span>
            <strong>Komunikasi milik semua.</strong>
            <p>Bersama membangun ruang yang lebih inklusif.</p>
            <button type="button" onClick={() => navigate('about')}>Kenali BISARA <ArrowUpRight size={14} /></button>
          </div>
          <div className="sidebar-profile">
            <span className="profile-avatar">B</span>
            <span className="profile-copy"><strong>Teman BISARA</strong><small>Ruang personal</small></span>
            <span className="profile-dot" aria-label="Status aktif" />
          </div>
        </div>
      </aside>

      <div className="mobile-topbar">
        <Brand onClick={() => navigate('dashboard')} />
        <button className="icon-button mobile-menu-button" type="button" aria-label="Buka navigasi" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
          {mobileMenuOpen ? <X size={20} /> : <span className="menu-lines" />}
        </button>
        {mobileMenuOpen && (
          <nav className="mobile-nav" aria-label="Navigasi utama">
            {navigation.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" onClick={() => navigate(id)} className={page === id ? 'active' : ''}>
                <Icon size={18} /> {label}
              </button>
            ))}
          </nav>
        )}
      </div>

      <main className="workspace">
        <header className="workspace-top">
          <div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{navigation.find((item) => item.id === page)?.label}</strong></div>
          <div className="header-actions">
            <span className="workspace-live"><span /> RUANG AMAN & PRIVAT</span>
            <button className="help-button" type="button" onClick={() => navigate('about')}><CircleHelp size={17} /> <span>Bantuan</span></button>
            <span className="header-avatar">B</span>
          </div>
        </header>

        <div className="page-transition" key={page}>
          {page === 'dashboard' && <Dashboard onNavigate={navigate} history={history} />}
          {page === 'sign' && (
            <SignWorkspace
              cameraOn={cameraOn}
              cameraError={cameraError}
              videoRef={videoRef}
              startCamera={startCamera}
              stopCamera={stopCamera}
              history={history}
              notice={notice}
              setNotice={setNotice}
              onSpeak={speakText}
              onCopy={copyText}
              onPrediction={handleSignPrediction}
            />
          )}
          {page === 'voice' && (
            <VoiceWorkspace
              listening={listening}
              startingRecording={startingRecording}
              transcript={transcript}
              voiceStatus={voiceStatus}
              voiceError={voiceError}
              clearTranscript={clearTranscript}
              startListening={startListening}
              stopListening={stopListening}
              speakText={speakText}
              copyText={copyText}
              notice={notice}
            />
          )}
          {page === 'history' && <HistoryPage history={history} onNavigate={navigate} onClear={() => setHistory([])} onCopy={copyText} notice={notice} />}
          {page === 'about' && <AboutPage onNavigate={navigate} />}
        </div>
      </main>
    </div>
  )
}

function LandingPage({ onNavigate, onRequestLogin, mobileMenuOpen, setMobileMenuOpen }) {
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <Brand onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} />
          <nav className={`landing-links ${mobileMenuOpen ? 'open' : ''}`} aria-label="Navigasi halaman">
            <a href="#fitur" onClick={() => setMobileMenuOpen(false)}>Fitur</a>
            <a href="#cara-kerja" onClick={() => setMobileMenuOpen(false)}>Cara kerja</a>
            <a href="#tentang" onClick={() => setMobileMenuOpen(false)}>Tentang kami</a>
          </nav>
          <button className="button button-dark landing-signin" type="button" onClick={() => onRequestLogin('dashboard')}>Masuk ke aplikasi <ArrowRight size={16} /></button>
          <button className="icon-button landing-menu-button" type="button" aria-label="Buka navigasi" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            {mobileMenuOpen ? <X size={20} /> : <span className="menu-lines" />}
          </button>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-glow landing-glow-one" /><div className="landing-glow landing-glow-two" />
          <div className="landing-container hero-layout">
            <div className="hero-copy">
              <span className="hero-badge"><span className="badge-spark"><Sparkles size={13} /></span> BAHASA YANG MENGHUBUNGKAN KITA</span>
              <h1>Komunikasi<br />Tanpa Batas,<br /><span>Untuk Semua.</span></h1>
              <p className="hero-description">BISARA menyatukan bahasa isyarat, suara, dan teks lewat fitur aksesibilitas digital—agar setiap percakapan terasa dekat dan dipahami.</p>
              <div className="hero-actions">
                <button className="button button-hero" type="button" onClick={() => onRequestLogin('dashboard')}>Mulai Sekarang <ArrowRight size={17} /></button>
                <a className="hero-secondary-link" href="#cara-kerja"><span><ArrowDown size={16} /></span> Lihat cara kerja</a>
              </div>
              <div className="hero-trust"><span className="trust-avatars"><i /><i /><i /></span><span>Dibuat untuk percakapan yang lebih inklusif</span><ShieldCheck size={15} /></div>
            </div>
            <div className="hero-visual" aria-label="Ilustrasi komunikasi bahasa isyarat">
              <div className="hero-visual-glow" />
              <div className="visual-orbit orbit-large" /><div className="visual-orbit orbit-small" />
              <div className="visual-corner corner-tl" /><div className="visual-corner corner-br" />
              <div className="visual-interface">
                <div className="visual-interface-top"><span><i /> BISARA VISION</span><span>VISUAL PREVIEW</span></div>
                <div className="visual-hand-stage">
                  <div className="visual-halo halo-one" /><div className="visual-halo halo-two" />
                  <div className="visual-hand"><Hand size={126} strokeWidth={1.1} /></div>
                  <span className="visual-spark spark-a"><Sparkles size={17} /></span>
                  <span className="visual-spark spark-b"><Waves size={23} /></span>
                  <span className="visual-scan-line" />
                </div>
                <div className="visual-translation"><span className="translation-glyph"><MessageSquareText size={17} /></span><span><small>CONTOH HASIL TERJEMAHAN</small><strong>“Senang bertemu denganmu.”</strong></span><span className="translation-ok"><Check size={15} /></span></div>
              </div>
              <div className="visual-float visual-float-left"><span className="float-icon-purple"><AudioLines size={17} /></span><span><small>LIVE TRANSKRIPSI</small><strong>Bahasa Indonesia</strong></span></div>
              <div className="visual-float visual-float-right"><span className="float-status"><i /><i /><i /><i /><i /></span><span>Untuk komunikasi inklusif</span></div>
              <div className="visual-note"><ShieldCheck size={14} /> Privasi selalu diutamakan</div>
            </div>
          </div>
          <div className="hero-bottom">
            <span>DIRANCANG UNTUK AKSESIBILITAS</span><i /><span>BAHASA ISYARAT</span><i /><span>SUARA & TEKS</span><i /><span>UNTUK SEMUA</span>
          </div>
        </section>

        <section className="landing-intro" id="tentang">
          <div className="landing-container intro-layout">
            <div className="intro-label"><span>01</span> MISI KAMI</div>
            <div><h2>Teknologi terbaik adalah teknologi yang mendekatkan manusia.</h2><p>BISARA membuka lebih banyak cara untuk saling memahami. Dibangun dengan fokus pada aksesibilitas, privasi, dan pengalaman yang ramah untuk semua.</p></div>
            <div className="intro-stat"><strong>01</strong><span>ruang komunikasi<br />yang inklusif</span></div>
          </div>
        </section>

        <section className="feature-section" id="fitur">
          <div className="landing-container">
            <div className="section-heading"><span className="section-kicker">KOMUNIKASI DALAM BERBAGAI BENTUK</span><h2>Satu ruang. Lebih banyak cara terhubung.</h2><p>Pilih pengalaman yang paling nyaman untukmu, lalu mulai percakapan.</p></div>
            <div className="feature-grid">
              <button className="feature-card feature-sign" type="button" onClick={() => onRequestLogin('sign')}>
                <span className="feature-card-index">01 / VISUAL INTELLIGENCE</span><span className="feature-icon"><Hand size={24} /></span><span className="feature-arrow"><ArrowUpRight size={18} /></span>
                <strong>Isyarat ke teks</strong><span className="feature-text">Terjemahkan gerakan tangan menjadi teks dan suara. Setiap ekspresi punya ruang untuk dimengerti.</span>
                <span className="feature-bottom">Mulai berisyarat <ArrowRight size={15} /></span><span className="feature-decoration"><Hand size={150} strokeWidth={.9} /></span>
              </button>
              <button className="feature-card feature-voice" type="button" onClick={() => onRequestLogin('voice')}>
                <span className="feature-card-index">02 / LIVE TRANSCRIPTION</span><span className="feature-icon"><Mic size={24} /></span><span className="feature-arrow"><ArrowUpRight size={18} /></span>
                <strong>Suara ke teks</strong><span className="feature-text">Ubah percakapan menjadi tulisan secara langsung agar semua orang bisa mengikuti.</span>
                <span className="feature-bottom">Mulai mendengarkan <ArrowRight size={15} /></span><span className="feature-decoration voice-decoration"><AudioLines size={150} strokeWidth={.9} /></span>
              </button>
            </div>
          </div>
        </section>

        <section className="steps-section" id="cara-kerja">
          <div className="landing-container steps-layout">
            <div className="steps-heading"><span className="section-kicker">TIGA LANGKAH SEDERHANA</span><h2>Mulai dari cara yang terasa paling alami.</h2><p>Tanpa pengaturan yang rumit. BISARA siap menemani percakapan sehari-hari.</p><button className="text-link" type="button" onClick={() => onRequestLogin('dashboard')}>Jelajahi dashboard <ArrowRight size={16} /></button></div>
            <div className="steps-list">
              <div className="step-item"><span className="step-number">01</span><span className="step-icon"><Languages size={19} /></span><span><strong>Pilih cara berkomunikasi</strong><small>Gunakan kamera untuk isyarat atau mikrofon untuk suara.</small></span><ChevronRight size={17} /></div>
              <div className="step-item"><span className="step-number">02</span><span className="step-icon"><Zap size={19} /></span><span><strong>Mulai percakapan</strong><small>Berisyarat atau berbicara dengan nyaman seperti biasa.</small></span><ChevronRight size={17} /></div>
              <div className="step-item"><span className="step-number">03</span><span className="step-icon"><HeartHandshake size={19} /></span><span><strong>Saling memahami</strong><small>Lihat hasilnya dan lanjutkan percakapan tanpa batas.</small></span><ChevronRight size={17} /></div>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-container footer-inner"><div><Brand onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} /><p>Komunikasi tanpa batas, untuk semua.</p></div><div className="footer-links"><a href="#fitur">Fitur</a><a href="#cara-kerja">Cara kerja</a><button type="button" onClick={() => onNavigate('about')}>Tentang BISARA</button></div><span className="footer-copyright">© {new Date().getFullYear()} BISARA</span></div>
      </footer>
    </div>
  )
}

function Dashboard({ onNavigate, history }) {
  return (
    <div className="page-content dashboard-page">
      <section className="welcome-panel">
        <div className="welcome-copy">
          <span className="eyebrow"><span className="eyebrow-dot" /> RUANG PERSONALMU</span>
          <h1>Selamat Datang<br />di <span>BISARA.</span></h1>
          <p>Teknologi yang membantu setiap percakapan terasa lebih dekat, jelas, dan dipahami.</p>
          <button className="button button-hero welcome-cta" type="button" onClick={() => onNavigate('sign')}>Mulai percakapan <ArrowRight size={16} /></button>
        </div>
        <div className="welcome-visual" aria-hidden="true">
          <div className="welcome-orbit welcome-orbit-one" /><div className="welcome-orbit welcome-orbit-two" />
          <div className="welcome-hand"><Hand size={105} strokeWidth={1.1} /></div>
          <span className="welcome-float welcome-float-one"><Sparkles size={16} /></span>
          <span className="welcome-float welcome-float-two"><MessageSquareText size={17} /></span>
          <div className="welcome-message"><span className="message-pulse" /><span><small>RUANG TERBUKA</small><strong>Mulai ceritamu hari ini.</strong></span></div>
        </div>
        <div className="welcome-orb-decoration" />
      </section>

      <div className="dashboard-section-heading"><div><span className="section-kicker">PILIH PENGALAMAN</span><h2>Bagaimana kamu ingin berkomunikasi?</h2></div><span><ShieldCheck size={15} /> Dirancang inklusif</span></div>
      <div className="dashboard-cards">
        <button className="dashboard-card sign-card" type="button" onClick={() => onNavigate('sign')}>
          <div className="dashboard-card-top"><span className="dash-icon"><Hand size={23} /></span><span className="card-index">01</span></div>
          <span className="dash-label">VISUAL · BAHASA ISYARAT</span><strong>Isyarat ke Teks</strong><p>Terjemahkan gerakan tangan menjadi teks dan suara. Bahasa tubuhmu, kini lebih mudah dipahami.</p>
          <span className="dash-card-action">Buka penerjemah <ArrowRight size={16} /></span><span className="card-decoration"><Hand size={130} strokeWidth={.9} /></span>
        </button>
        <button className="dashboard-card voice-card" type="button" onClick={() => onNavigate('voice')}>
          <div className="dashboard-card-top"><span className="dash-icon"><Mic size={23} /></span><span className="card-index">02</span></div>
          <span className="dash-label">AUDIO · TRANSKRIPSI LANGSUNG</span><strong>Suara ke Teks</strong><p>Ubah percakapan menjadi tulisan secara langsung agar setiap orang bisa ikut terhubung.</p>
          <span className="dash-card-action">Mulai transkripsi <ArrowRight size={16} /></span><span className="card-decoration voice-decoration"><AudioLines size={132} strokeWidth={.9} /></span>
        </button>
      </div>
      <section className="dashboard-bottom">
        <div className="dashboard-activity">
          <div className="activity-heading"><div><span className="section-kicker">AKTIVITAS TERBARU</span><h2>Jejak percakapan</h2></div><button type="button" onClick={() => onNavigate('history')}>Lihat semua <ArrowRight size={14} /></button></div>
          {history.length ? history.slice(0, 3).map((item) => <HistoryRow key={item.id} item={item} />) : <div className="activity-empty"><span><History size={19} /></span><p>Belum ada aktivitas. Riwayat percakapanmu akan muncul di sini.</p></div>}
        </div>
        <div className="dashboard-aside-note"><span className="aside-note-icon"><ShieldCheck size={19} /></span><span className="section-kicker">RUANG YANG AMAN</span><strong>Privasi percakapanmu tetap terjaga.</strong><p>Gunakan izin kamera dan mikrofon hanya saat kamu siap. Kendali selalu ada di tanganmu.</p><button type="button" onClick={() => onNavigate('about')}>Tentang privasi <ArrowUpRight size={14} /></button></div>
      </section>
    </div>
  )
}

function SignWorkspace({ cameraOn, cameraError, videoRef, startCamera, stopCamera, history, notice, setNotice, onSpeak, onCopy, onPrediction }) {
  const signHistory = history.filter((item) => item.kind === 'isyarat')
  const canvasRef = useRef(null)
  const { status, error, prediction, takeProgress, startTake, cancelTake, clearPrediction } = useSignRecognition({ enabled: cameraOn, videoRef, canvasRef, onPrediction })
  const taking = takeProgress?.phase === 'waiting' || takeProgress?.phase === 'recording'
  const recognitionStatus = status === 'loading' ? 'MEMUAT MODEL' : status === 'waiting-for-hands' ? 'MENUNGGU TANGAN' : status === 'capturing' ? 'MEREKAM TAKE' : status === 'processing' ? 'MENGENALI TAKE' : status === 'detected' ? 'ISYARAT TERDETEKSI' : status === 'hand-mismatch' ? 'JUMLAH TANGAN BERBEDA' : status === 'low-confidence' ? 'ISYARAT BELUM JELAS' : status === 'ready' ? 'SIAP TAKE' : status === 'error' ? 'PERLU PERHATIAN' : 'MENUNGGU'

  return (
    <div className="page-content translator-page">
      <div className="page-heading"><div><span className="section-kicker">VISUAL AI TRANSLATOR</span><h1>Isyarat ke Teks</h1><p>Berisyarat dengan bebas. BISARA membantu membuka ruang untuk dipahami.</p></div><span className="privacy-chip"><ShieldCheck size={15} /> PRIVAT & AMAN</span></div>
      <div className="translator-layout">
        <section className="camera-column">
          <div className="camera-panel">
            <div className="camera-panel-top"><span className="camera-title"><span className={`status-dot ${cameraOn ? 'on' : ''}`} /> {cameraOn ? 'Kamera aktif' : 'Ruang kamera'}</span><span className="camera-top-meta"><span>BAHASA ISYARAT</span><CircleHelp size={16} /></span></div>
            <div className={`camera-view ${cameraOn ? 'camera-live' : ''}`}>
              {cameraOn && <><video ref={videoRef} autoPlay playsInline muted aria-label="Pratinjau kamera" /><canvas ref={canvasRef} className="landmark-overlay" aria-hidden="true" />{status === 'waiting-for-hands' && <span className="camera-hand-hint">Tunjukkan tangan untuk mulai take</span>}</>}
              {!cameraOn && <div className="camera-empty"><span className="camera-empty-icon"><Camera size={28} /></span><span className="camera-grid grid-one" /><span className="camera-grid grid-two" /><strong>Kamera siap saat kamu siap.</strong><p>Posisikan diri di area terang agar gerakan tangan terlihat jelas.</p><span className="camera-tip"><Check size={14} /> Wajah dan tangan dalam bingkai</span></div>}
              {cameraOn && <><span className="camera-live-tag"><i /> KAMERA AKTIF</span><span className="camera-detection"><span className="detection-pulse" /> {recognitionStatus}</span><span className="camera-frame frame-one" /><span className="camera-frame frame-two" /></>}
              {(cameraError || error) && <p className="camera-error" role="alert">{cameraError || error}</p>}
            </div>
            <div className="take-controls">
              <div className="take-guidance"><strong>Durasi take otomatis</strong><small>Jumlah tangan saat mulai menentukan panjang take.</small></div>
              <div className="take-action">
                <button className={`button ${taking ? 'button-stop' : 'button-primary'}`} type="button" onClick={taking ? cancelTake : startTake} disabled={!cameraOn || status === 'loading' || takeProgress?.phase === 'processing'}>
                  {taking ? <><X size={15} /> Batalkan take</> : takeProgress?.phase === 'processing' ? <><LoaderCircle className="voice-loading-icon" size={15} /> Mengenali...</> : <><Camera size={15} /> Ambil take</>}
                </button>
                <small>{takeProgress?.phase === 'waiting' ? 'Menunggu tangan pertama untuk memilih 45/90 frame' : takeProgress?.phase === 'recording' ? `Merekam ${takeProgress.handCount} tangan - ${takeProgress.captured}/${takeProgress.total} frame` : takeProgress?.phase === 'processing' ? 'Take selesai - model sedang mengenali' : 'Tekan Ambil take untuk mulai'}</small>
              </div>
              <small className="take-mapping">1 tangan (45): Halo, Maaf, Sakit, Ya, Tidak. 2 tangan (90): Terima kasih, Tolong, Antre.</small>
            </div>
            <div className="camera-controls">
              <div className="camera-device"><span className={`device-indicator ${cameraOn ? 'active' : ''}`} /><span><strong>Kamera perangkat</strong><small>{cameraOn ? 'Aktif · hanya saat digunakan' : 'Belum terhubung'}</small></span></div>
              <button className={`button ${cameraOn ? 'button-stop' : 'button-primary'}`} type="button" onClick={cameraOn ? () => { cancelTake(); stopCamera() } : startCamera}>{cameraOn ? <><span className="stop-square" /> Matikan kamera</> : <><Camera size={16} /> Aktifkan kamera</>}</button>
            </div>
          </div>
          <div className="camera-helper"><span className="helper-icon"><ShieldCheck size={16} /></span><p><strong>Kendali tetap di tanganmu.</strong> BISARA hanya menggunakan kamera setelah kamu mengizinkannya.</p></div>
        </section>
        <section className="translation-column">
          <div className="translation-card">
            <div className="translation-card-heading"><span className="translation-icon"><Languages size={17} /></span><span><strong>Hasil terjemahan</strong><small>{prediction ? `Keyakinan ${Math.floor(prediction.confidence * 100)}% · ${prediction.expectedHands === 2 ? 'dua tangan' : 'satu tangan'}` : cameraOn ? import.meta.env.DEV ? 'Landmark lokal · prediksi BISARA lokal' : 'Landmark lokal · prediksi Firebase' : 'Bahasa Indonesia · teks & suara'}</small></span><span className={`live-status ${cameraOn ? 'live' : ''}`}><i /> {cameraOn ? recognitionStatus : 'MENUNGGU'}</span></div>
            {prediction ? <div className="sign-result"><span className="translation-empty-mark"><Hand size={23} /></span><strong>{prediction.text}</strong><small>{Math.floor(prediction.confidence * 100)}% keyakinan model · {prediction.shouldSpeak ? 'teks dan suara' : 'teks'}</small></div> : <div className="translation-empty"><span className="translation-empty-orbit"><span className="translation-empty-mark"><MessageSquareText size={24} /></span><i /><i /></span><strong>{cameraOn ? status === 'loading' ? 'Memuat model deteksi...' : status === 'waiting-for-hands' ? 'Menunggu tangan terdeteksi.' : status === 'capturing' ? 'Gestur sedang direkam...' : status === 'processing' ? 'Menganalisis gerakan tangan...' : status === 'stabilizing' ? 'Memastikan isyarat...' : status === 'hand-mismatch' ? 'Coba ulangi dengan jumlah tangan yang tepat.' : 'Tunjukkan isyarat di depan kamera.' : 'Terjemahanmu akan tampil di sini.'}</strong><p>{cameraOn ? 'Kamera diproses pada perangkat; urutan landmark dikirim untuk prediksi model Bahasa Isyarat BISARA.' : 'Aktifkan kamera untuk memulai deteksi isyarat Bahasa Indonesia.'}</p></div>}
            <div className="translation-actions"><button className="button button-secondary" type="button" onClick={() => prediction?.shouldSpeak && onSpeak(prediction.text)} disabled={!prediction?.shouldSpeak} title={prediction && !prediction.shouldSpeak ? 'Ucapan tersedia mulai confidence 80%.' : undefined}><Volume2 size={16} /> Dengarkan</button><button className="button button-secondary" type="button" onClick={() => prediction && onCopy(prediction.text)} disabled={!prediction}><Copy size={15} /> Salin</button><button className="button button-quiet" type="button" onClick={() => { clearPrediction(); setNotice('Hasil isyarat dibersihkan.') }} disabled={!prediction}><Trash2 size={15} /> Hapus</button></div>
          </div>
          {error && <p className="action-notice" role="alert">{error}</p>}
          <div className="recent-mini"><div className="recent-mini-heading"><span><History size={15} /> Riwayat isyarat</span><button type="button" onClick={() => setNotice(signHistory.length ? 'Riwayat tersedia di halaman Riwayat Terjemahan.' : 'Belum ada hasil terjemahan.')}>Lihat semua <ArrowRight size={13} /></button></div>
            {signHistory.length ? signHistory.slice(0, 3).map((item) => <HistoryRow key={item.id} item={item} compact />) : <p className="recent-empty">Hasil terjemahan akan tersimpan di sini.</p>}
          </div>
          {notice && <p className="action-notice" role="status">{notice}</p>}
        </section>
      </div>
      <div className="workspace-footnote"><span><ShieldCheck size={14} /> Video tidak diunggah; kamera diproses di perangkat.</span><span>{import.meta.env.DEV ? 'Prediksi lokal · Model BISARA' : 'MediaPipe lokal · Firebase'}</span></div>
    </div>
  )
}

function VoiceWorkspace({ listening, startingRecording, transcript, voiceStatus, voiceError, clearTranscript, startListening, stopListening, speakText, copyText, notice }) {
  const statusLabel = startingRecording ? 'Menyiapkan mikrofon...' : voiceStatus === 'processing' ? 'Memproses suara...' : listening ? 'Mendengarkan...' : voiceStatus === 'done' ? 'Transkripsi selesai' : voiceStatus === 'error' ? 'Perlu perhatian' : 'Siap Mendengarkan'
  const transcriptStatus = startingRecording ? 'MENYIAPKAN' : voiceStatus === 'processing' ? 'MEMPROSES' : voiceStatus === 'done' ? 'SELESAI' : listening ? 'LIVE' : voiceStatus === 'error' ? 'PERIKSA' : 'KOSONG'
  return (
    <div className="page-content voice-page">
      <div className="page-heading"><div><span className="section-kicker">LIVE SPEECH TRANSCRIPTION</span><h1>Suara ke Teks</h1><p>Dengarkan percakapan dengan jelas, satu kata pada satu waktu.</p></div><span className="privacy-chip"><ShieldCheck size={15} /> PRIVAT & AMAN</span></div>
      <div className="voice-layout">
        <section className="voice-console">
          <div className="voice-console-header"><div><span className="console-icon"><AudioLines size={17} /></span><span><strong>Studio transkripsi</strong><small>Whisper lokal · Bahasa Indonesia</small></span></div><span className={`listening-status ${listening ? 'is-listening' : ''} ${voiceStatus === 'done' ? 'is-done' : ''} ${startingRecording || voiceStatus === 'processing' ? 'is-processing' : ''}`}><i /> {startingRecording && <LoaderCircle className="voice-loading-icon" size={12} />}{statusLabel}</span></div>
          <div className={`wave-stage ${listening ? 'wave-active' : ''}`}>
            <span className="wave-stage-ring ring-one" /><span className="wave-stage-ring ring-two" />
            <span className="mic-orbit orbit-a" /><span className="mic-orbit orbit-b" />
            <button className={`mic-button ${listening ? 'listening' : ''}`} type="button" onClick={listening || startingRecording ? stopListening : startListening} disabled={voiceStatus === 'processing' && !listening} aria-label={listening ? 'Berhenti mendengarkan' : startingRecording ? 'Batalkan permintaan mikrofon' : 'Mulai mendengarkan'}>{listening ? <span className="mic-stop" /> : startingRecording ? <X size={25} /> : voiceStatus === 'processing' ? <LoaderCircle className="voice-loading-icon" size={25} /> : <Mic size={27} />}</button>
            <div className="wave-bars" aria-hidden="true">{waveBars.map((height, index) => <i key={index} style={{ '--bar-height': `${height}px`, '--bar-delay': `${(index % 12) * -0.09}s` }} />)}</div>
            <div className="wave-stage-caption"><span className="mic-hint">{startingRecording ? 'Menghubungkan backend lokal...' : voiceStatus === 'processing' ? 'Memproses segmen suara; perekaman berlanjut...' : listening ? 'Mendengarkan...' : voiceStatus === 'done' ? 'Kamu bisa mulai sesi baru kapan saja.' : 'Tekan mikrofon untuk memulai'}</span><span className="wave-locale" title="Bahasa Indonesia"><span /> id-ID</span></div>
          </div>
          <div className="voice-console-controls"><button className={`button ${listening ? 'button-stop' : 'button-primary'}`} type="button" onClick={listening || startingRecording ? stopListening : startListening} disabled={voiceStatus === 'processing' && !listening}>{listening ? <><span className="stop-square" /> Berhenti</> : startingRecording ? <><X size={15} /> Batalkan</> : voiceStatus === 'processing' ? <><LoaderCircle className="voice-loading-icon" size={15} /> Memproses suara...</> : <><Mic size={16} /> Mulai Mendengarkan</>}</button><span><ShieldCheck size={14} /> Audio diproses di komputer ini</span></div>
          <div className="voice-tips"><span><Sparkles size={16} /></span><p><strong>Untuk hasil yang lebih akurat</strong><small>Ucapkan dengan jelas dan kurangi suara latar di sekitarmu.</small></p></div>
        </section>

        <section className="transcript-panel">
          <div className="transcript-panel-header"><div><span className="transcript-panel-icon"><MessageSquareText size={17} /></span><span><strong>Hasil transkripsi</strong><small>Transkrip dari audio yang diproses lokal</small></span></div><span className={`transcript-state state-${startingRecording ? 'processing' : voiceStatus}`}><i /> {(startingRecording || voiceStatus === 'processing') && <LoaderCircle className="voice-loading-icon" size={12} />}{transcriptStatus}</span></div>
          {voiceError && <p className="voice-error" role="alert">{voiceError}</p>}
          {voiceStatus === 'processing' && <div className="transcript-processing" role="status"><LoaderCircle className="voice-loading-icon" size={17} /> Whisper sedang mengubah audio menjadi teks...</div>}
          <div className={`transcript-content ${transcript ? 'has-transcript' : ''}`} aria-live="polite">
            {transcript ? <p>{transcript}{listening && <span className="transcript-cursor" aria-hidden="true" />}</p> : <div className="transcript-placeholder"><span className="transcript-placeholder-art"><span><MessageSquareText size={25} /></span><i /><i /><i /></span><strong>Ruang kata-katamu</strong><span>Mulai sesi untuk menampilkan transkripsi langsung di sini.</span></div>}
          </div>
          <div className="transcript-panel-footer"><span className="transcript-language"><span /> Bahasa Indonesia</span><div className="transcript-actions"><button className="button button-quiet" type="button" onClick={() => copyText(transcript)} disabled={!transcript}><Copy size={15} /> Salin</button><button className="button button-quiet danger-quiet" type="button" onClick={clearTranscript} disabled={!transcript}><Trash2 size={15} /> Hapus hasil</button></div></div>
          {transcript && voiceStatus === 'done' && <button className="listen-result" type="button" onClick={() => speakText(transcript)}><Volume2 size={15} /> Dengarkan hasilnya <ArrowRight size={14} /></button>}
          {notice && <p className="action-notice transcript-notice" role="status">{notice}</p>}
        </section>
      </div>
      <div className="workspace-footnote"><span><ShieldCheck size={14} /> Audio diproses secara lokal dan tidak disimpan.</span><span>Faster-Whisper · <button type="button" onClick={() => speakText('Transkripsi bahasa Indonesia')}>Text-to-Speech <Volume2 size={13} /></button></span></div>
    </div>
  )
}

function HistoryRow({ item, compact = false }) {
  return (
    <div className={`history-row ${compact ? 'compact' : ''}`}>
      <span className={`history-type ${item.kind}`}><MessageSquareText size={16} /></span>
      <span className="history-text"><strong>{item.text}</strong><small>{item.kind === 'suara' ? 'Suara ke teks' : 'Isyarat ke teks'}</small></span>
      <span className="history-time"><Clock3 size={13} /> {item.time}</span>
    </div>
  )
}

function HistoryPage({ history, onNavigate, onClear, onCopy, notice }) {
  return (
    <div className="page-content history-page">
      <div className="page-heading"><div><span className="section-kicker">SEMUA PERCAKAPANMU</span><h1>Riwayat Terjemahan</h1><p>Temukan kembali kata-kata yang pernah dibagikan di BISARA.</p></div><span className="history-total">{history.length} percakapan</span></div>
      <section className="history-surface">
        <div className="history-page-toolbar"><div><span className="history-toolbar-mark"><History size={18} /></span><span><strong>Aktivitas terbaru</strong><small>Tersimpan di sesi browser ini</small></span></div>{history.length > 0 && <button className="button button-quiet danger-quiet" type="button" onClick={onClear}><Trash2 size={15} /> Hapus semua</button>}</div>
        {history.length ? <div className="history-page-list">{history.map((item) => <div className="history-page-item" key={item.id}><HistoryRow item={item} /><button className="icon-button history-copy" type="button" aria-label="Salin percakapan" onClick={() => onCopy(item.text)}><Copy size={15} /></button></div>)}</div> : <div className="history-page-empty"><span className="history-empty-art"><History size={28} /><i /><i /></span><strong>Riwayatmu dimulai dari sini.</strong><p>Hasil transkripsi suara yang selesai akan tersimpan di halaman ini.</p><button className="button button-primary" type="button" onClick={() => onNavigate('voice')}>Mulai transkripsi <ArrowRight size={15} /></button></div>}
      </section>
      {notice && <p className="action-notice" role="status">{notice}</p>}
    </div>
  )
}

function AboutPage({ onNavigate }) {
  return (
    <div className="page-content about-page">
      <div className="about-hero">
        <span className="about-mark"><Hand size={30} /></span><span className="section-kicker">TENTANG BISARA</span>
        <h1>Lebih dari teknologi.<br /><span>Sebuah jembatan.</span></h1>
        <p>BISARA hadir untuk mendekatkan orang melalui berbagai cara berkomunikasi. Karena setiap gerakan punya arti dan setiap suara layak didengar.</p>
        <div className="about-orbit"><span /><span /><span /></div>
      </div>
      <div className="about-pillars">
        <div><span><HeartHandshake size={20} /></span><strong>Inklusif sejak awal</strong><p>Pengalaman dirancang agar mudah diakses dan nyaman untuk beragam cara berkomunikasi.</p></div>
        <div><span><ShieldCheck size={20} /></span><strong>Privasi yang utama</strong><p>Kamera dan mikrofon hanya digunakan saat kamu mengaktifkannya.</p></div>
        <div><span><Zap size={20} /></span><strong>Teknologi bermakna</strong><p>AI membantu memberi lebih banyak ruang untuk memahami satu sama lain.</p></div>
      </div>
      <div className="about-cta"><span><Headphones size={20} /></span><div><strong>Siap memulai percakapan?</strong><small>Pilih pengalaman yang paling nyaman untukmu.</small></div><button className="button button-primary" type="button" onClick={() => onNavigate('dashboard')}>Ke dashboard <ArrowRight size={15} /></button></div>
    </div>
  )
}

export default App
