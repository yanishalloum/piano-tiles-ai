"""Assign each note to the left or right hand."""

from dataclasses import replace

from piano_tiles_ai.notes import Note

from bisect import bisect_left, bisect_right
from statistics import mean

MIDDLE_C = 60


def assign_hands_by_split(notes: list[Note], split: int = MIDDLE_C) -> list[Note]:
    """Baseline: notes below `split` go to the left hand, the others to the right.

    Args:
        notes: Notes to label. They are not modified.
        split: MIDI pitch of the lowest right-hand note (60 = middle C).

    Returns:
        New Note objects with their `hand` field set.
    """
    return [replace(n, hand="left" if n.pitch < split else "right") for n in notes]

def _two_means_split(pitches: list[int], min_spread: int, n_iter: int = 20) -> float:
    """Return the boundary between a low and a high group of pitches.

    Uses 1-D k-means with two clusters. If the pitches span less than
    `min_spread` semitones, there are no clear groups and middle C is used.
    """
    low, high = min(pitches), max(pitches)
    if high - low < min_spread:
        return MIDDLE_C - 0.5

    for _ in range(n_iter):
        boundary = (low + high) / 2
        lows = [p for p in pitches if p < boundary]
        highs = [p for p in pitches if p >= boundary]
        new_low, new_high = mean(lows), mean(highs)
        if (new_low, new_high) == (low, high):
            break
        low, high = new_low, new_high

    return (low + high) / 2


def assign_hands_by_clustering(
    notes: list[Note],
    window: float = 2.0,
    min_spread: int = 12,
) -> list[Note]:
    """Assign hands with a boundary that follows the music over time.

    For each note, the pitches of all notes starting within `window` seconds
    before or after it are split into a low and a high group (1-D k-means).
    The note goes to the left hand if it lies below the boundary.

    Args:
        notes: Notes sorted by start time. They are not modified.
        window: Half-width of the time window, in seconds.
        min_spread: Minimum pitch range (in semitones) to look for two groups.

    Returns:
        New Note objects with their `hand` field set.

    Raises:
        ValueError: If the notes are not sorted by start time.
    """
    starts = [n.start for n in notes]
    if starts != sorted(starts):
        raise ValueError("Notes must be sorted by start time")

    result = []
    for note in notes:
        lo = bisect_left(starts, note.start - window)
        hi = bisect_right(starts, note.start + window)
        pitches = [n.pitch for n in notes[lo:hi]]
        boundary = _two_means_split(pitches, min_spread)
        result.append(replace(note, hand="left" if note.pitch < boundary else "right"))
    return result