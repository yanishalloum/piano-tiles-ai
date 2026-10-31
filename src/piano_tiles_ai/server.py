"""Web server: serves the visualizer and runs the pipeline on uploaded songs.

Run it with:

    uv run piano-tiles-ai serve

then open http://localhost:8765. The API is documented at /docs.
"""

import tempfile
from concurrent.futures import Executor, ThreadPoolExecutor
from pathlib import Path

from fastapi import FastAPI, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from piano_tiles_ai.library import ALLOWED_SUFFIXES, Library, SongInfo, process_library_song
from piano_tiles_ai.paths import PROJECT_ROOT

WEB_DIR = PROJECT_ROOT / "web"
MAX_UPLOAD_BYTES = 200 * 1024 * 1024  # 200 MB
SONG_FILES = {"song.json", "mix.mp3", "piano.mp3"}
CHUNK_SIZE = 1024 * 1024


def create_app(
    library: Library | None = None,
    process=process_library_song,
    executor: Executor | None = None,
    web_dir: str | Path = WEB_DIR,
) -> FastAPI:
    """Build the web application.

    Args:
        library: Where songs are stored. Defaults to the project's library folder.
        process: Function that processes one library song (replaced in tests).
        executor: Runs the processing in the background. Defaults to a single
            worker thread, so that only one song uses the GPU at a time.
        web_dir: Folder of the visualizer (index.html, app.js, style.css).
    """
    library = library if library is not None else Library()
    executor = executor if executor is not None else ThreadPoolExecutor(max_workers=1)
    app = FastAPI(title="Piano Tiles AI")

    def run(song_id: str) -> None:
        # An exception raised in a background thread is silently lost:
        # catch everything and record it in the song's status.
        try:
            process(library, song_id)
        except Exception as error:
            library.set_status(song_id, "error", error=f"Erreur inattendue : {error}")

    def enqueue(song_id: str) -> None:
        executor.submit(run, song_id)

    def info_or_404(song_id: str) -> SongInfo:
        try:
            info = library.get(song_id)
        except ValueError:
            info = None  # malformed id: answer as if it did not exist
        if info is None:
            raise HTTPException(status_code=404, detail="Morceau introuvable")
        return info

    # Songs left unfinished when the server stopped are processed again.
    for song in library.songs():
        if song.status in ("queued", "processing"):
            library.set_status(song.id, "queued")
            enqueue(song.id)

    @app.get("/api/songs")
    def list_songs() -> list[SongInfo]:
        """All songs, most recent first."""
        return library.songs()

    @app.get("/api/songs/{song_id}")
    def get_song(song_id: str) -> SongInfo:
        """One song, with its processing status."""
        return info_or_404(song_id)

    @app.post("/api/songs", status_code=202)
    def upload_song(file: UploadFile, title: str = Form("")) -> SongInfo:
        """Add an audio file to the library and start processing it."""
        filename = file.filename or ""
        suffix = Path(filename).suffix.lower()
        if suffix not in ALLOWED_SUFFIXES:
            allowed = ", ".join(sorted(ALLOWED_SUFFIXES))
            raise HTTPException(status_code=415, detail=f"Format non pris en charge. Formats acceptés : {allowed}")

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / f"upload{suffix}"
            size = 0
            with open(path, "wb") as out:
                while chunk := file.file.read(CHUNK_SIZE):
                    size += len(chunk)
                    if size > MAX_UPLOAD_BYTES:
                        raise HTTPException(status_code=413, detail="Fichier trop volumineux (200 Mo maximum)")
                    out.write(chunk)

            known = {song.id for song in library.songs()}
            info = library.add(path, title or Path(filename).stem)

        if info.id not in known:
            enqueue(info.id)
        return info

    @app.delete("/api/songs/{song_id}", status_code=204)
    def delete_song(song_id: str) -> None:
        """Delete a song and its files."""
        info = info_or_404(song_id)
        if info.status in ("queued", "processing"):
            raise HTTPException(status_code=409, detail="Le morceau est en cours de traitement")
        library.delete(song_id)

    @app.get("/api/songs/{song_id}/files/{name}")
    def song_file(song_id: str, name: str) -> FileResponse:
        """One of the files read by the visualizer (song.json, mix.mp3 or piano.mp3)."""
        info = info_or_404(song_id)
        if name not in SONG_FILES or info.status != "ready":
            raise HTTPException(status_code=404, detail="Fichier introuvable")
        return FileResponse(library.folder(song_id) / name)

    # Everything else is the visualizer itself. Mounted last: API routes come first.
    app.mount("/", StaticFiles(directory=web_dir, html=True), name="web")
    return app


def serve(host: str = "127.0.0.1", port: int = 8765) -> None:
    """Start the server (blocks until Ctrl + C)."""
    import uvicorn

    uvicorn.run(create_app(), host=host, port=port)

