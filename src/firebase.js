import { getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFunctions } from 'firebase/functions'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyDZUZTHIv23dVJ1yTa2CuRZrbepHUgImHk',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'bisara-2d92a.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'bisara-2d92a',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'bisara-2d92a.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '1008230571552',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:1008230571552:web:2072cfb4ff5901455de645',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-KS82LS0WMZ',
}

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const functions = getFunctions(app, 'asia-southeast2')

export function getFirebaseAuth() {
  return auth
}