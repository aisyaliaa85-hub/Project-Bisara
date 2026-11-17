"""Uji model tester melalui webcam, satu take setiap kali."""

import csv
import time
from pathlib import Path

import cv2
import joblib
import mediapipe as mp
import numpy as np
from landmark_features import normalize_frame


ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = ROOT / "models" / "bisara_final_model.joblib"
LANDMARKER_PATH = ROOT / "models" / "hand_landmarker.task"
CAMERA_INDEX = 1
SEQUENCE_LENGTH = 32
FEATURE_COUNT = 2 * 21 * 3
LABEL_KEYS = {
    ord("1"): "halo",
    ord("2"): "terima_kasih",
    ord("3"): "tolong",
    ord("4"): "maaf",
    ord("5"): "sakit",
    ord("6"): "ya",
    ord("7"): "tidak",
    ord("8"): "antre",
}
FRAME_COUNTS = {
    "terima_kasih": 90,
    "antre": 90,
    "tolong": 90,
}
FRAME_COUNTS_DEFAULT = 45
MIN_LANDMARK_RATIO = 0.80
MIN_HAND_COUNT_CONSISTENCY = 0.80
HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12),
    (9, 13), (13, 14), (14, 15), (15, 16),
    (13, 17), (17, 18), (18, 19), (19, 20),
    (0, 17),
]


