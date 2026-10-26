"""Note events: the shared representation used by the rest of the pipeline."""

from dataclasses import dataclass
from pathlib import Path

import pretty_midi

from typing import Literal
Hand = Literal["left", "right"]

@dataclass(frozen=True)
class Note:
    """A single piano note.

    Attributes:
        pitch: MIDI note number (21 = A0, 60 = C4, 108 = C8).
        start: Onset time in seconds.
        end: Offset time in seconds.
        velocity: Key velocity, from 1 (softest) to 127 (loudest).
        hand: "left" or "right" once the hands have been assigned, otherwise None
    """

    pitch: int
    start: float
    end: float
    velocity: int
    hand: Hand | None = None

    @property
    def duration(self) -> float:
        """Length of the note in seconds."""
        return self.end - self.start


def load_notes(path: str | Path) -> list[Note]:
    """Read all non-drum notes from a MIDI file, sorted by onset time.

    Args:
        path: Path to a MIDI file.

    Returns:
        The notes, sorted by start time, then by pitch.

    Raises:
        FileNotFoundError: If path does not exist.
    """
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"MIDI file not found: {path}")

    midi = pretty_midi.PrettyMIDI(str(path))
    notes = [
        Note(pitch=n.pitch, start=n.start, end=n.end, velocity=n.velocity)
        for instrument in midi.instruments
        if not instrument.is_drum
        for n in instrument.notes
    ]
    return sorted(notes, key=lambda note: (note.start, note.pitch))

TRACK_NAMES = {"right": "Piano right", "left": "Piano left", None: "Piano"}


def save_notes_as_midi(notes: list[Note], path: str | Path) -> Path:
    """Write notes to a MIDI file, with one track per hand.

    Right-hand and left-hand notes go to tracks named "Piano right" and
    "Piano left", the same convention as piano-midi.de. Notes without a hand
    go to a track named "Piano".

    Returns:
        The path of the written file.
    """
    tracks = {}
    for note in notes:
        if note.hand not in tracks:
            tracks[note.hand] = pretty_midi.Instrument(program=0, name=TRACK_NAMES[note.hand])
        tracks[note.hand].notes.append(
            pretty_midi.Note(velocity=note.velocity, pitch=note.pitch, start=note.start, end=note.end)
        )

    midi = pretty_midi.PrettyMIDI()
    for hand in ("right", "left", None):
        if hand in tracks:
            midi.instruments.append(tracks[hand])

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    midi.write(str(path))
    return path