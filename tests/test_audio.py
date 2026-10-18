"""Tests for piano_tiles_ai.audio."""

import numpy as np
import pytest
import soundfile as sf

from piano_tiles_ai.audio import load_audio

SR = 22050


@pytest.fixture
def sine_wav(tmp_path):
    """Create a 2-second 440 Hz stereo WAV file and return its path."""
    t = np.arange(2 * SR) / SR
    tone = 0.5 * np.sin(2 * np.pi * 440 * t)
    stereo = np.stack([tone, tone], axis=1)
    path = tmp_path / "sine.wav"
    sf.write(path, stereo, SR)
    return path


def test_keeps_native_sample_rate(sine_wav):
    y, sr = load_audio(sine_wav)
    assert sr == SR
    assert len(y) == 2 * SR


def test_returns_mono_by_default(sine_wav):
    y, _ = load_audio(sine_wav)
    assert y.ndim == 1


def test_resamples_when_requested(sine_wav):
    y, sr = load_audio(sine_wav, sr=16000)
    assert sr == 16000
    assert len(y) == 2 * 16000


def test_duration_limits_length(sine_wav):
    y, sr = load_audio(sine_wav, duration=0.5)
    assert len(y) == int(0.5 * sr)


def test_missing_file_raises():
    with pytest.raises(FileNotFoundError):
        load_audio("does_not_exist.wav")
