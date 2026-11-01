from piano_tiles_ai.notes import Note
from piano_tiles_ai.physics import (
    chord_groups,
    chord_violations,
    crossing_violations,
    jump_violations,
)


def note(pitch, start, hand):
    return Note(pitch=pitch, start=start, end=start + 0.5, velocity=80, hand=hand)


def test_notes_struck_together_form_a_chord():
    notes = [note(60, 0.0, "right"), note(64, 0.01, "right"), note(67, 1.0, "right")]
    assert chord_groups(notes) == [[0, 1], [2]]


def test_a_chord_wider_than_a_tenth_is_flagged():
    playable = [note(60, 0.0, "right"), note(76, 0.0, "right")]  # 16 semitones
    too_wide = [note(60, 0.0, "right"), note(77, 0.0, "right")]  # 17 semitones
    assert chord_violations(playable) == set()
    assert chord_violations(too_wide) == {0, 1}


def test_six_notes_in_one_hand_are_flagged():
    notes = [note(p, 0.0, "right") for p in (60, 62, 64, 65, 67, 69)]
    assert chord_violations(notes) == set(range(6))


def test_left_hand_above_right_hand_is_flagged():
    notes = [note(72, 0.0, "left"), note(60, 0.0, "right"), note(48, 0.0, "left")]
    assert crossing_violations(notes) == {0, 1}


def test_fast_jump_is_flagged_but_slow_jump_is_not():
    fast = [note(36, 0.0, "left"), note(70, 0.1, "left")]
    slow = [note(36, 0.0, "left"), note(70, 0.5, "left")]
    assert jump_violations(fast) == {0, 1}
    assert jump_violations(slow) == set()
