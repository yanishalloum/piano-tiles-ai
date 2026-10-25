"""Tests for piano_tiles_ai.transcription (the model itself is mocked)."""

import pytest

from piano_tiles_ai import transcription


@pytest.fixture
def piano_wav(tmp_path):
    """Create a dummy input file. Its content only matters for the hash."""
    path = tmp_path / "piano.wav"
    path.write_bytes(b"fake piano audio")
    return path


@pytest.fixture
def fake_transkun(monkeypatch):
    """Replace the real model with a fake that writes a dummy MIDI file."""
    calls = []

    def fake_run(audio_path, midi_path, device):
        calls.append(device)
        midi_path.write_bytes(b"fake midi")

    monkeypatch.setattr(transcription, "_run_transkun", fake_run)
    return calls


def test_creates_midi_file(piano_wav, tmp_path, fake_transkun):
    result = transcription.transcribe_piano(piano_wav, cache_dir=tmp_path / "cache", device="cpu")
    assert result.is_file()
    assert result.suffix == ".mid"
    assert fake_transkun == ["cpu"]


def test_second_call_uses_cache(piano_wav, tmp_path, fake_transkun):
    cache = tmp_path / "cache"
    first = transcription.transcribe_piano(piano_wav, cache_dir=cache, device="cpu")
    second = transcription.transcribe_piano(piano_wav, cache_dir=cache, device="cpu")
    assert first == second
    assert len(fake_transkun) == 1


def test_force_reruns_model(piano_wav, tmp_path, fake_transkun):
    cache = tmp_path / "cache"
    transcription.transcribe_piano(piano_wav, cache_dir=cache, device="cpu")
    transcription.transcribe_piano(piano_wav, cache_dir=cache, device="cpu", force=True)
    assert len(fake_transkun) == 2


def test_missing_file_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        transcription.transcribe_piano(tmp_path / "missing.wav")


def test_failed_model_leaves_no_cache_entry(piano_wav, tmp_path, monkeypatch):
    def broken_run(audio_path, midi_path, device):
        pass  # simulate a model that crashes without writing anything

    monkeypatch.setattr(transcription, "_run_transkun", broken_run)
    cache = tmp_path / "cache"
    with pytest.raises(RuntimeError):
        transcription.transcribe_piano(piano_wav, cache_dir=cache, device="cpu")
    assert not list(cache.rglob("*.mid"))