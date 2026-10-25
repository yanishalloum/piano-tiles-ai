"""Assign each note to the left or right hand."""

from dataclasses import replace

from piano_tiles_ai.notes import Note

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