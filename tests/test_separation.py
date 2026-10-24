"""Tests for piano_tiles_ai.separation (the model itself is mocked)."""

import numpy as np
import pytest
import soundfile as sf

from piano_tiles_ai import separation

SR = 22050


@pytest.fixture
def song(tmp_path):
    """Create a 1-second stereo WAV file and return its path."""
    t = np.arange(SR) / SR
    tone = 0.5 * np.sin(2 * np.pi * 440 * t)
    path = tmp_path / "song.wav"
    sf.write(path, np.stack([tone, tone], axis=1), SR)
    return path


@pytest.fixture
def fake_roformer(monkeypatch):
    """Replace the real model with a fake that writes a silent piano stem."""
    calls = []

    def fake_run(input_dir, output_dir):
        calls.append(input_dir)
        stem_dir = output_dir / "song"
        stem_dir.mkdir(parents=True)
        sf.write(stem_dir / "piano.wav", np.zeros(SR), SR)

    monkeypatch.setattr(separation, "_run_roformer", fake_run)
    return calls


def test_creates_piano_stem(song, tmp_path, fake_roformer):
    result = separation.separate_piano(song, cache_dir=tmp_path / "cache")
    assert result.is_file()
    assert result.name == "piano.wav"
    assert len(fake_roformer) == 1


def test_second_call_uses_cache(song, tmp_path, fake_roformer):
    cache = tmp_path / "cache"
    first = separation.separate_piano(song, cache_dir=cache)
    second = separation.separate_piano(song, cache_dir=cache)
    assert first == second
    assert len(fake_roformer) == 1


def test_force_reruns_model(song, tmp_path, fake_roformer):
    cache = tmp_path / "cache"
    separation.separate_piano(song, cache_dir=cache)
    separation.separate_piano(song, cache_dir=cache, force=True)
    assert len(fake_roformer) == 2


def test_missing_file_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        separation.separate_piano(tmp_path / "missing.wav")


def test_hash_depends_on_content_not_name(tmp_path):
    a = tmp_path / "a.bin"
    b = tmp_path / "b.bin"
    c = tmp_path / "c.bin"
    a.write_bytes(b"hello")
    b.write_bytes(b"hello")
    c.write_bytes(b"world")
    assert separation.file_hash(a) == separation.file_hash(b)
    assert separation.file_hash(a) != separation.file_hash(c)