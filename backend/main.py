"""Local-only BISARA speech transcription API powered by Faster-Whisper."""

import asyncio
import logging
import os
import sys
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

from faster_whisper import WhisperModel
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("bisara.transcription")

BACKEND_DIR = Path(__file__).resolve().parent
SIGN_MODEL_DIR = BACKEND_DIR.parent / "src" / "model AI"
if str(SIGN_MODEL_DIR) not in sys.path:
    sys.path.insert(0, str(SIGN_MODEL_DIR))

from sign_model import SignInputError, load_model_bundle, predict_sequence

MODEL_NAME = os.getenv("WHISPER_MODEL", "base").strip().lower()
MODEL_DIR = BACKEND_DIR / "models" / MODEL_NAME
DEVICE = os.getenv("WHISPER_DEVICE", "cpu").strip().lower()
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8").strip().lower()
MAX_AUDIO_BYTES = 20 * 1024 * 1024
ALLOWED_EXTENSIONS = {
    ".aac",
    ".flac",
    ".m4a",
    ".mp3",
    ".mp4",
    ".mpeg",
    ".oga",
    ".ogg",
    ".opus",
    ".wav",
    ".webm",
}
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "BISARA_ALLOWED_ORIGINS",
        "http://127.0.0.1:5173,http://localhost:5173",
    ).split(",")
    if origin.strip()
]

model: WhisperModel | None = None
sign_model_bundle: dict[str, Any] | None = None
transcription_lock = asyncio.Lock()


class TranscriptionResponse(BaseModel):
    success: bool
    text: str
    language: str


class SignPredictionRequest(BaseModel):
    frames: list[dict[str, Any]]


@asynccontextmanager
async def lifespan(_: FastAPI):
    global model
    global sign_model_bundle

    model_file = MODEL_DIR / "model.bin"
    if not model_file.is_file():
        raise RuntimeError(
            f"Model Whisper belum tersedia di {MODEL_DIR}. "
            "Jalankan 'python backend/download_model.py' sebelum memulai backend."
        )

    logger.info("Memuat model Whisper %s dari disk lokal (%s/%s).", MODEL_NAME, DEVICE, COMPUTE_TYPE)
    model = WhisperModel(
        str(MODEL_DIR),
        device=DEVICE,
        compute_type=COMPUTE_TYPE,
    )
    sign_model_bundle = load_model_bundle(SIGN_MODEL_DIR / "bisara_final_model.joblib")
    logger.info("Model isyarat BISARA siap; classifier lokal dimuat.")
    logger.info("Model Whisper siap; audio diproses secara lokal.")
    yield
    model = None
    sign_model_bundle = None


app = FastAPI(
    title="BISARA Local Speech-to-Text",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
async def health() -> dict[str, str | bool]:
    return {
        "status": "ok" if model is not None else "not_ready",
        "model_loaded": model is not None,
        "model": MODEL_NAME,
        "device": DEVICE,
        "sign_model_loaded": sign_model_bundle is not None,
    }


@app.post("/predict-sign")
async def predict_sign(request: SignPredictionRequest) -> dict[str, Any]:
    if sign_model_bundle is None:
        raise HTTPException(status_code=503, detail="Model isyarat BISARA belum siap.")
    try:
        return predict_sequence(request.frames, sign_model_bundle)
    except SignInputError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


def transcribe_file(audio_path: str) -> str:
    if model is None:
        raise RuntimeError("Model Whisper belum siap.")

    segments, _ = model.transcribe(
        audio_path,
        language="id",
        task="transcribe",
        beam_size=5,
        vad_filter=True,
    )
    return " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()


@app.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe(file: Annotated[UploadFile, File(...)]) -> TranscriptionResponse:
    suffix = Path(file.filename or "audio.webm").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        await file.close()
        raise HTTPException(
            status_code=415,
            detail="Format audio tidak didukung. Gunakan WebM, WAV, MP3, M4A, OGG, atau FLAC.",
        )

    temporary_path: Path | None = None
    total_bytes = 0
    try:
        with tempfile.NamedTemporaryFile(prefix="bisara-", suffix=suffix, delete=False) as temporary_file:
            temporary_path = Path(temporary_file.name)
            while chunk := await file.read(1024 * 1024):
                total_bytes += len(chunk)
                if total_bytes > MAX_AUDIO_BYTES:
                    raise HTTPException(status_code=413, detail="Ukuran audio melebihi batas 20 MB.")
                temporary_file.write(chunk)

        if total_bytes == 0:
            raise HTTPException(status_code=400, detail="Audio kosong. Silakan rekam suara lalu coba lagi.")

        async with transcription_lock:
            try:
                text = await run_in_threadpool(transcribe_file, str(temporary_path))
            except Exception as error:
                logger.exception("Pemrosesan audio lokal gagal.")
                raise HTTPException(
                    status_code=422,
                    detail="Audio tidak dapat dibaca atau diproses. Coba rekam ulang dengan mikrofon.",
                ) from error

        return TranscriptionResponse(success=True, text=text, language="id")
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Gagal menerima atau menyimpan audio sementara.")
        raise HTTPException(status_code=500, detail="Terjadi kesalahan lokal saat menerima audio.") from error
    finally:
        await file.close()
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)