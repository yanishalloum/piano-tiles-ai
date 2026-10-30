"""Tests for piano_tiles_ai.export."""

import json

from piano_tiles_ai.export import FORMAT_VERSION, save_song_json, song_to_dict
from piano_tiles_ai.notes import Note


def make_notes():
    return [
        Note(pitch=43, start=0.5, end=2.0, velocity=64, hand="left"),
        Note(pitch=67, start=0.5, end=1.0, velocity=80, hand="right"),
    ]


def test_song_dict_structure():
    song = song_to_dict(make_notes(), "Test")
    assert song["format_version"] == FORMAT_VERSION
    assert song["title"] == "Test"
    assert song["duration"] == 2.0
    assert song["notes"][0] == {"pitch": 43, "start": 0.5, "end": 2.0, "velocity": 64, "hand": "left"}


def test_empty_song_has_zero_duration():
    assert song_to_dict([], "Empty")["duration"] == 0.0


def test_saved_file_is_valid_json(tmp_path):
    path = save_song_json(make_notes(), tmp_path / "song.json", "Gymnopédie")
    with open(path, encoding="utf-8") as f:
        song = json.load(f)
    assert song["title"] == "Gymnopédie"
    assert len(song["notes"]) == 2

def test_times_are_rounded_to_the_millisecond():
    notes = [Note(pitch=60, start=0.011979166666666666, end=0.0817708333, velocity=64, hand="left")]
    note = song_to_dict(notes, "Test")["notes"][0]
    assert note["start"] == 0.012
    assert note["end"] == 0.082

def test_times_are_rounded_to_the_millisecond():
    notes = [Note(pitch=60, start=0.011979166666666666, end=0.0817708333, velocity=64, hand="left")]
    note = song_to_dict(notes, "Test")["notes"][0]
    assert note["start"] == 0.012
    assert note["end"] == 0.082