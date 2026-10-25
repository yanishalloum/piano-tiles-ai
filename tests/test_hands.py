"""Tests for piano_tiles_ai.hands."""

import pytest

from piano_tiles_ai.hands import assign_hands_by_clustering, assign_hands_by_split
from piano_tiles_ai.notes import Note


def make_note(pitch):
    return Note(pitch=pitch, start=0.0, end=1.0, velocity=80)


def make_timed_note(pitch, start):
    return Note(pitch=pitch, start=start, end=start + 0.5, velocity=80)


# --- Split baseline ---------------------------------------------------------


def test_low_notes_go_left_high_notes_go_right():
    result = assign_hands_by_split([make_note(48), make_note(72)])
    assert [n.hand for n in result] == ["left", "right"]


def test_middle_c_goes_to_the_right_hand():
    assert assign_hands_by_split([make_note(60)])[0].hand == "right"


def test_custom_split():
    result = assign_hands_by_split([make_note(55), make_note(57)], split=56)
    assert [n.hand for n in result] == ["left", "right"]


def test_input_notes_are_not_modified():
    notes = [make_note(48)]
    assign_hands_by_split(notes)
    assert notes[0].hand is None


# --- Clustering baseline ----------------------------------------------------


def test_clustering_separates_two_clear_groups():
    notes = [make_timed_note(p, i * 0.1) for i, p in enumerate([40, 72, 43, 76, 47, 79])]
    result = assign_hands_by_clustering(notes)
    assert {n.pitch: n.hand for n in result} == {
        40: "left", 43: "left", 47: "left", 72: "right", 76: "right", 79: "right"
    }


def test_clustering_follows_hands_above_middle_c():
    # Both hands play above middle C: the split baseline puts everything in the right hand.
    notes = [make_timed_note(p, i * 0.1) for i, p in enumerate([62, 79, 65, 84, 62, 81])]
    result = assign_hands_by_clustering(notes)
    assert [n.hand for n in result if n.pitch in (62, 65)] == ["left", "left", "left"]
    assert all(n.hand == "right" for n in assign_hands_by_split(notes))


def test_clustering_falls_back_to_middle_c_for_narrow_windows():
    notes = [make_timed_note(p, i * 0.1) for i, p in enumerate([57, 59, 62, 64])]
    result = assign_hands_by_clustering(notes)
    assert [n.hand for n in result] == ["left", "left", "right", "right"]


def test_clustering_requires_sorted_notes():
    notes = [make_timed_note(60, 1.0), make_timed_note(62, 0.0)]
    with pytest.raises(ValueError):
        assign_hands_by_clustering(notes)