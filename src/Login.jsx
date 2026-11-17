import { useState } from 'react'
import { ArrowLeft, Hand, Mail, ShieldCheck, Sparkles } from 'lucide-react'
import { AuthServiceError, loginWithGoogle } from './authService.js'
import './Login.css'

function Login({ onNavigate, redirectTo = 'dashboard' }) {
  const destinationLabels = {
    dashboard: 'dashboard BISARA',
    sign: 'fitur Isyarat ke Teks',
    voice: 'fitur Suara ke Teks',
  }
  const destinationLabel = destinationLabels[redirectTo] || destinationLabels.dashboard
  const [rememberMe, setRememberMe] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const handleGoogleLogin = async () => {
    setError('')
    setNotice('')
    setGoogleLoading(true)
    try {
      const { isNewUser } = await loginWithGoogle({ rememberMe })
      setNotice(isNewUser ? 'Akun BISARA berhasil dibuat dengan Google.' : 'Berhasil masuk dengan Google.')
      window.setTimeout(() => onNavigate(redirectTo), 700)
    } catch (requestError) {
      setError(requestError instanceof AuthServiceError ? requestError.message : 'Tidak dapat masuk dengan Google. Coba lagi.')
    } finally {
      setGoogleLoading(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-showcase" aria-label="Tentang BISARA">
        <div className="auth-showcase-glow auth-showcase-glow-one" />
        <div className="auth-showcase-glow auth-showcase-glow-two" />
        <div className="auth-showcase-inner">
          <button className="auth-brand auth-brand-light" type="button" onClick={() => onNavigate('landing')} aria-label="Kembali ke beranda BISARA">
            <span className="auth-brand-mark"><Hand size={21} strokeWidth={2.2} /></span>
            <span>BISARA<span className="auth-brand-period">.</span></span>
          </button>

          <div className="auth-showcase-copy">
            <span className="auth-eyebrow"><Sparkles size={14} /> AI ACCESSIBILITY PLATFORM</span>
            <h1>Komunikasi<br />Tanpa Batas,<br /><span>Untuk Semua.</span></h1>
            <p>BISARA menghubungkan bahasa isyarat, suara, dan teks agar setiap orang dapat saling memahami.</p>
          </div>

          <div className="auth-illustration" aria-hidden="true">
            <div className="auth-illustration-orbit auth-orbit-one" />
            <div className="auth-illustration-orbit auth-orbit-two" />
            <div className="auth-illustration-card">
              <div className="auth-illustration-top"><span><i /> BISARA VISION</span><span>AI LIVE</span></div>
              <div className="auth-illustration-center">
                <span className="auth-illustration-halo" />
                <span className="auth-illustration-hand"><Hand size={96} strokeWidth={1.2} /></span>
                <Sparkles className="auth-illustration-spark" size={18} />
              </div>
              <div className="auth-illustration-caption"><span><ShieldCheck size={16} /></span><strong>Memahami, tanpa batas.</strong><i><b /><b /><b /><b /></i></div>
            </div>
            <span className="auth-float-tag auth-float-tag-one"><span className="auth-float-icon"><Mail size={15} /></span><span><small>TERHUBUNG</small><strong>Untuk semua</strong></span></span>
            <span className="auth-float-tag auth-float-tag-two"><span className="auth-float-live" /> PRIVASI TERJAGA</span>
          </div>

          <p className="auth-showcase-footer"><ShieldCheck size={15} /> Teknologi yang lebih inklusif, untuk semua.</p>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-panel-top"><span>Autentikasi aman dengan Firebase</span></div>
        <div className="auth-form-wrap">
          <button className="auth-back-link" type="button" onClick={() => onNavigate('landing')}><ArrowLeft size={15} /> Kembali ke beranda</button>
          <div className="auth-heading">
            <span className="auth-heading-mark"><ShieldCheck size={20} /></span>
            <span className="auth-kicker">MASUK DENGAN GOOGLE</span>
            <h2>Selamat Datang!</h2>
            <p>Gunakan akun Google untuk membuka {destinationLabel}. Akun BISARA akan dibuat otomatis saat pertama kali masuk.</p>
          </div>

          <label className="auth-remember auth-remember-google"><input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} /><span>Ingat Saya</span></label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          {notice && <p className="auth-success" role="status">{notice}</p>}

          <button className="auth-google-button" type="button" onClick={handleGoogleLogin} disabled={googleLoading}>
            {googleLoading ? <><span className="auth-spinner" /> Menghubungkan...</> : <><span className="google-mark" aria-hidden="true">G</span> Lanjutkan dengan Google</>}
          </button>

          <p className="auth-secure-note"><ShieldCheck size={15} /> Login ditangani Google dan Firebase Authentication; BISARA tidak menerima password.</p>
        </div>
        <footer className="auth-panel-footer"><span>© {new Date().getFullYear()} BISARA</span><span>Komunikasi tanpa batas, untuk semua.</span></footer>
      </section>
    </main>
  )
}

export default Login
