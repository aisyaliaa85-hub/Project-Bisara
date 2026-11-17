"""Download the selected Faster-Whisper model for offline local use."""

import os
from pathlib import Path

from huggingface_hub import snapshot_download


BACKEND_DIR = Path(__file__).resolve().parent
MODEL_NAME = os.getenv("WHISPER_MODEL", "base").strip().lower()
MODEL_DIR = BACKEND_DIR / "models" / MODEL_NAME
REPOSITORY_ID = f"Systran/faster-whisper-{MODEL_NAME}"


def main() -> None:
    if MODEL_NAME not in {"base", "small"}:
        raise SystemExit("WHISPER_MODEL hanya dapat diisi 'base' atau 'small'.")

    print(f"Mengunduh model {MODEL_NAME} ke {MODEL_DIR} ...")
    snapshot_download(repo_id=REPOSITORY_ID, local_dir=str(MODEL_DIR))
    if not (MODEL_DIR / "model.bin").is_file():
        raise SystemExit("Unduhan selesai tetapi berkas model.bin tidak ditemukan.")
    print("Model siap digunakan secara offline.")


if __name__ == "__main__":
    main()