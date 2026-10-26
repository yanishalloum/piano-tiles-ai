"""Tests for piano_tiles_ai.hand_model."""

import torch

from piano_tiles_ai.hand_model import (
    CHUNK_SIZE,
    HandChunks,
    HandLSTM,
    HandTransformer,
    assign_hands_with_model,
    load_hand_model,
    train_hand_model,
)
from piano_tiles_ai.notes import Note


def make_piece(n_notes):
    """A trivial piece: low left-hand notes alternate with high right-hand notes."""
    notes = []
    for i in range(n_notes):
        left = i % 2 == 0
        notes.append(Note(
            pitch=40 + i % 7 if left else 76 + i % 5,
            start=i * 0.25,
            end=i * 0.25 + 0.2,
            velocity=64,
            hand="left" if left else "right",
        ))
    return notes


def test_chunks_shapes():
    dataset = HandChunks([make_piece(256)], chunk_size=128, stride=64)
    assert len(dataset) == 3
    inputs, targets = dataset[0]
    assert inputs.shape == (128, 4)
    assert targets.shape == (128,)


def test_model_output_shape():
    model = HandLSTM(hidden_size=8)
    assert model(torch.zeros(2, 10, 4)).shape == (2, 10)


def test_assign_hands_with_model_labels_every_note():
    result = assign_hands_with_model(make_piece(20), HandLSTM(hidden_size=8))
    assert len(result) == 20
    assert all(n.hand in ("left", "right") for n in result)


def test_assign_hands_with_model_handles_empty_input():
    assert assign_hands_with_model([], HandLSTM(hidden_size=8)) == []


def test_training_learns_a_trivial_task():
    pieces = [make_piece(512) for _ in range(4)]
    model, history = train_hand_model(pieces, pieces[:1], epochs=40, learning_rate=1e-2, device="cpu")
    assert max(h["val_accuracy"] for h in history) > 0.95

def test_transformer_output_shape():
    model = HandTransformer(d_model=16, nhead=2, num_layers=1, dim_feedforward=32)
    assert model(torch.zeros(2, CHUNK_SIZE, 4)).shape == (2, CHUNK_SIZE)


def test_transformer_labels_pieces_longer_than_a_chunk():
    model = HandTransformer(d_model=16, nhead=2, num_layers=1, dim_feedforward=32)
    notes = make_piece(3 * CHUNK_SIZE + 17)
    result = assign_hands_with_model(notes, model)
    assert len(result) == len(notes)
    assert all(n.hand in ("left", "right") for n in result)


def test_transformer_learns_a_trivial_task():
    pieces = [make_piece(512) for _ in range(4)]
    model = HandTransformer(d_model=16, nhead=2, num_layers=1, dim_feedforward=32)
    _, history = train_hand_model(pieces, pieces[:1], model=model, epochs=40, learning_rate=1e-2, device="cpu")
    assert max(h["val_accuracy"] for h in history) > 0.95

def test_saved_model_can_be_loaded(tmp_path):
    model = HandLSTM().eval()
    path = tmp_path / "model.pt"
    torch.save(model.state_dict(), path)
    loaded = load_hand_model(path, device="cpu")
    x = torch.zeros(1, 5, 4)
    assert torch.allclose(model(x), loaded(x))