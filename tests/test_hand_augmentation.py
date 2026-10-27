"""Tests for piano_tiles_ai.hand_augmentation."""

import random

from piano_tiles_ai.hand_augmentation import augment_piece
from piano_tiles_ai.notes import Note


def make_piece():
    """100 notes alternating between a low left hand and a high right hand."""
    notes = []
    for i in range(100):
        if i % 2 == 0:
            notes.append(Note(pitch=40 + i % 5, start=i * 0.5, end=i * 0.5 + 0.4, velocity=60, hand="left"))
        else:
            notes.append(Note(pitch=70 + i % 5, start=i * 0.5, end=i * 0.5 + 0.4, velocity=80, hand="right"))
    return notes


def no_noise(notes, rng, **kwargs):
    """Augment without dropping notes or shifting onsets, to compare note by note."""
    return augment_piece(notes, rng, drop_probability=0.0, onset_jitter=0.0, **kwargs)


def test_hands_are_kept_with_a_uniform_transposition():
    piece = make_piece()
    augmented = no_noise(piece, random.Random(1))
    shifts = {a.pitch - o.pitch for a, o in zip(augmented, piece)}
    assert len(shifts) == 1
    assert [a.hand for a in augmented] == [o.hand for o in piece]


def test_tempo_scales_durations_uniformly():
    piece = make_piece()
    augmented = no_noise(piece, random.Random(2))
    ratios = {round(a.duration / o.duration, 6) for a, o in zip(augmented, piece)}
    assert len(ratios) == 1
    assert 0.8 <= ratios.pop() <= 1.25


def test_pitches_stay_on_the_keyboard():
    piece = [
        Note(pitch=21, start=0.0, end=1.0, velocity=60, hand="left"),
        Note(pitch=108, start=0.0, end=1.0, velocity=60, hand="right"),
    ]
    for seed in range(20):
        augmented = no_noise(piece, random.Random(seed))
        assert [n.pitch for n in augmented] == [21, 108]


def test_velocities_stay_valid():
    piece = [Note(pitch=60, start=0.0, end=1.0, velocity=v, hand="right") for v in (1, 127)]
    for seed in range(20):
        for n in no_noise(piece, random.Random(seed)):
            assert 1 <= n.velocity <= 127


def test_same_seed_gives_same_result():
    piece = make_piece()
    assert augment_piece(piece, random.Random(3)) == augment_piece(piece, random.Random(3))


def test_input_is_not_modified():
    piece = make_piece()
    copy = list(piece)
    augment_piece(piece, random.Random(0))
    assert piece == copy


def test_output_is_sorted():
    augmented = augment_piece(make_piece(), random.Random(0))
    keys = [(n.start, n.pitch) for n in augmented]
    assert keys == sorted(keys)