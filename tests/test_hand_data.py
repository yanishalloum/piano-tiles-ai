"""Tests for piano_tiles_ai.hand_data."""

import pretty_midi
import pytest

from piano_tiles_ai.hand_data import load_hand_labeled_notes, strip_hands


def write_midi(path, tracks):
    """Write a MIDI file. `tracks` maps a track name to a list of (pitch, start, end)."""
    midi = pretty_midi.PrettyMIDI()
    for name, notes in tracks.items():
        instrument = pretty_midi.Instrument(program=0, name=name)
        for pitch, start, end in notes:
            instrument.notes.append(pretty_midi.Note(velocity=80, pitch=pitch, start=start, end=end))
        midi.instruments.append(instrument)
    midi.write(str(path))
    return path


def test_labels_come_from_track_names(tmp_path):
    path = write_midi(tmp_path / "a.mid", {
        "Piano right": [(72, 0.0, 1.0)],
        "Piano left": [(48, 0.5, 1.0)],
    })
    notes = load_hand_labeled_notes(path)
    assert [(n.pitch, n.hand) for n in notes] == [(72, "right"), (48, "left")]


def test_missing_hand_raises(tmp_path):
    path = write_midi(tmp_path / "a.mid", {"Piano right": [(72, 0.0, 1.0)]})
    with pytest.raises(ValueError):
        load_hand_labeled_notes(path)


def test_unnamed_track_with_notes_raises(tmp_path):
    path = write_midi(tmp_path / "a.mid", {
        "Piano right": [(72, 0.0, 1.0)],
        "Piano left": [(48, 0.0, 1.0)],
        "Strings": [(60, 0.0, 1.0)],
    })
    with pytest.raises(ValueError):
        load_hand_labeled_notes(path)


def test_strip_hands_removes_labels(tmp_path):
    path = write_midi(tmp_path / "a.mid", {
        "Piano right": [(72, 0.0, 1.0)],
        "Piano left": [(48, 0.0, 1.0)],
    })
    assert all(n.hand is None for n in strip_hands(load_hand_labeled_notes(path)))