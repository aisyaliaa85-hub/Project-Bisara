"""Train a small baseline gesture classifier from the raw collector CSV."""

import argparse
import csv
from collections import Counter, defaultdict
from itertools import chain
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report
from landmark_features import normalize_frame


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = ROOT / "Training Model" / "gestures_final.csv"
DEFAULT_MODEL = ROOT / "src" / "model AI" / "bisara_final_model.joblib"
CLASS_NAMES = {
    "halo", "antre", "maaf", "sakit", "ya", "tidak",
    "terima_kasih", "tolong",
}
FRAME_FEATURES = 2 * 21 * 3
SEQUENCE_LENGTH = 32


def load_samples(csv_path):
    samples = defaultdict(list)
    with csv_path.open("r", newline="", encoding="utf-8-sig") as source:
        reader = csv.reader(source)
        first = next(reader, None)
        if first is None:
            return np.asarray([]), np.asarray([]), np.asarray([]), np.asarray([]), 0
        has_header = first[0].strip() == "participant_id"
        rows = reader if has_header else chain([first], reader)
        for row in rows:
            if len(row) != 8 + FRAME_FEATURES:
                continue
            label = row[3].strip()
            if label not in CLASS_NAMES:
                continue
            try:
                frame = np.asarray(row[8:], dtype=np.float32)
                hand1, hand2 = int(row[6]), int(row[7])
            except (ValueError, IndexError):
                continue
            if not np.isfinite(frame).all():
                continue
            frame = normalize_frame(frame, (hand1, hand2))
            sample_key = (row[0], row[1], row[2], label, row[4].strip())
            samples[sample_key].append((hand1, hand2, frame))

    features, labels, signers, sample_hands = [], [], [], []
    rejected = 0
    for key, rows in samples.items():
        label, gesture_type = key[3], key[4]
        expected_frames = 90 if gesture_type == "dynamic" else 45
        if len(rows) != expected_frames:
            rejected += 1
            continue
        valid_ratio = sum(h1 or h2 for h1, h2, _ in rows) / len(rows)
        both_ratio = sum(h1 and h2 for h1, h2, _ in rows) / len(rows)
        saw_two_hands = any(h1 and h2 for h1, h2, _ in rows)
        if valid_ratio < 0.80 or (saw_two_hands and both_ratio < 0.80):
            rejected += 1
            continue

        sequence = np.stack([frame for _, _, frame in rows])
        positions = np.linspace(0, len(sequence) - 1, SEQUENCE_LENGTH)
        left = np.floor(positions).astype(int)
        right = np.ceil(positions).astype(int)
        weight = (positions - left)[:, None]
        sampled = sequence[left] * (1.0 - weight) + sequence[right] * weight
        features.append(sampled.reshape(-1))
        labels.append(label)
        signers.append(key[0])
        detected_counts = [h1 + h2 for h1, h2, _ in rows if h1 or h2]
        two_hand_ratio = sum(count == 2 for count in detected_counts) / len(detected_counts)
        sample_hands.append(2 if two_hand_ratio >= 0.5 else 1)

    return (
        np.asarray(features, dtype=np.float32),
        np.asarray(labels),
        np.asarray(signers),
        np.asarray(sample_hands, dtype=np.int8),
        rejected,
    )


def hand_profile(labels, hand_counts):
    profile = {}
    for label in np.unique(labels):
        counts = Counter(hand_counts[labels == label].tolist())
        profile[str(label)] = int(counts.most_common(1)[0][0])
    return profile


def predict_with_hand_count(model, X, hand_counts, expected_hands):
    probabilities = model.predict_proba(X)
    predictions = []
    for scores, observed_hands in zip(probabilities, hand_counts):
        allowed = [
            i for i, label in enumerate(model.classes_)
            if expected_hands.get(str(label)) == int(observed_hands)
        ]
        if not allowed:
            allowed = list(range(len(model.classes_)))
        predictions.append(model.classes_[allowed[int(np.argmax(scores[allowed]))]])
    return np.asarray(predictions)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    args = parser.parse_args()

    X, y, signers, sample_hands, rejected = load_samples(args.data)
    if len(y) == 0:
        raise SystemExit("Tidak ada take valid untuk delapan label final.")
    labels, counts = np.unique(y, return_counts=True)
    too_small = [name for name in CLASS_NAMES if name not in set(labels)]
    if too_small:
        raise SystemExit(f"Label belum ada di data final: {sorted(too_small)}")
    unique_signers = np.unique(signers)
    if len(unique_signers) < 2:
        raise SystemExit("Evaluasi responden tertahan perlu minimal 2 responden.")

    all_truth, all_predictions = [], []
    for signer in unique_signers:
        test_idx = np.flatnonzero(signers == signer)
        train_idx = np.flatnonzero(signers != signer)
        fold_model = RandomForestClassifier(
            n_estimators=300,
            class_weight="balanced_subsample",
            min_samples_leaf=2,
            random_state=42,
            n_jobs=-1,
        )
        fold_model.fit(X[train_idx], y[train_idx])
        fold_hand_profile = hand_profile(y[train_idx], sample_hands[train_idx])
        fold_predictions = predict_with_hand_count(
            fold_model, X[test_idx], sample_hands[test_idx], fold_hand_profile
        )
        all_truth.extend(y[test_idx])
        all_predictions.extend(fold_predictions)
        fold_accuracy = np.mean(fold_predictions == y[test_idx])
        print(f"Uji responden {signer}: {fold_accuracy:.1%} ({len(test_idx)} take)")

    print(f"Take valid: {len(y)} | ditolak: {rejected}")
    print("Distribusi:", {str(name): int(count) for name, count in zip(labels, counts)})
    expected_hands = hand_profile(y, sample_hands)
    print("Jumlah tangan per kelas:", expected_hands)
    print("Akurasi gabungan (responden tidak dilatih):",
          f"{np.mean(np.asarray(all_truth) == np.asarray(all_predictions)):.3f}")
    print(classification_report(all_truth, all_predictions, zero_division=0))

    model = RandomForestClassifier(
        n_estimators=300,
        class_weight="balanced_subsample",
        min_samples_leaf=2,
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X, y)

    args.model.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "model": model,
            "sequence_length": SEQUENCE_LENGTH,
            "classes": model.classes_.tolist(),
            "feature_version": 5,
            "normalization": "shared_wrist_center_and_palm_scale_with_wrist_image_xy",
            "expected_hands": expected_hands,
        },
        args.model,
    )
    print(f"Model final tersimpan: {args.model}")
    print("Model final dilatih ulang menggunakan semua take valid.")


if __name__ == "__main__":
    main()
