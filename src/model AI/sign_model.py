"""Shared BISARA sign-model loading, validation, and prediction logic."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import joblib
import numpy as np

from landmark_features import normalize_frame


FEATURE_VERSION = 4
FEATURES_PER_FRAME = 126
MIN_FRAMES_WITH_HANDS = 8
MIN_HAND_COUNT_CONSISTENCY = 0.7
MIN_PREDICTION_CONFIDENCE = 0.7
CAPTURE_SEQUENCE_LENGTH = 90
STATIC_SEQUENCE_LENGTH = 45


class SignInputError(ValueError):
    """Raised when a landmark sequence is malformed or incomplete."""


def load_model_bundle(model_path: Path) -> dict[str, Any]:
    bundle: dict[str, Any] = joblib.load(model_path)
    classifier = bundle.get("model")
    sequence_length = int(bundle.get("sequence_length", 0))
    feature_count = int(getattr(classifier, "n_features_in_", 0))
    if sequence_length <= 0 or feature_count != sequence_length * FEATURES_PER_FRAME:
        raise RuntimeError(
            f"Model feature shape mismatch: expected {sequence_length * FEATURES_PER_FRAME}, got {feature_count}."
        )
    if int(bundle.get("feature_version", 0)) != FEATURE_VERSION:
        raise RuntimeError("Landmark feature version does not match the model bundle.")
    if bundle.get("normalization") != "shared_wrist_center_and_palm_scale":
        raise RuntimeError("Landmark normalization metadata does not match the model bundle.")
    if not isinstance(bundle.get("expected_hands"), dict):
        raise RuntimeError("Model bundle does not include expected hand-count metadata.")
    return bundle


def build_feature_sequence(frames: Any, sequence_length: int) -> tuple[np.ndarray, int, float]:
    if not isinstance(frames, list) or len(frames) not in (
        sequence_length,
        STATIC_SEQUENCE_LENGTH,
        CAPTURE_SEQUENCE_LENGTH,
    ):
        raise SignInputError(
            f"Kirim {STATIC_SEQUENCE_LENGTH} atau {CAPTURE_SEQUENCE_LENGTH} frame kamera untuk prediksi."
        )

    normalized_frames: list[np.ndarray] = []
    frames_with_hands = 0
    hand_count_distribution = {1: 0, 2: 0}
    for frame_index, frame in enumerate(frames):
        if not isinstance(frame, dict):
            raise SignInputError(f"Format frame ke-{frame_index + 1} tidak valid.")

        landmarks = frame.get("landmarks")
        hand_present = frame.get("hand_present")
        if not isinstance(landmarks, list) or len(landmarks) != FEATURES_PER_FRAME:
            raise SignInputError(f"Frame ke-{frame_index + 1} harus berisi 126 nilai landmark.")
        if not isinstance(hand_present, list) or len(hand_present) != 2:
            raise SignInputError(f"Frame ke-{frame_index + 1} harus memiliki status untuk dua tangan.")
        if any(not isinstance(present, bool) for present in hand_present):
            raise SignInputError(f"Status tangan frame ke-{frame_index + 1} tidak valid.")

        detected_hands = sum(hand_present)
        if detected_hands:
            frames_with_hands += 1
            hand_count_distribution[detected_hands] += 1

        try:
            values = np.asarray(landmarks, dtype=np.float32)
        except (TypeError, ValueError) as error:
            raise SignInputError("Koordinat landmark harus berupa angka.") from error
        if not np.isfinite(values).all():
            raise SignInputError("Koordinat landmark mengandung nilai tidak valid.")
        normalized_frames.append(normalize_frame(values, hand_present))

    if frames_with_hands < MIN_FRAMES_WITH_HANDS:
        raise SignInputError("Tangan belum terdeteksi dengan cukup jelas. Tunjukkan tangan ke kamera lalu coba lagi.")

    normalized_sequence = np.stack(normalized_frames)
    if len(normalized_sequence) != sequence_length:
        positions = np.linspace(0, len(normalized_sequence) - 1, sequence_length)
        left = np.floor(positions).astype(int)
        right = np.ceil(positions).astype(int)
        weight = (positions - left)[:, None]
        normalized_sequence = (
            normalized_sequence[left] * (1.0 - weight)
            + normalized_sequence[right] * weight
        )
    features = normalized_sequence.reshape(1, -1)
    if not math.isfinite(float(features.sum())):
        raise SignInputError("Urutan fitur landmark tidak sesuai dengan versi model.")

    dominant_hand_count = max(hand_count_distribution, key=hand_count_distribution.get)
    consistency = hand_count_distribution[dominant_hand_count] / frames_with_hands
    return features, dominant_hand_count, consistency


def predict_sequence(frames: Any, bundle: dict[str, Any]) -> dict[str, Any]:
    classifier = bundle["model"]
    features, detected_hands, hand_count_consistency = build_feature_sequence(
        frames,
        int(bundle["sequence_length"]),
    )
    frame_features = features.reshape(int(bundle["sequence_length"]), 2, 63)
    swapped_features = frame_features[:, ::-1, :].reshape(1, -1)
    candidates: list[tuple[float, str, int]] = []
    for slot_order, candidate_features in enumerate((features, swapped_features)):
        probabilities = classifier.predict_proba(candidate_features)[0]
        allowed = [
            index for index, candidate_label in enumerate(classifier.classes_)
            if bundle["expected_hands"].get(str(candidate_label)) == detected_hands
        ]
        compatible_total = float(probabilities[allowed].sum()) if allowed else 0.0
        if compatible_total > 0:
            for index in allowed:
                candidate_label = str(classifier.classes_[index])
                confidence = float(probabilities[index] / compatible_total)
                candidates.append((confidence, candidate_label, slot_order))

    hand_count_matches = bool(candidates) and hand_count_consistency >= MIN_HAND_COUNT_CONSISTENCY
    if candidates:
        confidence, label, slot_order = max(candidates, key=lambda candidate: candidate[0])
        expected_hands = bundle["expected_hands"].get(label)
    else:
        confidence, label, slot_order, expected_hands = 0.0, "", -1, None
    confidence_matches = confidence >= MIN_PREDICTION_CONFIDENCE
    recognized = hand_count_matches and confidence_matches

    return {
        "success": True,
        "recognized": recognized,
        "label": label if recognized else "",
        "confidence": confidence,
        "expectedHands": expected_hands,
        "detectedHands": detected_hands,
        "handCountConsistency": hand_count_consistency,
        "reason": "" if recognized else "hand-count-mismatch" if not hand_count_matches else "low-confidence",
        "slotOrder": slot_order,
        "featureVersion": int(bundle["feature_version"]),
    }
