"""Piano source separation with BS-RoFormer."""

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import soundfile as sf

from piano_tiles_ai.audio import load_audio
from piano_tiles_ai.cache import file_hash

from piano_tiles_ai.paths import OUTPUTS_DIR

MODEL_NAME = "bs-roformer-sw"
DEFAULT_CACHE_DIR = OUTPUTS_DIR / "separated"

def _run_roformer(input_dir: Path, output_dir: Path) -> None:
    """Run the bs-roformer-infer command on every WAV file in input_dir."""
    executable = Path(sys.executable).parent / "bs-roformer-infer"
    subprocess.run(
        [str(executable), "--input_folder", str(input_dir), "--store_dir", str(output_dir)],
        check=True,
    )


def separate_piano(
    path: str | Path,
    cache_dir: str | Path = DEFAULT_CACHE_DIR,
    force: bool = False,
) -> Path:
    """Isolate the piano from a song and return the path to the piano stem.

    The result is cached: calling this function again on the same audio
    content returns the cached file without running the model.

    Args:
        path: Path to the input song (any format supported by load_audio).
        cache_dir: Directory where separated stems are stored.
        force: If True, run the model even if a cached result exists.

    Returns:
        Path to the separated piano stem (WAV).

    Raises:
        FileNotFoundError: If path does not exist.
        RuntimeError: If the model output does not contain exactly one piano stem.
    """
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"Audio file not found: {path}")

    key = f"{MODEL_NAME}-{file_hash(path)[:16]}"
    target = Path(cache_dir) / key / "piano.wav"
    if target.is_file() and not force:
        return target

    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        input_dir = tmp / "input"
        output_dir = tmp / "output"
        input_dir.mkdir()

        y, sr = load_audio(path, mono=False)
        sf.write(input_dir / "song.wav", y.T, sr)

        _run_roformer(input_dir, output_dir)

        candidates = sorted(output_dir.rglob("*piano*.wav"))
        if len(candidates) != 1:
            found = [p.name for p in output_dir.rglob("*.wav")]
            raise RuntimeError(f"Expected one piano stem, found: {found}")

        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(candidates[0], target)

    return target