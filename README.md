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

## Prediksi Isyarat ke Teks di browser

Model Random Forest BISARA diekspor sebagai aset JSON agar prediksi berjalan langsung di browser dan tidak memerlukan Cloud Functions. Jika model dilatih ulang, jalankan `python "Training Model/export_model_for_browser.py"` untuk memperbarui `public/models/sign_forest.json`.

- Frontend memuat model terlatih dari `public/models/sign_forest.json`; landmark tetap diekstrak oleh MediaPipe di browser. Firebase Auth tetap digunakan untuk login, tetapi prediksi gestur tidak memanggil backend.
- UI menjalankan Hand Landmarker MediaPipe di browser, mencerminkan frame sebelum deteksi, menggambar 21 titik serta koneksi tulang tangan, dan menyediakan tombol **Aktifkan kamera** serta **Ambil take**. Setelah take dimulai, sistem menstabilkan deteksi selama 18 frame sebelum memilih 45 frame untuk satu tangan atau 90 frame untuk dua tangan. Hanya frame saat tangan terdeteksi yang dihitung. Inferensi memakai gambar maksimal 640 piksel agar lebih ringan; landmark visual memakai smoothing responsif. Urutan landmark dan model klasifikasi diproses langsung di browser pada development maupun production. Frame/video tidak diunggah.
- Suara keluaran gestur memakai rekaman MP3 sendiri dari `public/audio/signs/`: `halo.mp3`, `tidak.mp3`, `ya.mp3`, `sakit.mp3`, `maaf.mp3`, `terima_kasih.mp3`, `tolong.mp3`, dan `antre.mp3`. Setiap take yang berhasil dikenali memutar rekaman sesuai label; audio berikutnya diantrikan.
- Normalisasi fitur model v5 mempertahankan koordinat posisi gambar pergelangan tangan (X/Y) selain bentuk tangan, agar perbedaan lokasi seperti “Halo” dan “Tidak” tidak hilang. Normalisasi landmark di browser mengikuti implementasi training v5; aset Random Forest JSON diekspor dari `src/model AI/bisara_final_model.joblib`. Uji silang per peserta pada 671 take mencapai akurasi 96,6%.
- Model menolak kelas jika jumlah tangan tidak sesuai metadata atau konsistensinya terlalu rendah. Confidence memakai probabilitas asli kelas, bukan probabilitas yang dinormalisasi hanya dalam kelompok jumlah tangan yang cocok. Di bawah 60% kata ditolak; setiap kata yang lolos ambang 60% ditampilkan dan otomatis dibacakan dalam Bahasa Indonesia.
- Aset classifier browser dihasilkan dari model `src/model AI/bisara_final_model.joblib` dan berukuran kurang dari 1 MB.
- Lima label model ditandai satu tangan (`halo`, `maaf`, `sakit`, `tidak`, `ya`) dan tiga label dua tangan (`antre`, `terima_kasih`, `tolong`). Prediksi ditolak jika hitungan tangan paling dominan tidak cocok atau konsistensinya kurang dari 70%.
- Confidence di bawah 60% tidak menampilkan hasil; setiap kata yang dikenali pada confidence minimal 60% menampilkan teks dan otomatis dibacakan.
- Error 403 Service Usage berarti akun CLI belum punya izin untuk mengaktifkan/memakai API di project. Minta pemilik project mengatur role yang diperlukan pada **project `bisara-2d92a`**; jangan pilih project `fir-bisara` kecuali memang itu project tujuan.

MediaPipe dan Random Forest memproses video serta fitur landmark di perangkat. Hanya aset model statis yang diunduh dari Firebase Hosting; tidak ada frame kamera yang dikirim ke server.
