"""Audio loading utilities"""
from pathlib import Path
import librosa 
import numpy as np

def load_audio(
path:str | Path,
sr:int | None = None,
mono:bool = True,
offset:float = 0.0,
duration:float | None = None,
) -> tuple[np.ndarray, int]:
    """Load an audio file as a floating-point waveform.

    Args:
        path: Path to the audio file (wav, mp3, flac, ogg...).
        sr: Target sample rate in Hz. None keeps the file's native rate.
        mono: If True, average all channels into a single mono signal.
        offset: Start reading after this many seconds.
        duration: Only load this many seconds. None loads until the end.

    Returns:
        A tuple (y, sr) where y is the waveform (float32, values in [-1, 1])
        and sr is its sample rate in Hz.

    Raises:
        FileNotFoundError: If path does not exist.
    """
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"Audio file is not found: {path}")
    y, sr_out = librosa.load(path, sr=sr, mono=mono, offset=offset, duration=duration)
    return y, int(sr_out)
