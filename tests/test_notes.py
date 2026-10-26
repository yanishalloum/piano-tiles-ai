"""Tests for piano_tiles_ai.notes."""

import pretty_midi
import pytest

from piano_tiles_ai.notes import Note, load_notes

from piano_tiles_ai.hand_data import load_hand_labeled_notes
from piano_tiles_ai.notes import Note, load_notes, save_notes_as_midi

@pytest.fixture
def midi_file(tmp_path):
    """Write a small MIDI file with three notes, deliberately out of order."""
    midi = pretty_midi.PrettyMIDI()
    piano = pretty_midi.Instrument(program=0)
    piano.notes.append(pretty_midi.Note(velocity=80, pitch=64, start=1.0, end=1.5))
    piano.notes.append(pretty_midi.Note(velocity=100, pitch=60, start=0.0, end=0.5))
    piano.notes.append(pretty_midi.Note(velocity=90, pitch=67, start=1.0, end=2.0))
    midi.instruments.append(piano)
    path = tmp_path / "test.mid"
    midi.write(str(path))
    return path


def test_loads_all_notes(midi_file):
    assert len(load_notes(midi_file)) == 3


def test_notes_sorted_by_start_then_pitch(midi_file):
    assert [n.pitch for n in load_notes(midi_file)] == [60, 64, 67]


def test_note_values_are_preserved(midi_file):
    first = load_notes(midi_file)[0]
    assert first.pitch == 60
    assert first.velocity == 100
    assert first.start == pytest.approx(0.0)
    assert first.end == pytest.approx(0.5)


def test_duration():
    assert Note(pitch=60, start=1.0, end=1.75, velocity=80).duration == pytest.approx(0.75)


def test_notes_are_immutable():
    note = Note(pitch=60, start=0.0, end=1.0, velocity=80)
    with pytest.raises(AttributeError):
        note.pitch = 62


def test_missing_file_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_notes(tmp_path / "missing.mid")

def test_hand_is_unset_by_default():
    assert Note(pitch=60, start=0.0, end=1.0, velocity=80).hand is None

def test_saved_hands_can_be_read_back(tmp_path):
    notes = [
        Note(pitch=48, start=0.0, end=1.0, velocity=70, hand="left"),
        Note(pitch=72, start=0.5, end=1.0, velocity=90, hand="right"),
    ]
    path = save_notes_as_midi(notes, tmp_path / "hands.mid")
    loaded = load_hand_labeled_notes(path)
    assert [(n.pitch, n.hand, n.velocity) for n in loaded] == [(48, "left", 70), (72, "right", 90)]

def test_notes_without_hands_are_saved_in_one_track(tmp_path):
    notes = [Note(pitch=60, start=0.0, end=1.0, velocity=80)]
    path = save_notes_as_midi(notes, tmp_path / "plain.mid")
    assert [n.pitch for n in load_notes(path)] == [60]