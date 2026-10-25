"""Metrics to evaluate hand assignment."""

from dataclasses import dataclass

from piano_tiles_ai.notes import Note


@dataclass(frozen=True)
class HandScores:
    """Hand assignment scores, all between 0 and 1 except n_notes."""

    n_notes: int
    accuracy: float
    left_precision: float
    left_recall: float
    right_precision: float
    right_recall: float


def _safe_div(numerator: int, denominator: int) -> float:
    """Divide, returning 0.0 instead of failing when the denominator is 0."""
    return numerator / denominator if denominator else 0.0


def score_hands(predicted: list[Note], reference: list[Note]) -> HandScores:
    """Compare predicted hands to reference hands, note by note.

    Both lists must contain the same notes in the same order; only their
    `hand` field may differ.

    Raises:
        ValueError: If the two lists do not contain the same notes.
    """
    if len(predicted) != len(reference):
        raise ValueError(f"{len(predicted)} predicted notes but {len(reference)} reference notes")
    for p, r in zip(predicted, reference):
        if (p.pitch, p.start) != (r.pitch, r.start):
            raise ValueError("Predicted and reference notes do not match")

    pairs = [(p.hand, r.hand) for p, r in zip(predicted, reference)]

    def count(pred: str, true: str) -> int:
        return sum(p == pred and r == true for p, r in pairs)

    left_left = count("left", "left")
    left_right = count("left", "right")
    right_left = count("right", "left")
    right_right = count("right", "right")

    return HandScores(
        n_notes=len(pairs),
        accuracy=_safe_div(left_left + right_right, len(pairs)),
        left_precision=_safe_div(left_left, left_left + left_right),
        left_recall=_safe_div(left_left, left_left + right_left),
        right_precision=_safe_div(right_right, right_right + right_left),
        right_recall=_safe_div(right_right, right_right + left_right),
    )