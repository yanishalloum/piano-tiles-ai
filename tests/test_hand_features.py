"""Tests for piano_tiles_ai.hand_features."""

import numpy as np
import pytest

from piano_tiles_ai.hand_features import N_FEATURES, hand_labels, note_features
from piano_tiles_ai.notes import Note


def test_features_shape_and_type():
    notes = [Note(pitch=60, start=0.0, end=1.0, velocity=64)] * 5
    features = note_features(notes)
    assert features.shape == (5, N_FEATURES)
    assert features.dtype == np.float32


def test_feature_values():
    notes = [
        Note(pitch=60, start=0.0, end=1.0, velocity=127),
        Note(pitch=84, start=0.5, end=0.75, velocity=0),
    ]
    features = note_features(notes)
    np.testing.assert_allclose(features[0], [0.0, 0.0, np.log1p(1.0), 1.0], rtol=1e-6)
    np.testing.assert_allclose(features[1], [1.0, np.log1p(0.5), np.log1p(0.25), 0.0], rtol=1e-6)


def test_empty_notes():
    assert note_features([]).shape == (0, N_FEATURES)


def test_labels():
    notes = [
        Note(pitch=40, start=0.0, end=1.0, velocity=64, hand="left"),
        Note(pitch=80, start=0.0, end=1.0, velocity=64, hand="right"),
    ]
    np.testing.assert_array_equal(hand_labels(notes), [0.0, 1.0])


def test_labels_require_hands():
    with pytest.raises(ValueError):
        hand_labels([Note(pitch=60, start=0.0, end=1.0, velocity=64)])