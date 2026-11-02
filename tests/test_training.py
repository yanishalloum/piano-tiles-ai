"""Tests for piano_tiles_ai.training (loading and training are replaced by fakes)."""

import pytest

from piano_tiles_ai.notes import Note
from piano_tiles_ai.training import train_and_save

PIECE = [Note(pitch=60, start=0.0, end=1.0, velocity=80, hand="right")]


def fake_load(data_dir, split):
    return [PIECE, PIECE] if split == "train" else [PIECE]


def fake_train(train_pieces, val_pieces, epochs, augment_copies):
    fake_train.calls.append((len(train_pieces), len(val_pieces), epochs, augment_copies))
    return "model", [{"epoch": 1, "val_accuracy": 0.9}, {"epoch": 2, "val_accuracy": 0.95}]


def fake_save(model, path):
    path.write_text(model)


@pytest.fixture(autouse=True)
def reset_calls():
    fake_train.calls = []


def test_trains_and_saves_the_model(tmp_path):
    output = tmp_path / "models" / "hand_lstm.pt"
    best = train_and_save(tmp_path, output, epochs=5, load=fake_load, train=fake_train, save=fake_save)
    assert best == 0.95
    assert output.read_text() == "model"
    assert fake_train.calls == [(2, 1, 5, 3)]


def test_an_existing_model_is_not_overwritten(tmp_path):
    output = tmp_path / "hand_lstm.pt"
    output.write_text("my trained model")
    with pytest.raises(FileExistsError):
        train_and_save(tmp_path, output, load=fake_load, train=fake_train, save=fake_save)
    assert output.read_text() == "my trained model"
    train_and_save(tmp_path, output, force=True, load=fake_load, train=fake_train, save=fake_save)
    assert output.read_text() == "model"


def test_an_empty_folder_is_reported(tmp_path):
    with pytest.raises(ValueError, match="directly in this folder"):
        train_and_save(tmp_path, tmp_path / "m.pt", load=lambda d, s: [], train=fake_train, save=fake_save)
