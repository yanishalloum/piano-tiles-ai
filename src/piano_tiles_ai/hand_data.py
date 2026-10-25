"""Load MIDI files whose tracks are labeled by hand, to evaluate and train hand assignment."""

from dataclasses import replace
from pathlib import Path

import pretty_midi

from piano_tiles_ai.notes import Hand, Note


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