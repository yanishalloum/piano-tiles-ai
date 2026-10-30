"""Export hand-labeled notes to the JSON format read by the web visualizer."""

import json
from dataclasses import asdict
from pathlib import Path

from piano_tiles_ai.notes import Note

FORMAT_VERSION = 1

TIME_DECIMALS = 3  # millisecond precision


def song_to_dict(notes: list[Note], title: str) -> dict:
    """Build the JSON-ready description of a song.

    Times are rounded to the millisecond: finer precision is meaningless for
    display and only makes the file larger.
    """
    return {
        "format_version": FORMAT_VERSION,
        "title": title,
        "duration": round(max((n.end for n in notes), default=0.0), TIME_DECIMALS),
        "notes": [
            {
                **asdict(n),
                "start": round(n.start, TIME_DECIMALS),
                "end": round(n.end, TIME_DECIMALS),
            }
            for n in notes
        ],
    }

def save_song_json(notes: list[Note], path: str | Path, title: str) -> Path:
    """Write a song to a JSON file for the web visualizer.

    Returns:
        The path of the written file.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(song_to_dict(notes, title), f, ensure_ascii=False)
    return path