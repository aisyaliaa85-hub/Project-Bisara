
import cv2
import mediapipe as mp
import csv
import os
import time
import uuid
from datetime import datetime


# ==========================================
# KONFIGURASI
# ==========================================

MODEL_PATH = "models/hand_landmarker.task"
OUTPUT_PATH = "dataset/raw/gestures_final.csv"
CAMERA_INDEX = 1

STATIC_FRAMES = 45
DYNAMIC_FRAMES = 90
MAX_HANDS = 2
MIN_VALID_RATIO = 0.80
HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12),
    (9, 13), (13, 14), (14, 15), (15, 16),
    (13, 17), (17, 18), (18, 19), (19, 20),
    (0, 17),
]

LABELS = {
    "1": "halo",
    "2": "terima_kasih",
    "3": "tolong",
    "4": "maaf",
    "5": "sakit",
    "6": "ya",
    "7": "tidak",
    "8": "antre"
}

# ==========================================
# IDENTITAS RESPONDEN
# ==========================================

participant_id = input(
    "Masukkan ID responden (A/B/C/D): "
).strip().upper()

if participant_id not in ["A", "B", "C", "D"]:
    raise ValueError("ID responden harus A, B, C, atau D.")

session_id = datetime.now().strftime("%Y%m%d_%H%M%S")

# ==========================================
# PERSIAPAN CSV
# ==========================================

os.makedirs("dataset/raw", exist_ok=True)

header = [
    "participant_id",
    "session_id",
    "sample_id",
    "label",
    "gesture_type",
    "frame_index",
    "hand1_present",
    "hand2_present"
]

for hand in range(1, MAX_HANDS + 1):
    for point in range(21):
        for axis in ["x", "y", "z"]:
            header.append(
                f"hand{hand}_{point}_{axis}"
            )

file_exists = (
    os.path.exists(OUTPUT_PATH)
    and os.path.getsize(OUTPUT_PATH) > 0
)

csv_file = open(
    OUTPUT_PATH,
    "a",
    newline="",
    encoding="utf-8"
)

writer = csv.DictWriter(
    csv_file,
    fieldnames=header
)

if not file_exists:
    writer.writeheader()

# ==========================================
# MEDIAPIPE TASKS
# ==========================================

BaseOptions = mp.tasks.BaseOptions
HandLandmarker = mp.tasks.vision.HandLandmarker
HandLandmarkerOptions = mp.tasks.vision.HandLandmarkerOptions
RunningMode = mp.tasks.vision.RunningMode

options = HandLandmarkerOptions(
    base_options=BaseOptions(
        model_asset_path=MODEL_PATH
    ),
    running_mode=RunningMode.VIDEO,
    num_hands=MAX_HANDS
)

# ==========================================
# EKSTRAKSI LANDMARK
# ==========================================

def extract_landmarks(result, previous_centers):

    data = {
        "hand1_present": 0,
        "hand2_present": 0
    }

    hands_data = [
        [0.0] * 63,
        [0.0] * 63
    ]

    detected_hands = []

    if result.hand_landmarks:

        for landmarks in result.hand_landmarks:

            center_x = sum(
                point.x for point in landmarks
            ) / 21

            detected_hands.append(
                (center_x, landmarks)
            )

    # Pertahankan slot tangan berdasarkan posisi sebelumnya agar tangan
    # yang masih terlihat tidak berpindah slot saat tangan lain tertutup.
    assigned_hands = [None] * MAX_HANDS
    if len(detected_hands) == 2 and all(
        center is not None for center in previous_centers
    ):
        direct_cost = sum(
            abs(detected_hands[i][0] - previous_centers[i])
            for i in range(MAX_HANDS)
        )
        swapped_cost = sum(
            abs(detected_hands[1 - i][0] - previous_centers[i])
            for i in range(MAX_HANDS)
        )
        assigned_hands = (
            detected_hands if direct_cost <= swapped_cost
            else detected_hands[::-1]
        )
    elif len(detected_hands) == 1 and any(
        center is not None for center in previous_centers
    ):
        available = [i for i, center in enumerate(previous_centers)
                     if center is not None]
        slot = min(available, key=lambda i: abs(
            detected_hands[0][0] - previous_centers[i]
        ))
        assigned_hands[slot] = detected_hands[0]
    else:
        detected_hands.sort(key=lambda item: item[0])
        assigned_hands[:len(detected_hands)] = detected_hands

    for index, hand in enumerate(assigned_hands):
        if hand is None:
            continue
        center_x, landmarks = hand
        previous_centers[index] = center_x
        data[f"hand{index + 1}_present"] = 1

        values = []

        for point in landmarks:
            values.extend([
                point.x,
                point.y,
                point.z
            ])

        hands_data[index] = values

    for hand_index in range(MAX_HANDS):

        for point in range(21):

            for axis_index, axis in enumerate(
                ["x", "y", "z"]
            ):

                column = (
                    f"hand{hand_index + 1}_"
                    f"{point}_{axis}"
                )

                data[column] = hands_data[hand_index][
                    point * 3 + axis_index
                ]

    return data

# ==========================================
# WEBCAM
# ==========================================

if not os.path.exists(MODEL_PATH):
    raise FileNotFoundError(
        f"Model tidak ditemukan: {MODEL_PATH}"
    )

camera = cv2.VideoCapture(CAMERA_INDEX)

if not camera.isOpened():
    raise RuntimeError("Webcam tidak dapat dibuka.")

