"""Web server: serves the visualizer and runs the pipeline on uploaded songs.

Run it with:

    uv run piano-tiles-ai serve

then open http://localhost:8765. The API is documented at /docs.
"""

import hashlib
import re
import tempfile
from concurrent.futures import Executor, ThreadPoolExecutor
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, HttpUrl

from piano_tiles_ai.library import (
    ALLOWED_SUFFIXES,
    BUSY_STATUSES,
    HandCorrection,
    Library,
    SongInfo,
    process_library_song,
)
from piano_tiles_ai.paths import PROJECT_ROOT

WEB_DIR = PROJECT_ROOT / "web"
MAX_UPLOAD_BYTES = 200 * 1024 * 1024  # 200 MB
SONG_FILES = {"song.json", "mix.mp3", "piano.mp3"}
CHUNK_SIZE = 1024 * 1024


# A script or stylesheet of the page, such as src="app.js" or href="style.css".
_ASSET_LINK = re.compile(r'(src|href)="([\w./-]+\.(?:js|css))"')


def versioned_index(web_dir: Path) -> str:
    """index.html, with a version added to each script and stylesheet link.

    src="app.js" becomes src="app.js?v=3f9a1c0b2e". The version is computed
    from the file's content: when app.js changes, its address changes too, so
    no browser can use an old copy, even one stored before any cache header.
    This technique is called "cache busting".
    """
    html = (web_dir / "index.html").read_text(encoding="utf-8")

    def add_version(match: re.Match) -> str:
        attribute, path = match.groups()
        file = web_dir / path
        if not file.is_file():
            return match.group(0)
        version = hashlib.sha256(file.read_bytes()).hexdigest()[:10]
        return f'{attribute}="{path}?v={version}"'

    # Scripts loaded later by app.js (listen.js, listen-worker.js) are not
    # linked here: give the page one version for all of them.
    scripts = hashlib.sha256()
    for script in sorted(web_dir.glob("*.js")):
        scripts.update(script.read_bytes())
    meta = f'<meta name="asset-version" content="{scripts.hexdigest()[:10]}">'
    html = html.replace("</head>", f"  {meta}\n</head>", 1)
    return _ASSET_LINK.sub(add_version, html)


class CorrectionIn(BaseModel):
    """One hand correction sent by the page. Pydantic rejects invalid values."""

    pitch: int = Field(ge=21, le=108)
    start: float = Field(ge=0)
    hand: Literal["left", "right"]


MAX_CORRECTIONS = 50_000


class LinkIn(BaseModel):
    """A link to a video. HttpUrl only accepts http:// and https:// addresses."""

    url: HttpUrl
    title: str = ""


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
            library.set_status(song_id, "error", error=f"Unexpected error: {error}")

    def enqueue(song_id: str) -> None:
        executor.submit(run, song_id)

    def info_or_404(song_id: str) -> SongInfo:
        try:
            info = library.get(song_id)
        except ValueError:
            info = None  # malformed id: answer as if it did not exist
        if info is None:
            raise HTTPException(status_code=404, detail="Song not found")
        return info

    @app.middleware("http")
    async def always_fresh_pages(request, call_next):
        # Without this header, browsers may keep an old app.js for days and
        # never ask the server again. "no-cache" means: check with the server
        # before using the stored copy (an unchanged file costs a tiny 304).
        response = await call_next(request)
        if not request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-cache")
        return response

    # Songs left unfinished when the server stopped are processed again.
    for song in library.songs():
        if song.status in BUSY_STATUSES:
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
            raise HTTPException(status_code=415, detail=f"Unsupported format. Accepted formats: {allowed}")

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / f"upload{suffix}"
            size = 0
            with open(path, "wb") as out:
                while chunk := file.file.read(CHUNK_SIZE):
                    size += len(chunk)
                    if size > MAX_UPLOAD_BYTES:
                        raise HTTPException(status_code=413, detail="File too large (200 MB at most)")
                    out.write(chunk)

            known = {song.id for song in library.songs()}
            info = library.add(path, title or Path(filename).stem)

        if info.id not in known:
            enqueue(info.id)
        return info

    @app.post("/api/songs/from-url", status_code=202)
    def add_link(link: LinkIn) -> SongInfo:
        """Add a YouTube, TikTok... link: the sound is downloaded, then processed."""
        known = {song.id for song in library.songs()}
        info = library.add_url(str(link.url), link.title)
        if info.id not in known:
            enqueue(info.id)
        return info

    @app.delete("/api/songs/{song_id}", status_code=204)
    def delete_song(song_id: str) -> None:
        """Delete a song and its files."""
        info = info_or_404(song_id)
        if info.status in BUSY_STATUSES:
            raise HTTPException(status_code=409, detail="The song is being processed")
        library.delete(song_id)

    @app.get("/api/songs/{song_id}/files/{name}")
    def song_file(song_id: str, name: str) -> FileResponse:
        """One of the files read by the visualizer (song.json, mix.mp3 or piano.mp3)."""
        info = info_or_404(song_id)
        if name not in SONG_FILES or info.status != "ready":
            raise HTTPException(status_code=404, detail="File not found")
        return FileResponse(library.folder(song_id) / name)

    @app.get("/api/songs/{song_id}/corrections")
    def get_corrections(song_id: str) -> list[HandCorrection]:
        """Notes the user moved to the other hand."""
        info_or_404(song_id)
        return library.corrections(song_id)

    @app.put("/api/songs/{song_id}/corrections", status_code=204)
    def put_corrections(song_id: str, corrections: list[CorrectionIn]) -> None:
        """Replace all the hand corrections of a song."""
        info = info_or_404(song_id)
        if info.status != "ready":
            raise HTTPException(status_code=409, detail="The song is not ready yet")
        if len(corrections) > MAX_CORRECTIONS:
            raise HTTPException(status_code=413, detail="Too many corrections")
        library.save_corrections(
            song_id,
            [HandCorrection(pitch=c.pitch, start=round(c.start, 3), hand=c.hand) for c in corrections],
        )

    @app.get("/", include_in_schema=False)
    @app.get("/index.html", include_in_schema=False)
    def index() -> HTMLResponse:
        return HTMLResponse(versioned_index(Path(web_dir)))

    # Everything else is the visualizer itself. Mounted last: API routes come first.
    app.mount("/", StaticFiles(directory=web_dir, html=True), name="web")
    return app


def serve(host: str = "127.0.0.1", port: int = 8765) -> None:
    """Start the server (blocks until Ctrl + C)."""
    import uvicorn

    uvicorn.run(create_app(), host=host, port=port)
