"""Tests for piano_tiles_ai.evaluation."""

import pytest

from piano_tiles_ai.evaluation import score_hands
from piano_tiles_ai.notes import Note


def make_notes(hands):
    return [Note(pitch=60 + i, start=float(i), end=float(i) + 0.5, velocity=80, hand=h)
            for i, h in enumerate(hands)]


def test_scores_match_hand_computation():
    reference = make_notes(["left", "left", "right", "right"])
    predicted = make_notes(["left", "right", "right", "right"])
    scores = score_hands(predicted, reference)
    assert scores.accuracy == pytest.approx(0.75)
    assert scores.left_precision == pytest.approx(1.0)
    assert scores.left_recall == pytest.approx(0.5)
    assert scores.right_precision == pytest.approx(2 / 3)
    assert scores.right_recall == pytest.approx(1.0)


def test_perfect_prediction():
    notes = make_notes(["left", "right"])
    assert score_hands(notes, notes).accuracy == pytest.approx(1.0)


def test_mismatched_notes_raise():
    with pytest.raises(ValueError):
        score_hands(make_notes(["left"]), make_notes(["left", "right"]))