def extract_frame(result, previous_centers):
    detected_hands = []
    for landmarks in result.hand_landmarks or []:
        center_x = sum(point.x for point in landmarks) / 21
        values = []
        for point in landmarks:
            values.extend((point.x, point.y, point.z))
        detected_hands.append((center_x, values))

    assigned_hands = [None, None]
    if len(detected_hands) == 2 and all(
        center is not None for center in previous_centers
    ):
        direct_cost = sum(
            abs(detected_hands[i][0] - previous_centers[i])
            for i in range(2)
        )
        swapped_cost = sum(
            abs(detected_hands[1 - i][0] - previous_centers[i])
            for i in range(2)
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

    frame = np.zeros(FEATURE_COUNT, dtype=np.float32)
    hand_present = [0, 0]
    for hand_index, hand in enumerate(assigned_hands):
        if hand is None:
            continue
        center_x, values = hand
        previous_centers[hand_index] = center_x
        hand_present[hand_index] = 1
        start = hand_index * 63
        frame[start:start + 63] = values
    return normalize_frame(frame, hand_present), sum(hand_present)


def make_features(frames, sequence_length):
    sequence = np.stack(frames)
    positions = np.linspace(0, len(sequence) - 1, sequence_length)
    left = np.floor(positions).astype(int)
    right = np.ceil(positions).astype(int)
    weight = (positions - left)[:, None]
    sampled = sequence[left] * (1.0 - weight) + sequence[right] * weight
    return sampled.reshape(1, -1)


def predict_for_hand_count(model, features, expected_hands, observed_hands):
    probabilities = model.predict_proba(features)[0]
    allowed = [
        i for i, label in enumerate(model.classes_)
        if expected_hands.get(str(label)) == observed_hands
    ]
    if not allowed:
        return None, 0.0
    compatible_scores = probabilities[allowed]
    score_sum = compatible_scores.sum()
    if score_sum <= 0:
        return None, 0.0
    compatible_scores = compatible_scores / score_sum
    best = int(np.argmax(compatible_scores))
    return str(model.classes_[allowed[best]]), float(compatible_scores[best])


def main():
    if not MODEL_PATH.exists():
        raise SystemExit(f"Model tidak ditemukan: {MODEL_PATH}")
    if not LANDMARKER_PATH.exists():
        raise SystemExit(f"Model MediaPipe tidak ditemukan: {LANDMARKER_PATH}")

    bundle = joblib.load(MODEL_PATH)
    model = bundle["model"]
    sequence_length = bundle.get("sequence_length", SEQUENCE_LENGTH)
    expected_hands = bundle.get("expected_hands", {})
    landmarker = mp.tasks.vision.HandLandmarker
    options = mp.tasks.vision.HandLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(LANDMARKER_PATH)),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        num_hands=2,
    )

    camera = cv2.VideoCapture(CAMERA_INDEX)
    if not camera.isOpened():
        raise SystemExit("Webcam tidak dapat dibuka.")

    selected_label = None
    recording = False
    frames = []
    hands_seen = []
    previous_centers = [None, None]
    last_result = "Pilih label 1-8, lalu SPACE untuk merekam"
    records = []
    frame_index = 0

    print("Pilih kata: 1 Halo | 2 Terima kasih | 3 Tolong | 4 Maaf")
    print("5 Sakit | 6 Ya | 7 Tidak | 8 Antre")
    print("SPACE = rekam satu take | Q = selesai dan tampilkan ringkasan")
    print("Antre, Tolong, Terima kasih: 90 frame; kata lainnya: 45 frame.")
    print("Prediksi hanya ditampilkan jika landmark terdeteksi pada minimal 80% frame.")

    try:
        with landmarker.create_from_options(options) as detector:
            while True:
                ok, frame = camera.read()
                if not ok:
                    print("Gagal membaca webcam.")
                    break
                frame = cv2.flip(frame, 1)
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                timestamp_ms = time.monotonic_ns() // 1_000_000
                result = detector.detect_for_video(image, timestamp_ms)

                for hand in result.hand_landmarks or []:
                    points = [
                        (int(point.x * frame.shape[1]),
                         int(point.y * frame.shape[0]))
                        for point in hand
                    ]
                    for start, end in HAND_CONNECTIONS:
                        cv2.line(
                            frame, points[start], points[end],
                            (0, 255, 0), 2
                        )
                    for point in points:
                        cv2.circle(frame, point, 4, (0, 255, 0), -1)

                if recording:
                    row, hand_count = extract_frame(result, previous_centers)
                    needed = FRAME_COUNTS.get(selected_label, FRAME_COUNTS_DEFAULT)
                    # Abaikan waktu tunggu antara menekan Space dan tangan
                    # pertama kali masuk ke deteksi; jangan masukkan ke take.
                    if hand_count > 0 or frames:
                        frames.append(row)
                        hands_seen.append(hand_count)

                    if len(frames) >= needed:
                        valid_ratio = (
                            sum(count > 0 for count in hands_seen)
                            / len(hands_seen)
                        )
                        detected_counts = [count for count in hands_seen if count > 0]
                        two_hand_ratio = (
                            sum(count == 2 for count in detected_counts)
                            / len(detected_counts)
                            if detected_counts else 0.0
                        )
                        if valid_ratio < MIN_LANDMARK_RATIO:
                            prediction = "belum_diketahui"
                            confidence = 0.0
                            last_result = (
                                "BELUM DIKETAHUI | Landmark hanya "
                                f"terdeteksi {valid_ratio:.0%}"
                            )
                        elif two_hand_ratio >= MIN_HAND_COUNT_CONSISTENCY:
                            observed_hands = 2
                            x = make_features(frames, sequence_length)
                            prediction, confidence = predict_for_hand_count(
                                model, x, expected_hands, observed_hands
                            )
                            if prediction is None:
                                prediction = "belum_diketahui"
                                last_result = (
                                    "BELUM DIKETAHUI | Model tidak punya dukungan "
                                    "cukup untuk gestur dua tangan"
                                )
                            else:
                                last_result = (
                                    f"Target: {selected_label} | Prediksi: {prediction} "
                                    f"({confidence:.0%}) | Tangan: 2 | Landmark: {valid_ratio:.0%}"
                                )
                        elif two_hand_ratio <= 1.0 - MIN_HAND_COUNT_CONSISTENCY:
                            observed_hands = 1
                            x = make_features(frames, sequence_length)
                            prediction, confidence = predict_for_hand_count(
                                model, x, expected_hands, observed_hands
                            )
                            if prediction is None:
                                prediction = "belum_diketahui"
                                last_result = (
                                    "BELUM DIKETAHUI | Model tidak punya dukungan "
                                    "cukup untuk gestur satu tangan"
                                )
                            else:
                                last_result = (
                                    f"Target: {selected_label} | Prediksi: {prediction} "
                                    f"({confidence:.0%}) | Tangan: 1 | Landmark: {valid_ratio:.0%}"
                                )
                        else:
                            prediction = "belum_diketahui"
                            confidence = 0.0
                            last_result = (
                                "BELUM DIKETAHUI | Deteksi jumlah tangan tidak "
                                f"konsisten ({two_hand_ratio:.0%} dua tangan)"
                            )
                        record = {
                            "expected": selected_label,
                            "prediction": prediction,
                            "confidence": confidence,
                            "valid_ratio": valid_ratio,
                            "two_hand_ratio": two_hand_ratio,
                        }
                        records.append(record)
                        print(last_result)
                        frames = []
                        hands_seen = []
                        previous_centers = [None, None]
                        recording = False

                cv2.putText(frame, f"Target: {selected_label or '-'}", (12, 30),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
                needed = FRAME_COUNTS.get(selected_label, FRAME_COUNTS_DEFAULT)
                progress = (
                    "Menunggu tangan terdeteksi"
                    if recording and not frames
                    else f"{len(frames)}/{needed} frame"
                )
                cv2.putText(frame, progress, (12, 60),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
                cv2.putText(frame, last_result[:90], (12, frame.shape[0] - 20),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2)
                cv2.imshow("BISARA - Uji Model", frame)
                key = cv2.waitKey(1) & 0xFF

                if key == ord("q"):
                    break
                if not recording and key in LABEL_KEYS:
                    selected_label = LABEL_KEYS[key]
                elif not recording and key == ord(" "):
                    if selected_label is None:
                        print("Pilih kata dahulu dengan tombol 1-8.")
                    else:
                        frames = []
                        hands_seen = []
                        previous_centers = [None, None]
                        recording = True

    finally:
        camera.release()
        cv2.destroyAllWindows()

    if records:
        correct = sum(item["expected"] == item["prediction"] for item in records)
        unknown = sum(item["prediction"] == "belum_diketahui" for item in records)
        print(f"\nAkurasi sesi: {correct}/{len(records)} = {correct / len(records):.1%}")
        print(f"Take belum diketahui (deteksi <{MIN_LANDMARK_RATIO:.0%}): {unknown}")
        print("Rincian take:")
        for index, item in enumerate(records, start=1):
            mark = "BENAR" if item["expected"] == item["prediction"] else "SALAH"
            print(
                f"{index:02d}. {mark} | target={item['expected']} "
                f"prediksi={item['prediction']} confidence={item['confidence']:.1%} "
                f"landmark={item['valid_ratio']:.1%} "
                f"dua_tangan={item['two_hand_ratio']:.1%}"
            )
    else:
        print("Belum ada take yang diuji.")


if __name__ == "__main__":
    main()
