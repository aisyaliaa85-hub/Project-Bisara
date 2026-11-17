"""Shared landmark normalization used by training and webcam inference."""

import numpy as np


HAND_COUNT = 2
POINTS_PER_HAND = 21
AXES_PER_POINT = 3
FEATURE_COUNT = HAND_COUNT * POINTS_PER_HAND * AXES_PER_POINT
PALM_SCALE_FLOOR = 1e-4


def normalize_frame(frame, hand_present):
    """Remove absolute image position/scale while retaining hand-to-hand layout."""
    landmarks = np.asarray(frame, dtype=np.float32).reshape(
        HAND_COUNT, POINTS_PER_HAND, AXES_PER_POINT
    ).copy()
    present = np.asarray(hand_present, dtype=bool)
    active = np.flatnonzero(present)
    if active.size == 0:
        return np.zeros(FEATURE_COUNT, dtype=np.float32)

    # Use the midpoint of detected wrists as origin. With one hand, this is
    # that hand's wrist; with two, the relative wrist spacing remains intact.
    origin = landmarks[active, 0, :].mean(axis=0)
    palm_scales = [
        np.linalg.norm(landmarks[index, 9, :2] - landmarks[index, 0, :2])
        for index in active
    ]
    scale = max(float(np.median(palm_scales)), PALM_SCALE_FLOOR)

    for index in active:
        landmarks[index] = (landmarks[index] - origin) / scale
    for index in range(HAND_COUNT):
        if not present[index]:
            landmarks[index] = 0.0

    return landmarks.reshape(FEATURE_COUNT)
