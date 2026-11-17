"""Authenticated Firebase callable for BISARA's hand-sign classifier."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from firebase_functions import https_fn

from sign_model import SignInputError, load_model_bundle, predict_sequence


MODEL_PATH = Path(__file__).resolve().parent / "bisara_final_model.joblib"
_bundle = load_model_bundle(MODEL_PATH)


@https_fn.on_call(region="asia-southeast2", memory=512, timeout_sec=60, max_instances=5)
def predict_sign(request: https_fn.CallableRequest) -> dict[str, Any]:
    """Predict a BISARA sign label from 32 two-hand landmark frames."""
    if request.auth is None:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Silakan masuk ke BISARA sebelum menggunakan penerjemah isyarat.",
        )

    try:
        return predict_sequence(request.data.get("frames"), _bundle)
    except SignInputError as error:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message=str(error),
        ) from error


