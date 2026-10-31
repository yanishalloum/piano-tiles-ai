"""Tests for piano_tiles_ai.server (processing is replaced by a fake)."""

import pytest
from fastapi.testclient import TestClient

from piano_tiles_ai.library import Library
from piano_tiles_ai.server import create_app


class ImmediateExecutor:
    """Runs submitted work right away, so tests do not have to wait."""

    def submit(self, function, *args):
        function(*args)


def fake_process(library, song_id):
    library.set_status(song_id, "processing")
    folder = library.folder(song_id)
    (folder / "song.json").write_text('{"format_version": 1, "title": "t", "duration": 1, "notes": []}')
    (folder / "mix.mp3").write_bytes(b"0123456789" * 100)
    (folder / "piano.mp3").write_bytes(b"piano")
    return library.set_status(song_id, "ready")


@pytest.fixture
def library(tmp_path):
    return Library(tmp_path / "library")


@pytest.fixture
def client(library, tmp_path):
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<h1>visualizer</h1>")
    app = create_app(library=library, process=fake_process, executor=ImmediateExecutor(), web_dir=web)
    return TestClient(app)


def upload(client, content=b"fake audio", name="Let It Be.mp3", title=""):
    return client.post("/api/songs", files={"file": (name, content)}, data={"title": title})


def test_upload_processes_the_song(client):
    response = upload(client)
    assert response.status_code == 202
    song_id = response.json()["id"]
    assert client.get(f"/api/songs/{song_id}").json()["status"] == "ready"


def test_title_defaults_to_the_file_name(client):
    assert upload(client).json()["title"] == "Let It Be"


def test_songs_are_listed(client):
    upload(client, b"song a", "a.mp3")
    upload(client, b"song b", "b.mp3")
    assert len(client.get("/api/songs").json()) == 2


def test_unsupported_format_is_rejected(client):
    assert upload(client, name="notes.txt").status_code == 415


def test_unknown_or_malformed_ids_give_404(client):
    assert client.get("/api/songs/0123456789abcdef").status_code == 404
    assert client.get("/api/songs/..%2F..%2Fetc").status_code == 404


def test_song_files_are_served_with_range_support(client):
    song_id = upload(client).json()["id"]
    assert client.get(f"/api/songs/{song_id}/files/song.json").status_code == 200
    partial = client.get(f"/api/songs/{song_id}/files/mix.mp3", headers={"Range": "bytes=10-19"})
    assert partial.status_code == 206
    assert partial.content == b"0123456789"


def test_only_visualizer_files_are_served(client):
    song_id = upload(client).json()["id"]
    assert client.get(f"/api/songs/{song_id}/files/info.json").status_code == 404
    assert client.get(f"/api/songs/{song_id}/files/original.mp3").status_code == 404


def test_delete_removes_the_song(client):
    song_id = upload(client).json()["id"]
    assert client.delete(f"/api/songs/{song_id}").status_code == 204
    assert client.get(f"/api/songs/{song_id}").status_code == 404


def test_the_visualizer_is_served(client):
    assert "visualizer" in client.get("/").text


def test_unfinished_songs_are_processed_again_on_startup(library, tmp_path):
    path = tmp_path / "song.mp3"
    path.write_bytes(b"audio")
    song_id = library.add(path, "Left over").id
    create_app(library=library, process=fake_process, executor=ImmediateExecutor(), web_dir=tmp_path)
    assert library.get(song_id).status == "ready"


def test_crashes_in_the_background_are_reported(library, tmp_path):
    def crashing_process(library, song_id):
        raise RuntimeError("GPU out of memory")

    app = create_app(library=library, process=crashing_process, executor=ImmediateExecutor(), web_dir=tmp_path)
    song = upload(TestClient(app)).json()
    info = library.get(song["id"])
    assert info.status == "error"
    assert "GPU out of memory" in info.error
