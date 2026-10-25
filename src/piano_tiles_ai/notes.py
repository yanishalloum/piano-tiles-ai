"""Note events: the shared representation used by the rest of the pipeline."""

from dataclasses import dataclass
from pathlib import Path

import pretty_midi


@dataclass(frozen=True)
class Note:
    """A single piano note.

    Attributes:
        pitch: MIDI note number (21 = A0, 60 = C4, 108 = C8).
        start: Onset time in seconds.
        end: Offset time in seconds.
        velocity: Key velocity, from 1 (softest) to 127 (loudest).
    """

    pitch: int
    start: float
    end: float
    velocity: int

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