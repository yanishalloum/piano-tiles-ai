"""Turn sequences of notes into numeric arrays for the hand assignment model."""

import numpy as np

from piano_tiles_ai.notes import Note

N_FEATURES = 4


def note_features(notes: list[Note]) -> np.ndarray:
    """Describe each note by a few normalized numbers.

    Features (one row per note):
        0. pitch, centered on middle C: (pitch - 60) / 24
        1. log of the time since the previous note's onset: log(1 + seconds)
        2. log of the duration: log(1 + seconds)
        3. velocity scaled to [0, 1]: velocity / 127

    Args:
        notes: Notes sorted by start time.

    Returns:
        A float32 array of shape (len(notes), N_FEATURES).
    """
    if not notes:
        return np.zeros((0, N_FEATURES), dtype=np.float32)

    pitches = np.array([n.pitch for n in notes], dtype=np.float32)
    starts = np.array([n.start for n in notes], dtype=np.float32)
    durations = np.array([n.duration for n in notes], dtype=np.float32)
    velocities = np.array([n.velocity for n in notes], dtype=np.float32)

    gaps = np.diff(starts, prepend=starts[0])

    features = np.stack(
        [
            (pitches - 60) / 24,
            np.log1p(gaps),
            np.log1p(durations),
            velocities / 127,
        ],
        axis=1,
    )
    return features.astype(np.float32)


def hand_labels(notes: list[Note]) -> np.ndarray:
    """Return 1.0 for right-hand notes and 0.0 for left-hand notes.

    Raises:
        ValueError: If a note has no hand.
    """
    if any(n.hand is None for n in notes):
        raise ValueError("Every note must have a hand to build labels")
    return np.array([1.0 if n.hand == "right" else 0.0 for n in notes], dtype=np.float32)