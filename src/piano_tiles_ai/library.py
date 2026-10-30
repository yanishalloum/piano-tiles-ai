"""A song library on disk: every uploaded song gets its own folder.

Layout of the library folder:

    library/
        3f9a1c0b2e7d4a65/       one folder per song, named after its content hash
            info.json           title, status, date (SongInfo)
            original.mp3        the uploaded file, untouched
            song.json           hand-labeled notes, read by the visualizer
            mix.mp3             the full song, for the browser
            piano.mp3           the isolated piano, for the browser
"""

import json
import os
import re
import shutil
import subprocess
import threading
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from piano_tiles_ai.cache import file_hash
from piano_tiles_ai.export import save_song_json
from piano_tiles_ai.paths import PROJECT_ROOT

LIBRARY_DIR = PROJECT_ROOT / "library"
ALLOWED_SUFFIXES = {".mp3", ".wav", ".flac", ".ogg", ".m4a"}

Status = Literal["queued", "processing", "ready", "error"]

_SONG_ID = re.compile(r"[0-9a-f]{16}")


@dataclass(frozen=True)
class SongInfo:
    """What the library knows about one song."""

    id: str
    title: str
    status: Status
    created_at: str
    error: str | None = None


def encode_mp3(source: Path, target: Path, bitrate: str = "192k") -> None:
    """Convert any audio file to MP3 with FFmpeg."""
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(source), "-b:a", bitrate, str(target)],
        check=True,
    )


class Library:
    """Songs stored on disk, one folder per song."""

    def __init__(self, root: str | Path = LIBRARY_DIR):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    # --- Reading -------------------------------------------------------------

    def folder(self, song_id: str) -> Path:
        """Folder of a song.

        Raises:
            ValueError: If song_id is not a valid identifier. This blocks ids
                such as "../../etc" that would escape the library folder.
        """
        if not _SONG_ID.fullmatch(song_id):
            raise ValueError(f"Invalid song id: {song_id!r}")
        return self.root / song_id

    def get(self, song_id: str) -> SongInfo | None:
        """Return the information of a song, or None if it does not exist."""
        path = self.folder(song_id) / "info.json"
        if not path.is_file():
            return None
        with open(path, encoding="utf-8") as f:
            return SongInfo(**json.load(f))

    def songs(self) -> list[SongInfo]:
        """All songs, most recent first."""
        songs = []
        for folder in self.root.iterdir():
            if _SONG_ID.fullmatch(folder.name):
                info = self.get(folder.name)
                if info is not None:
                    songs.append(info)
        return sorted(songs, key=lambda song: song.created_at, reverse=True)

    def original(self, song_id: str) -> Path:
        """Path of the uploaded file of a song."""
        matches = sorted(self.folder(song_id).glob("original.*"))
        if not matches:
            raise FileNotFoundError(f"No original file for song {song_id}")
        return matches[0]

    # --- Writing -------------------------------------------------------------

    def _write_info(self, info: SongInfo) -> None:
        """Write info.json atomically: readers never see a half-written file."""
        folder = self.folder(info.id)
        temporary = folder / "info.json.tmp"
        with open(temporary, "w", encoding="utf-8") as f:
            json.dump(asdict(info), f, ensure_ascii=False)
        os.replace(temporary, folder / "info.json")

    def add(self, source: str | Path, title: str) -> SongInfo:
        """Copy an audio file into the library and register it as queued.

        If the same audio content was already added, the existing song is
        returned instead of creating a duplicate.

        Raises:
            ValueError: If the file type is not supported.
        """
        source = Path(source)
        suffix = source.suffix.lower()
        if suffix not in ALLOWED_SUFFIXES:
            raise ValueError(f"Unsupported file type: {suffix or 'none'}")

        song_id = file_hash(source)[:16]
        with self._lock:
            existing = self.get(song_id)
            if existing is not None:
                return existing

            folder = self.folder(song_id)
            folder.mkdir()
            shutil.copy(source, folder / f"original{suffix}")
            info = SongInfo(
                id=song_id,
                title=title.strip() or source.stem,
                status="queued",
                created_at=datetime.now(timezone.utc).isoformat(),
            )
            self._write_info(info)
            return info

    def set_status(self, song_id: str, status: Status, error: str | None = None) -> SongInfo:
        """Change the status of a song and return its updated information."""
        with self._lock:
            info = self.get(song_id)
            if info is None:
                raise KeyError(song_id)
            info = replace(info, status=status, error=error)
            self._write_info(info)
            return info

    def delete(self, song_id: str) -> bool:
        """Delete a song and all its files. Returns False if it did not exist."""
        with self._lock:
            folder = self.folder(song_id)
            if not folder.is_dir():
                return False
            shutil.rmtree(folder)
            return True


def process_library_song(
    library: Library,
    song_id: str,
    process=None,
    separate=None,
    encode=encode_mp3,
) -> SongInfo:
    """Run the full pipeline on a library song and write the visualizer files.

    The heavy functions can be replaced (for tests): `process` defaults to
    pipeline.process_song and `separate` to separation.separate_piano.

    Returns:
        The final information of the song, with status "ready" or "error".
    """
    if process is None:
        from piano_tiles_ai.pipeline import process_song as process
    if separate is None:
        from piano_tiles_ai.separation import separate_piano as separate

    info = library.set_status(song_id, "processing")
    folder = library.folder(song_id)
    try:
        original = library.original(song_id)
        notes = process(original)
        save_song_json(notes, folder / "song.json", info.title)
        encode(original, folder / "mix.mp3")
        encode(separate(original), folder / "piano.mp3")  # cached: instant after process()
    except Exception as error:  # report any failure to the user instead of crashing the server
        return library.set_status(song_id, "error", error=str(error))
    return library.set_status(song_id, "ready")
