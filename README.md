# BISARA

BISARA adalah aplikasi React dan Vite untuk aksesibilitas komunikasi. Fitur Suara ke Teks menggunakan perekam mikrofon browser dan backend **FastAPI + Faster-Whisper lokal**. Audio dikirim hanya ke backend pada komputer yang sama, diproses dengan model yang sudah diunduh, lalu berkas sementara dihapus.

## Mengapa Speech-to-Text sebelumnya gagal?

Implementasi sebelumnya memakai Web Speech API milik browser. API tersebut dapat mengirim audio ke layanan pengenalan suara eksternal milik browser, sehingga bergantung pada koneksi dan kebijakan layanan tersebut. BISARA sekarang merekam dengan `MediaRecorder` dan mengirim audio ke `http://127.0.0.1:8000/transcribe`; aplikasi tidak menggunakan layanan Speech Recognition browser atau API berbayar.

## Prasyarat

- Windows 10/11 (perintah di bawah menggunakan PowerShell), macOS, atau Linux.
- Python 3.10–3.13 dan Node.js 20.19+ atau 22.12+.
- Mikrofon dan ruang disk untuk model Whisper. Model `base` memerlukan sekitar 150 MB unduhan; model `small` lebih besar dan dapat lebih akurat.
- Internet diperlukan hanya untuk instalasi paket dan unduhan model pertama kali. Setelah model tersedia, transkripsi berjalan lokal tanpa internet.

## Instalasi backend (Python/FastAPI)

Jalankan perintah dari folder utama project.

