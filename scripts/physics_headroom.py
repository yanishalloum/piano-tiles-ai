"""How much could the physical rules improve the hand model?

For each validation piece, we predict the hands with the LSTM, then look at
which errors break a physical rule. Only those errors can be found by the
rules: their share is an upper bound on what the rules can gain.

Usage (from the project root):

    uv run python scripts/physics_headroom.py data/piano-midi
"""

import argparse
from pathlib import Path

from piano_tiles_ai.hand_data import load_split, strip_hands
from piano_tiles_ai.hand_model import assign_hands_with_model, load_hand_model
from piano_tiles_ai.paths import HAND_MODEL_PATH
from piano_tiles_ai.physics import RULES


def sort_key(note):
    return (note.start, note.pitch, note.end)


def percent(part: int, whole: int) -> str:
    return f"{100 * part / whole:5.1f} %" if whole else "    -"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("data_dir", type=Path, help="folder of the hand-labeled MIDI files")
    parser.add_argument("--split", default="val", help="val (default) or test")
    args = parser.parse_args()

    model = load_hand_model(HAND_MODEL_PATH)
    pieces = load_split(args.data_dir, args.split)
    print(f"{len(pieces)} morceaux ({args.split})")

    total = errors = 0
    caught = {name: 0 for name in RULES} | {"au moins une": 0}
    flagged = {name: 0 for name in RULES} | {"au moins une": 0}
    in_truth = {name: 0 for name in RULES} | {"au moins une": 0}

    for reference in pieces:
        reference = sorted(reference, key=sort_key)
        predicted = sorted(assign_hands_with_model(strip_hands(reference), model), key=sort_key)
        assert len(predicted) == len(reference), "the model changed the number of notes"

        wrong = {i for i, (p, r) in enumerate(zip(predicted, reference)) if p.hand != r.hand}
        total += len(reference)
        errors += len(wrong)

        all_predicted, all_truth = set(), set()
        for name, rule in RULES.items():
            on_predicted = rule(predicted)
            on_truth = rule(reference)
            caught[name] += len(on_predicted & wrong)
            flagged[name] += len(on_predicted)
            in_truth[name] += len(on_truth)
            all_predicted |= on_predicted
            all_truth |= on_truth
        caught["au moins une"] += len(all_predicted & wrong)
        flagged["au moins une"] += len(all_predicted)
        in_truth["au moins une"] += len(all_truth)

    print(f"{total} notes, {errors} erreurs du LSTM, accuracy {percent(total - errors, total)}\n")
    print(f"{'règle':<14}{'vraies mains':>14}{'erreurs repérées':>18}{'repérées = erreur':>19}{'accuracy max':>14}")
    for name in caught:
        print(
            f"{name:<14}"
            f"{percent(in_truth[name], total):>14}"           # rule broken by real pianists?
            f"{percent(caught[name], errors):>18}"            # share of the errors it finds
            f"{percent(caught[name], flagged[name]):>19}"     # how often a flagged note is wrong
            f"{percent(total - errors + caught[name], total):>14}"  # if every found error were fixed
        )


if __name__ == "__main__":
    main()
