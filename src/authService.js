import {
  browserLocalPersistence,
  browserSessionPersistence,
  GoogleAuthProvider,
  getAdditionalUserInfo,
  setPersistence,
  signInWithPopup,
} from 'firebase/auth'
import { getFirebaseAuth } from './firebase.js'

export class AuthServiceError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AuthServiceError'
  }
}

const firebaseErrorMessages = {
  'auth/user-disabled': 'Akun ini dinonaktifkan. Hubungi administrator BISARA.',
  'auth/too-many-requests': 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.',
  'auth/network-request-failed': 'Tidak dapat terhubung ke Firebase. Periksa koneksi internet lalu coba lagi.',
  'auth/operation-not-allowed': 'Provider Google belum diaktifkan di Firebase Authentication Console.',
  'auth/unauthorized-domain': 'Domain aplikasi belum diizinkan. Tambahkan localhost pada Firebase Authentication > Settings > Authorized domains.',
  'auth/popup-closed-by-user': 'Jendela login Google ditutup sebelum proses selesai.',
  'auth/popup-blocked': 'Browser memblokir jendela login Google. Izinkan pop-up lalu coba lagi.',
  'auth/account-exists-with-different-credential': 'Akun ini masih terhubung ke metode masuk lama. Hubungi administrator BISARA untuk migrasi akun.',
  'auth/configuration-not-found': 'Firebase Authentication belum disiapkan untuk project ini.',
  'auth/invalid-api-key': 'API key Firebase tidak valid. Periksa konfigurasi .env.local.',
}

function asAuthError(error) {
  if (error instanceof AuthServiceError) return error
  const firebaseCode = typeof error?.code === 'string' ? error.code : ''
  return new AuthServiceError(
    firebaseErrorMessages[firebaseCode]
      || error?.message
      || 'Terjadi kesalahan Firebase. Periksa konfigurasi project lalu coba lagi.',
  )
}

export async function loginWithGoogle({ rememberMe = false } = {}) {
  try {
    const auth = getFirebaseAuth()
    await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence)
    const credential = await signInWithPopup(auth, new GoogleAuthProvider())
    return { credential, isNewUser: Boolean(getAdditionalUserInfo(credential)?.isNewUser) }
  } catch (error) {
    throw asAuthError(error)
  }
}
