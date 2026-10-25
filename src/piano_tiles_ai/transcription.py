"""Piano transcription (audio to MIDI) with Transkun."""

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from piano_tiles_ai.cache import file_hash

MODEL_NAME = "transkun-2.0.1"
DEFAULT_CACHE_DIR = Path("outputs/transcribed")


def _default_device() -> str:
    """Return "cuda" if an NVIDIA GPU is available, otherwise "cpu"."""
    import torch

    return "cuda" if torch.cuda.is_available() else "cpu"


def _run_transkun(audio_path: Path, midi_path: Path, device: str) -> None:
    """Run the transkun command to transcribe audio_path into midi_path."""
    executable = Path(sys.executable).parent / "transkun"
    subprocess.run(
        [str(executable), str(audio_path), str(midi_path), "--device", device],
        check=True,
    )


def transcribe_piano(
    path: str | Path,
    cache_dir: str | Path = DEFAULT_CACHE_DIR,
    device: str | None = None,
    force: bool = False,
) -> Path:
    """Transcribe a piano recording into a MIDI file.

    The result is cached: calling this function again on the same audio
    content returns the cached file without running the model.

    Args:
        path: Path to a piano recording (ideally an isolated piano stem).
        cache_dir: Directory where MIDI files are stored.
        device: "cuda" or "cpu". None picks the GPU when available.
        force: If True, run the model even if a cached result exists.

    Returns:
        Path to the transcribed MIDI file.

    Raises:
        FileNotFoundError: If path does not exist.
        RuntimeError: If the model did not produce a MIDI file.
    """
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"Audio file not found: {path}")

    key = f"{MODEL_NAME}-{file_hash(path)[:16]}"
    target = Path(cache_dir) / key / "piano.mid"
    if target.is_file() and not force:
        return target

    if device is None:
        device = _default_device()

    with tempfile.TemporaryDirectory() as tmp_name:
        tmp_midi = Path(tmp_name) / "piano.mid"
        _run_transkun(path, tmp_midi, device)
        if not tmp_midi.is_file():
            raise RuntimeError(f"Transkun did not produce a MIDI file for {path}")

        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(tmp_midi, target)

    return target