"""Load MIDI files whose tracks are labeled by hand, to evaluate and train hand assignment."""

from dataclasses import replace
from pathlib import Path

import pretty_midi

from piano_tiles_ai.notes import Hand, Note

import hashlib
from typing import Literal

Split = Literal["train", "val", "test"]

def _hand_from_track_name(name: str) -> Hand | None:
    """Return the hand named in a track name, or None if it names neither."""
    lowered = name.lower()
    if "right" in lowered:
        return "right"
    if "left" in lowered:
        return "left"
    return None


def load_hand_labeled_notes(path: str | Path) -> list[Note]:
    """Read a MIDI file with one track per hand and return hand-labeled notes.

    Each track is identified by its name, which must contain "right" or "left".

    Args:
        path: Path to the MIDI file.

    Returns:
        The labeled notes, sorted by start time, then by pitch.

    Raises:
        FileNotFoundError: If path does not exist.
        ValueError: If a track with notes names no hand, or if the file does
            not contain both a left-hand and a right-hand track.
    """
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"MIDI file not found: {path}")

    midi = pretty_midi.PrettyMIDI(str(path))
    track_names = [inst.name for inst in midi.instruments]
    notes = []
    hands_found = set()

    for instrument in midi.instruments:
        if instrument.is_drum or not instrument.notes:
            continue
        hand = _hand_from_track_name(instrument.name)
        if hand is None:
            raise ValueError(f"{path.name}: track {instrument.name!r} names no hand ({track_names})")
        hands_found.add(hand)
        notes.extend(
            Note(pitch=n.pitch, start=n.start, end=n.end, velocity=n.velocity, hand=hand)
            for n in instrument.notes
        )

    if hands_found != {"left", "right"}:
        raise ValueError(f"{path.name}: expected a left and a right track, found {track_names}")

    return sorted(notes, key=lambda note: (note.start, note.pitch))


def strip_hands(notes: list[Note]) -> list[Note]:
    """Return copies of the notes with their hand removed."""
    return [replace(n, hand=None) for n in notes]

def split_for(path: str | Path, val_fraction: float = 0.15, test_fraction: float = 0.15) -> Split:
    """Return the dataset split ("train", "val" or "test") of a file.

    The split is derived from a hash of the file name, so a file always lands
    in the same split, even when other files are added to the dataset.

    Args:
        path: Path to the file. Only its name is used.
        val_fraction: Approximate fraction of files in the validation split.
        test_fraction: Approximate fraction of files in the test split.
    """
    digest = hashlib.sha256(Path(path).name.encode("utf-8")).hexdigest()
    position = int(digest[:8], 16) / 0xFFFFFFFF
    if position < test_fraction:
        return "test"
    if position < test_fraction + val_fraction:
        return "val"
    return "train"

def load_split(data_dir: str | Path, split: Split) -> list[list[Note]]:
    """Load every usable hand-labeled piece of one split.

    Files that cannot be used (for example, voices stored on separate tracks)
    are skipped.
    """
    pieces = []
    for path in sorted(Path(data_dir).glob("*.mid")):
        if split_for(path) != split:
            continue
        try:
            pieces.append(load_hand_labeled_notes(path))
        except ValueError:
            continue
    return pieces