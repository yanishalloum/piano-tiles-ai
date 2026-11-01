"""Physical rules of piano playing, used to find impossible hand assignments.

Three simple rules, all checked on the notes of one hand:

1. Chord: a hand plays at most 5 notes at once, spread over at most
   about 16 semitones (a large hand reaches a tenth, i.e. 16 or 17).
2. Crossing: at a given moment, the left hand is below the right hand.
   Real pieces sometimes cross hands, so this rule has exceptions.
3. Jump: a hand cannot move more than two octaves in less than 120 ms.

These are only the instantaneous, "hard" rules. The models in the papers
(Parncutt 1997, Nakamura 2014) go further: they give a cost to every
movement between two hand positions, instead of a yes/no answer.
"""

from collections.abc import Iterable

from piano_tiles_ai.notes import Note

CHORD_WINDOW = 0.03      # s: notes starting this close together form a chord
MAX_NOTES_PER_HAND = 5   # five fingers
MAX_CHORD_SPAN = 16      # semitones: a tenth, reachable by large hands
MAX_JUMP = 24            # semitones: two octaves
MIN_JUMP_TIME = 0.12     # s: below this, a jump larger than MAX_JUMP is impossible


def chord_groups(notes: list[Note]) -> list[list[int]]:
    """Indices of the notes, grouped by onset (notes struck together)."""
    order = sorted(range(len(notes)), key=lambda i: notes[i].start)
    groups: list[list[int]] = []
    for i in order:
        if groups and notes[i].start - notes[groups[-1][0]].start <= CHORD_WINDOW:
            groups[-1].append(i)
        else:
            groups.append([i])
    return groups


def _hand_part(notes: list[Note], group: Iterable[int], hand: str) -> list[int]:
    return [i for i in group if notes[i].hand == hand]


def chord_violations(notes: list[Note]) -> set[int]:
    """Notes in a chord that one hand cannot play (too many notes or too wide)."""
    flagged = set()
    for group in chord_groups(notes):
        for hand in ("left", "right"):
            part = _hand_part(notes, group, hand)
            pitches = [notes[i].pitch for i in part]
            if len(part) > MAX_NOTES_PER_HAND or (pitches and max(pitches) - min(pitches) > MAX_CHORD_SPAN):
                flagged.update(part)
    return flagged


def crossing_violations(notes: list[Note]) -> set[int]:
    """Notes of a chord where the left hand plays above the right hand."""
    flagged = set()
    for group in chord_groups(notes):
        left = _hand_part(notes, group, "left")
        right = _hand_part(notes, group, "right")
        if not left or not right:
            continue
        highest_left = max(notes[i].pitch for i in left)
        lowest_right = min(notes[i].pitch for i in right)
        if highest_left > lowest_right:
            flagged.update(i for i in left if notes[i].pitch > lowest_right)
            flagged.update(i for i in right if notes[i].pitch < highest_left)
    return flagged


def jump_violations(notes: list[Note]) -> set[int]:
    """Notes where a hand would jump more than two octaves in less than 120 ms.

    The position of a hand at an onset is the average pitch of its notes.
    """
    flagged = set()
    groups = chord_groups(notes)
    for hand in ("left", "right"):
        previous: list[int] | None = None
        for group in groups:
            part = _hand_part(notes, group, hand)
            if not part:
                continue
            if previous is not None:
                gap = notes[part[0]].start - notes[previous[0]].start
                center = sum(notes[i].pitch for i in part) / len(part)
                previous_center = sum(notes[i].pitch for i in previous) / len(previous)
                if gap < MIN_JUMP_TIME and abs(center - previous_center) > MAX_JUMP:
                    flagged.update(part)
                    flagged.update(previous)
            previous = part
    return flagged


RULES = {
    "accord": chord_violations,
    "croisement": crossing_violations,
    "saut": jump_violations,
}