selected_label = None
gesture_type = None

recording = False
frame_count = 0
valid_frames = 0
both_hands_frames = 0
expected_two_hands = False
active_frames = STATIC_FRAMES
previous_centers = [None] * MAX_HANDS

sample_id = None
sample_rows = []

print("\n===== BISARA DATA COLLECTOR =====")
print("Responden:", participant_id)
print("Pilih kata dengan tombol 1-8")
print("S = Gestur statis")
print("D = Gestur dinamis")
print("SPACE = Mulai merekam")
print("Q = Keluar")

try:

    with HandLandmarker.create_from_options(
        options
    ) as detector:

        while True:

            success, frame = camera.read()

            if not success:
                print("Gagal membaca webcam.")
                break

            frame = cv2.flip(frame, 1)

            rgb = cv2.cvtColor(
                frame,
                cv2.COLOR_BGR2RGB
            )

            mp_image = mp.Image(
                image_format=mp.ImageFormat.SRGB,
                data=rgb
            )

            timestamp_ms = (
                time.monotonic_ns() // 1_000_000
            )

            result = detector.detect_for_video(
                mp_image,
                timestamp_ms
            )

            # Menggambar garis koneksi dan titik landmark tangan
            if result.hand_landmarks:

                for landmarks in result.hand_landmarks:

                    points = [
                        (int(point.x * frame.shape[1]),
                         int(point.y * frame.shape[0]))
                        for point in landmarks
                    ]

                    for start, end in HAND_CONNECTIONS:
                        cv2.line(
                            frame,
                            points[start],
                            points[end],
                            (0, 255, 0),
                            2
                        )

                    for x, y in points:

                        cv2.circle(
                            frame,
                            (x, y),
                            4,
                            (0, 255, 0),
                            -1
                        )

            # Informasi layar
            cv2.putText(
                frame,
                f"Responden: {participant_id}",
                (10, 25),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 255, 255),
                2
            )

            cv2.putText(
                frame,
                f"Label: {selected_label or '-'}",
                (10, 55),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (0, 255, 255),
                2
            )

            cv2.putText(
                frame,
                f"Jenis: {gesture_type or '-'}",
                (10, 85),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 255, 0),
                2
            )

            if recording:

                cv2.putText(
                    frame,
                    f"Recording: {frame_count}/{active_frames}",
                    (10, 120),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.7,
                    (0, 0, 255),
                    2
                )

                row = extract_landmarks(result, previous_centers)

                if row["hand1_present"] and row["hand2_present"]:
                    both_hands_frames += 1
                    expected_two_hands = True

                if (
                    row["hand1_present"]
                    or row["hand2_present"]
                ):
                    valid_frames += 1

                row.update({
                    "participant_id": participant_id,
                    "session_id": session_id,
                    "sample_id": sample_id,
                    "label": selected_label,
                    "gesture_type": gesture_type,
                    "frame_index": frame_count
                })

                sample_rows.append(row)
                frame_count += 1

                if frame_count >= active_frames:

                    required = int(
                        active_frames * MIN_VALID_RATIO
                    )

                    if (
                        valid_frames >= required
                        and (
                            not expected_two_hands
                            or both_hands_frames >= required
                        )
                    ):

                        writer.writerows(sample_rows)
                        csv_file.flush()

                        print(
                            f"TERSIMPAN | "
                            f"{selected_label} | "
                            f"{participant_id} | "
                            f"{sample_id}"
                        )

                    else:

                        print(
                            "SAMPEL DIBATALKAN: deteksi tangan kurang stabil. "
                            "Pastikan tangan terlihat jelas dan tidak terlalu jauh."
                        )

                    recording = False
                    frame_count = 0
                    valid_frames = 0
                    both_hands_frames = 0
                    expected_two_hands = False
                    previous_centers = [None] * MAX_HANDS
                    sample_rows = []
                    sample_id = None

            else:

                cv2.putText(
                    frame,
                    "1-8: Label | S/D: Type | SPACE: Record",
                    (10, 120),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    (255, 255, 255),
                    1
                )

            cv2.imshow(
                "BISARA SIBI Dataset Collector",
                frame
            )

            key = cv2.waitKey(1) & 0xFF

            if key == ord("q"):
                break

            if not recording:

                if key in [
                    ord(str(i)) for i in range(1, 9)
                ]:

                    selected_label = LABELS[
                        chr(key)
                    ]

                    print("Label:", selected_label)

                elif key == ord("s"):

                    gesture_type = "static"
                    print("Jenis: STATIC")

                elif key == ord("d"):

                    gesture_type = "dynamic"
                    print("Jenis: DYNAMIC")

                elif key == ord(" "):

                    if selected_label is None:
                        print("Pilih label dahulu!")

                    elif gesture_type is None:
                        print("Pilih jenis gesture dahulu!")

                    else:

                        recording = True
                        frame_count = 0
                        valid_frames = 0
                        both_hands_frames = 0
                        expected_two_hands = False
                        previous_centers = [None] * MAX_HANDS
                        active_frames = (
                            DYNAMIC_FRAMES
                            if gesture_type == "dynamic"
                            else STATIC_FRAMES
                        )
                        sample_rows = []
                        sample_id = str(uuid.uuid4())

                        print(
                            "Merekam:",
                            selected_label,
                            gesture_type
                        )

finally:

    camera.release()
    csv_file.close()
    cv2.destroyAllWindows()

print("Pengumpulan dataset selesai.")




