import cv2
import mediapipe as mp

# Lokasi model
MODEL_PATH = "models/hand_landmarker.task"

# Inisialisasi MediaPipe
BaseOptions = mp.tasks.BaseOptions
HandLandmarker = mp.tasks.vision.HandLandmarker
HandLandmarkerOptions = mp.tasks.vision.HandLandmarkerOptions
RunningMode = mp.tasks.vision.RunningMode

options = HandLandmarkerOptions(
    base_options=BaseOptions(model_asset_path=MODEL_PATH),
    running_mode=RunningMode.VIDEO,
    num_hands=2
)

# Membuka webcam
camera = cv2.VideoCapture(0)

if not camera.isOpened():
    print("Webcam tidak dapat dibuka!")
    exit()

print("Webcam aktif. Tekan Q untuk keluar.")

with HandLandmarker.create_from_options(options) as detector:

    while True:
        success, frame = camera.read()

        if not success:
            print("Gagal membaca kamera.")
            break

        # Membalik gambar agar seperti cermin
        frame = cv2.flip(frame, 1)

        # Mengubah BGR menjadi RGB
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        # Mengubah gambar menjadi format MediaPipe
        mp_image = mp.Image(
            image_format=mp.ImageFormat.SRGB,
            data=rgb_frame
        )

        # Timestamp video dalam milidetik
        timestamp_ms = int(
            cv2.getTickCount() / cv2.getTickFrequency() * 1000
        )

        # Mendeteksi tangan
        result = detector.detect_for_video(
            mp_image,
            timestamp_ms
        )

        # Menggambar landmark tangan
        if result.hand_landmarks:

            for hand_index, hand_landmarks in enumerate(result.hand_landmarks):

                height, width, _ = frame.shape

                for landmark in hand_landmarks:
                    x = int(landmark.x * width)
                    y = int(landmark.y * height)

                    cv2.circle(
                        frame,
                        (x, y),
                        5,
                        (0, 255, 0),
                        -1
                    )

                cv2.putText(
                    frame,
                    f"Hand {hand_index + 1}",
                    (20, 40 + hand_index * 35),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.8,
                    (0, 255, 0),
                    2
                )

        # Menampilkan hasil
        cv2.imshow("BISARA - Hand Detection", frame)

        # Keluar jika Q ditekan
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

camera.release()
cv2.destroyAllWindows()