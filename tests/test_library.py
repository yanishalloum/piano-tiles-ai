"""Tests for piano_tiles_ai.library (the AI models are replaced by fakes)."""

import json

import pytest

from piano_tiles_ai.library import Library, process_library_song
from piano_tiles_ai.notes import Note


@pytest.fixture
def library(tmp_path):
    return Library(tmp_path / "library")


@pytest.fixture
def song_file(tmp_path):
    path = tmp_path / "My Song.mp3"
    path.write_bytes(b"fake audio content")
    return path


def fake_process(path):
    return [Note(pitch=60, start=0.0, end=1.0, velocity=80, hand="right")]


def fake_separate(path):
    return path


def fake_encode(source, target):
    target.write_bytes(b"fake mp3")


def test_add_registers_a_queued_song(library, song_file):
    info = library.add(song_file, "Let It Be")
    assert info.status == "queued"
    assert info.title == "Let It Be"
    assert library.original(info.id).name == "original.mp3"
    assert library.get(info.id) == info


def test_empty_title_falls_back_to_the_file_name(library, song_file):
    assert library.add(song_file, "  ").title == "My Song"


def test_same_content_is_not_added_twice(library, song_file, tmp_path):
    copy = tmp_path / "copy.mp3"
    copy.write_bytes(song_file.read_bytes())
    first = library.add(song_file, "A")
    second = library.add(copy, "B")
    assert first == second
    assert len(library.songs()) == 1


def test_unsupported_file_type_is_rejected(library, tmp_path):
    path = tmp_path / "notes.txt"
    path.write_text("not audio")
    with pytest.raises(ValueError):
        library.add(path, "Text")


def test_invalid_ids_cannot_escape_the_library(library):
    with pytest.raises(ValueError):
        library.folder("../../etc")


def test_songs_are_listed_most_recent_first(library, tmp_path):
    ids = []
    for i in range(3):
        path = tmp_path / f"song{i}.mp3"
        path.write_bytes(f"audio {i}".encode())
        ids.append(library.add(path, f"Song {i}").id)
    assert [song.id for song in library.songs()] == ids[::-1]


def test_processing_writes_the_visualizer_files(library, song_file):
    song_id = library.add(song_file, "Let It Be").id
    info = process_library_song(library, song_id, fake_process, fake_separate, fake_encode)
    assert info.status == "ready"
    folder = library.folder(song_id)
    for name in ("song.json", "mix.mp3", "piano.mp3"):
        assert (folder / name).is_file()
    song = json.loads((folder / "song.json").read_text(encoding="utf-8"))
    assert song["title"] == "Let It Be"
    assert len(song["notes"]) == 1


def test_processing_errors_are_reported(library, song_file):
    song_id = library.add(song_file, "Broken").id

    def broken_process(path):
        raise RuntimeError("model crashed")

    info = process_library_song(library, song_id, broken_process, fake_separate, fake_encode)
    assert info.status == "error"
    assert info.error == "model crashed"
    assert library.get(song_id).status == "error"


def test_delete_removes_the_song(library, song_file):
    song_id = library.add(song_file, "Gone").id
    assert library.delete(song_id)
    assert library.get(song_id) is None
    assert not library.delete(song_id)
