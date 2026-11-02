"""Train the hand model from a folder of hand-labeled MIDI files.

Used by the command `piano-tiles-ai train-hands`.
"""

from pathlib import Path


def save_model(model, path: Path) -> None:
    """Save the weights only (state_dict): smaller, and independent of the code layout."""
    import torch

    torch.save(model.state_dict(), path)


def train_and_save(
    data_dir: str | Path,
    output: str | Path,
    epochs: int = 30,
    augment_copies: int = 3,
    force: bool = False,
    load=None,
    train=None,
    save=save_model,
) -> float:
    """Train on the train split, keep the best epoch on the validation split, save it.

    The heavy functions can be replaced (for tests): `load` defaults to
    hand_data.load_split and `train` to hand_model.train_hand_model.

    Returns:
        The best validation accuracy.

    Raises:
        FileExistsError: If `output` exists and `force` is False, so that a
            trained model is never overwritten by mistake.
        ValueError: If the folder holds no usable piece for a split.
    """
    data_dir, output = Path(data_dir), Path(output)
    if output.exists() and not force:
        raise FileExistsError(f"{output} already exists (use --force to replace it)")
    if load is None:
        from piano_tiles_ai.hand_data import load_split as load
    if train is None:
        from piano_tiles_ai.hand_model import train_hand_model as train

    train_pieces, val_pieces = load(data_dir, "train"), load(data_dir, "val")
    if not train_pieces or not val_pieces:
        raise ValueError(f"No usable MIDI file in {data_dir}: the .mid files must be directly in this folder")
    print(f"{len(train_pieces)} training pieces, {len(val_pieces)} validation pieces")

    model, history = train(train_pieces, val_pieces, epochs=epochs, augment_copies=augment_copies)
    output.parent.mkdir(parents=True, exist_ok=True)
    save(model, output)
    best = max(epoch["val_accuracy"] for epoch in history)
    print(f"Best validation accuracy: {best:.1%}. Model saved to {output}")
    return best
