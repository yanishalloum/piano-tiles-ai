"""A song library on disk: every uploaded song gets its own folder.

Layout of the library folder:

    library/
        3f9a1c0b2e7d4a65/       one folder per song, named after its content hash
            info.json           title, status, date (SongInfo)
            original.mp3        the uploaded or downloaded file, untouched
            audio.flac          the sound of a video (only for videos)
            song.json           hand-labeled notes, read by the visualizer
            mix.mp3             the full song, for the browser
            piano.mp3           the isolated piano, for the browser
            corrections.json    notes moved to the other hand by the user
"""

import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from piano_tiles_ai.cache import file_hash
from piano_tiles_ai.export import save_song_json
from piano_tiles_ai.paths import PROJECT_ROOT

LIBRARY_DIR = PROJECT_ROOT / "library"
AUDIO_SUFFIXES = {".mp3", ".wav", ".flac", ".ogg", ".m4a"}
VIDEO_SUFFIXES = {".mp4", ".mov", ".webm", ".mkv"}
ALLOWED_SUFFIXES = AUDIO_SUFFIXES | VIDEO_SUFFIXES
MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024  # 200 MB, as for uploads

Status = Literal["queued", "downloading", "processing", "ready", "error"]
BUSY_STATUSES = ("queued", "downloading", "processing")

_SONG_ID = re.compile(r"[0-9a-f]{16}")


@dataclass(frozen=True)
class HandCorrection:
    """A note moved to the other hand by the user.

    The note is identified by its pitch and start time (rounded to the
    millisecond, as in song.json), not by its position in the list.
    """

    pitch: int
    start: float
    hand: Literal["left", "right"]


@dataclass(frozen=True)
class SongInfo:
    """What the library knows about one song."""

    id: str
    title: str
    status: Status
    created_at: str
    error: str | None = None
    source_url: str | None = None  # set for songs added from a link


def extract_audio(video: Path, target: Path) -> None:
    """Keep only the sound of a video, without loss (FLAC)."""
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(video), "-vn", "-c:a", "flac", str(target)],
        check=True,
    )


def download_audio(url: str, folder: Path) -> tuple[Path, str | None]:
    """Download the sound of a YouTube, TikTok... video with yt-dlp.

    Returns:
        The downloaded file (original.<ext>) and the title of the video.
    """
    from yt_dlp import YoutubeDL  # imported here: only needed for links

    options = {
        "format": "bestaudio/best",  # the audio track alone when the site offers it
        "outtmpl": str(folder / "original.%(ext)s"),
        "noplaylist": True,  # a link inside a playlist: only this video
        "max_filesize": MAX_DOWNLOAD_BYTES,
        "quiet": True,
        "no_warnings": True,
    }
    from yt_dlp.utils import DownloadError

    try:
        with YoutubeDL(options) as downloader:
            info = downloader.extract_info(url, download=True)
            path = Path(downloader.prepare_filename(info))
    except DownloadError as error:
        # yt-dlp messages start with "ERROR: [site] id:"; keep the readable end.
        reason = str(error).removeprefix("ERROR: ").split(": ", 1)[-1].split("; please report")[0]
        raise RuntimeError(f"Download failed: {reason}") from None
    if not path.is_file():
        raise RuntimeError("The download produced no file (video too large?)")
    return path, info.get("title")


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

    def original(self, song_id: str) -> Path | None:
        """Path of the uploaded or downloaded file of a song (None if not downloaded yet)."""
        matches = sorted(p for p in self.folder(song_id).glob("original.*") if not p.name.endswith(".part"))
        return matches[0] if matches else None

    # --- Writing -------------------------------------------------------------

    @staticmethod
    def _write_json(path: Path, data) -> None:
        """Write a JSON file atomically: readers never see a half-written file."""
        temporary = path.with_name(path.name + ".tmp")
        with open(temporary, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(temporary, path)

    def _write_info(self, info: SongInfo) -> None:
        self._write_json(self.folder(info.id) / "info.json", asdict(info))

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
                created_at=datetime.now(UTC).isoformat(),
            )
            self._write_info(info)
            return info

    def add_url(self, url: str, title: str = "") -> SongInfo:
        """Register a link to download (YouTube, TikTok...) as a queued song.

        The content is not known before the download, so the identifier comes
        from the link itself: the same link is never added twice.
        """
        song_id = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
        with self._lock:
            existing = self.get(song_id)
            if existing is not None:
                return existing
            self.folder(song_id).mkdir()
            info = SongInfo(
                id=song_id,
                title=title.strip() or url,
                status="queued",
                created_at=datetime.now(UTC).isoformat(),
                source_url=url,
            )
            self._write_info(info)
            return info

    def _update(self, song_id: str, **changes) -> SongInfo:
        with self._lock:
            info = self.get(song_id)
            if info is None:
                raise KeyError(song_id)
            info = replace(info, **changes)
            self._write_info(info)
            return info

    def set_status(self, song_id: str, status: Status, error: str | None = None) -> SongInfo:
        """Change the status of a song and return its updated information."""
        return self._update(song_id, status=status, error=error)

    def rename(self, song_id: str, title: str) -> SongInfo:
        """Change the title of a song."""
        return self._update(song_id, title=title)

    def corrections(self, song_id: str) -> list[HandCorrection]:
        """Hand corrections made by the user (empty if there are none)."""
        path = self.folder(song_id) / "corrections.json"
        if not path.is_file():
            return []
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return [HandCorrection(**item) for item in data["corrections"]]

    def save_corrections(self, song_id: str, corrections: list[HandCorrection]) -> None:
        """Replace the hand corrections of a song.

        They are stored apart from song.json, so the model's own predictions
        are kept: we can always compare them with the user's corrections.
        """
        data = {"format_version": 1, "corrections": [asdict(c) for c in corrections]}
        with self._lock:
            self._write_json(self.folder(song_id) / "corrections.json", data)

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
    download=download_audio,
    extract=extract_audio,
) -> SongInfo:
    """Run the full pipeline on a library song and write the visualizer files.

    Steps: download the link (if any), take the sound out of a video (if it
    is one), find the notes, then encode the two MP3 files for the browser.

    The heavy functions can be replaced (for tests): `process` defaults to
    pipeline.process_song and `separate` to separation.separate_piano.

    Returns:
        The final information of the song, with status "ready" or "error".
    """
    info = library.get(song_id)
    folder = library.folder(song_id)
    try:
        original = library.original(song_id)
        if original is None:  # a link that was not downloaded yet
            library.set_status(song_id, "downloading")
            original, video_title = download(info.source_url, folder)
            if video_title and info.title == info.source_url:
                info = library.rename(song_id, video_title)

        info = library.set_status(song_id, "processing")
        audio = original
        if original.suffix.lower() not in AUDIO_SUFFIXES:  # a video, or a format we do not read
            audio = folder / "audio.flac"
            extract(original, audio)

        # Imported here, inside the try: if loading the models fails, the song
        # is marked as failed instead of staying "processing" forever.
        if process is None:
            from piano_tiles_ai.pipeline import process_song as process
        if separate is None:
            from piano_tiles_ai.separation import separate_piano as separate

        notes = process(audio)
        save_song_json(notes, folder / "song.json", info.title)
        encode(audio, folder / "mix.mp3")
        encode(separate(audio), folder / "piano.mp3")  # cached: instant after process()
    except Exception as error:  # report any failure to the user instead of crashing the server
        return library.set_status(song_id, "error", error=str(error))
    return library.set_status(song_id, "ready")