1. Pasang Python dari [python.org](https://www.python.org/downloads/) dan pastikan Python dapat dijalankan dari terminal. Di Windows, launcher `py` juga dapat digunakan.
2. Buat dan aktifkan virtual environment:

	```powershell
	py -3.13 -m venv .venv
	.\.venv\Scripts\Activate.ps1
	```

	Jika PowerShell menolak aktivasi, jalankan `python -m venv .venv`, lalu panggil Python venv secara langsung dengan `.\.venv\Scripts\python.exe` pada langkah berikutnya.

3. Instal dependensi backend:

	```powershell
	python -m pip install --upgrade pip
	python -m pip install -r backend/requirements.txt
	```

4. Unduh model Whisper **satu kali** sebelum backend pertama dijalankan:

	```powershell
	python backend/download_model.py
	```

	Default-nya adalah model `base` Bahasa Indonesia. Untuk model `small`, atur pilihan sebelum mengunduh **dan** sebelum memulai backend:

	```powershell
	$env:WHISPER_MODEL = "small"
	python backend/download_model.py
	```

	Model berada di `backend/models/` dan tidak dimasukkan ke Git. Backend hanya memuat model lokal tersebut; ia tidak mengunduh model saat melayani transkripsi.

5. Jalankan backend pada terminal pertama:

	```powershell
	.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
	```

	Jika menggunakan model `small`, set `$env:WHISPER_MODEL = "small"` lagi di terminal backend sebelum menjalankan perintah. Status model dapat diperiksa di `http://127.0.0.1:8000/health`.

## Instalasi dan menjalankan frontend

Di terminal kedua, dari folder utama project:

```powershell
npm install
npm run dev -- --host 127.0.0.1
```

Buka `http://127.0.0.1:5173`. URL backend default frontend adalah `http://127.0.0.1:8000`. Jika perlu, buat `.env.local`:

```env
VITE_TRANSCRIPTION_API_URL=http://127.0.0.1:8000
```

Frontend dan backend menerima origin `127.0.0.1:5173` serta `localhost:5173`. Gunakan alamat frontend yang sama dengan origin ini.

## Menguji fitur Speech-to-Text

1. Pastikan terminal backend menampilkan pesan bahwa model Whisper siap, lalu buka `http://127.0.0.1:8000/health`. Respons sehat memiliki `"status": "ok"` dan `"model_loaded": true`.
2. Buka halaman **Suara ke Teks** di BISARA dan tekan **Mulai Mendengarkan**. Izinkan mikrofon jika diminta.
3. Bicara dalam Bahasa Indonesia. Waveform bergerak selama perekaman.
4. Hasil muncul bertahap setiap segmen rekaman sekitar 5 detik diproses Whisper. Perekaman tetap berjalan saat segmen sebelumnya dikirim dan diproses.
5. Tekan **Berhenti** untuk memproses segmen terakhir dan menutup sesi.
6. Gunakan **Salin** atau **Hapus hasil** pada panel transkripsi. Sesi baru akan digabungkan dengan teks sebelumnya tanpa mengulang kata yang berimpit.

API tersedia di `POST /transcribe`, `POST /predict-sign`, dan `GET /health`. `/transcribe` menerima multipart field `file` dengan audio WebM, WAV, MP3, M4A, OGG, atau FLAC, maksimal 20 MB. `/predict-sign` menerima 45 frame untuk take satu tangan atau 90 frame untuk take dua tangan, menormalkan tiap frame, lalu merangkumnya menjadi 32 fitur waktu sesuai model `src/model AI/bisara_final_model.joblib`; video tidak dikirim. File audio temporer dihapus setelah pemrosesan, termasuk saat terjadi error.

## Privasi dan troubleshooting

- Mikrofon hanya aktif selama perekaman. Audio dikirim ke alamat loopback komputer ini, tidak ke layanan pihak ketiga.
- Jika UI menyatakan backend belum aktif, jalankan backend dan pastikan model telah diunduh. Jangan tutup terminal backend saat menggunakan fitur.
- Jika izin mikrofon ditolak, ubah izin situs di browser dan coba kembali. `localhost`/`127.0.0.1` dianggap konteks lokal yang aman oleh browser modern.
- Format tidak didukung, audio kosong, batas 20 MB, dan kegagalan decoding ditangani sebagai error yang ditampilkan di panel transkripsi.
- Jika model belum ada, jalankan `python backend/download_model.py` dengan environment dan nilai `WHISPER_MODEL` yang sama seperti saat menjalankan backend.

## Autentikasi BISARA

Halaman login BISARA hanya memakai Google Sign-In melalui Firebase Authentication untuk project `bisara-2d92a`. Akun Firebase dibuat otomatis pada login Google pertama; login berikutnya memakai akun yang sama. Opsi **Ingat Saya** memilih sesi browser atau sesi persisten. BISARA tidak menyimpan password pengguna dan tidak mengirim email notifikasi login.

1. Buka [Firebase Console untuk project BISARA](https://console.firebase.google.com/project/bisara-2d92a/overview) dengan akun Google yang memiliki akses ke project.
2. Pada **Authentication → Sign-in method**, aktifkan provider **Google**.
3. Pada **Authentication → Settings → Authorized domains**, pastikan `localhost` terdaftar untuk pengembangan lokal. Tambahkan domain produksi saat deploy.
4. Buka **Project settings → General → Your apps**. Jika belum ada aplikasi Web, tambahkan aplikasi Web (`</>`), lalu salin nilai `apiKey` dan `appId` dari Firebase config.
5. Buat `.env.local` di root project (file ini diabaikan Git) dan isi config berikut. Project ID/domain di bawah sudah mengikuti link project BISARA; ganti placeholder API key dan App ID dengan nilai aplikasi Web dari Console:

```env
VITE_TRANSCRIPTION_API_URL=http://127.0.0.1:8000
VITE_FIREBASE_API_KEY=isi_apiKey_dari_firebase_config
VITE_FIREBASE_AUTH_DOMAIN=bisara-2d92a.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=bisara-2d92a
VITE_FIREBASE_APP_ID=isi_appId_dari_firebase_config
```

Setelah mengubah `.env.local`, mulai ulang Vite (`npm run dev`). Nilai Firebase Web config digunakan oleh browser dan bukan service-account private key; jangan pernah menaruh service-account JSON atau Admin SDK credentials di frontend. Pembatasan API key dapat disetel di Google Cloud Console sesuai kebutuhan aplikasi.

Firebase Console tidak dapat dibaca oleh aplikasi ini tanpa sesi Google yang memiliki akses. Sign-in dapat digunakan setelah konfigurasi Firebase Web diisi, provider Google diaktifkan, dan domain aplikasi diizinkan.

## Cloud Functions untuk model Isyarat ke Teks

Pilih **Python** pada pertanyaan bahasa Cloud Functions. Model BISARA berupa bundle `joblib` berisi `RandomForestClassifier` scikit-learn, dan fitur normalisasi landmark ditulis dalam Python; memakai Python mempertahankan model serta normalisasi yang sudah ada tanpa konversi model.

- Konfigurasi Functions memakai project `bisara-2d92a` pada `.firebaserc` dan menjadikan `src/model AI` sebagai source code Functions. `main.py`, `sign_model.py`, `landmark_features.py`, `bisara_final_model.joblib`, dan `requirements.txt` berada bersama agar model dapat dipaketkan saat deploy.
- UI menjalankan Hand Landmarker MediaPipe di browser, mencerminkan frame sebelum deteksi, menggambar 21 titik serta koneksi tulang tangan, dan menyediakan tombol **Aktifkan kamera** serta **Ambil take**. Setelah take dimulai, sistem menunggu tangan pertama terdeteksi; satu tangan memilih 45 frame dan dua tangan memilih 90 frame secara otomatis. Hanya frame saat tangan terdeteksi yang dihitung. Take divalidasi berdasarkan kestabilan landmark dan jumlah tangan, lalu dikirim sekali untuk prediksi. Dalam development sequence landmark dikirim ke FastAPI lokal `POST /predict-sign`; di production dikirim ke callable Firebase `predict_sign`. Frame/video utuh tidak diunggah.
- Model menolak kelas jika jumlah tangan terdeteksi tidak sesuai metadata kelas (5 kata satu tangan, 3 kata dua tangan) atau dominasi jumlah tangan dalam sequence di bawah 70%. Confidence di bawah 70% tidak menampilkan kata; 70% sampai kurang dari 80% hanya menampilkan teks; mulai 80% menampilkan teks dan auto-play Bahasa Indonesia.
- Versi scikit-learn Functions dipatok `1.8.0`, sesuai versi yang terdeteksi tersimpan pada artefak model. Jangan melatih ulang model tanpa memperbarui versi dependency dan metadata fitur.
- Dalam development (`npm run dev`), halaman kamera memanggil `http://127.0.0.1:8000/predict-sign`. Install semua dependency dari `backend/requirements.txt`, lalu restart FastAPI setelah mengubah dependency. Health menunjukkan `sign_model_loaded: true` bila model isyarat siap.
- Saat frontend production, prediksi memakai callable Firebase `predict_sign`. Deploy setelah akun memiliki izin dan project memenuhi syarat billing/plan untuk Cloud Functions gen 2 dengan `firebase deploy --only functions --project bisara-2d92a`.
- Lima label model ditandai satu tangan (`halo`, `maaf`, `sakit`, `tidak`, `ya`) dan tiga label dua tangan (`antre`, `terima_kasih`, `tolong`). Prediksi ditolak jika hitungan tangan paling dominan tidak cocok atau konsistensinya kurang dari 70%.
- Confidence di bawah 70% tidak menampilkan hasil; 70% hingga kurang dari 80% menampilkan teks saja; mulai 80% menampilkan teks dan otomatis membacakan kata.
- Error 403 Service Usage berarti akun CLI belum punya izin untuk mengaktifkan/memakai API di project. Minta pemilik project mengatur role yang diperlukan pada **project `bisara-2d92a`**; jangan pilih project `fir-bisara` kecuali memang itu project tujuan.

MediaPipe memproses video di perangkat; frame video tidak diunggah. Callable mengirim fitur landmark ke Cloud Functions untuk inferensi model.
