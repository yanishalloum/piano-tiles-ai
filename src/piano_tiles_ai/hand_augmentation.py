"""Data augmentation for hand assignment: realistic variations of labeled pieces."""

import random
from dataclasses import replace

from piano_tiles_ai.notes import Note

LOWEST_KEY, HIGHEST_KEY = 21, 108


def augment_piece(
    notes: list[Note],
    rng: random.Random,
    max_transpose: int = 6,
    tempo_range: tuple[float, float] = (0.8, 1.25),
    velocity_shift: int = 15,
    drop_probability: float = 0.03,
    onset_jitter: float = 0.01,
) -> list[Note]:
    """Return a randomly modified copy of a hand-labeled piece.

    Hands are kept: transposing, changing the tempo or the dynamics, and
    small timing errors do not change which hand plays a note.

    Args:
        notes: Hand-labeled notes. They are not modified.
        rng: Random number generator, for reproducible augmentation.
        max_transpose: Maximum transposition, in semitones (up or down).
        tempo_range: Range of the time scaling factor (above 1 = slower).
        velocity_shift: Maximum change of all velocities.
        drop_probability: Probability of removing each note.
        onset_jitter: Maximum random shift of each onset, in seconds.

    Returns:
        New notes, sorted by start time then pitch.
    """
    if not notes:
        return []

    # One random choice for the whole piece.
    lowest = min(n.pitch for n in notes)
    highest = max(n.pitch for n in notes)
    transpose = rng.randint(
        max(-max_transpose, LOWEST_KEY - lowest),
        min(max_transpose, HIGHEST_KEY - highest),
    )
    tempo = rng.uniform(*tempo_range)
    shift = rng.randint(-velocity_shift, velocity_shift)

    # Then small random changes note by note.
    augmented = []
    for n in notes:
        if rng.random() < drop_probability:
            continue
        start = max(0.0, n.start * tempo + rng.uniform(-onset_jitter, onset_jitter))
        augmented.append(replace(
            n,
            pitch=n.pitch + transpose,
            start=start,
            end=start + n.duration * tempo,
            velocity=min(127, max(1, n.velocity + shift)),
        ))
    return sorted(augmented, key=lambda note: (note.start, note.pitch))