""" bi-direction LSTM that assigns each note to left or right hand """

from dataclasses import replace

import torch 
from torch import nn 
from torch.utils.data import DataLoader, Dataset

from piano_tiles_ai.evaluation import evaluate_method
from piano_tiles_ai.hand_features import N_FEATURES, hand_labels, note_features
from piano_tiles_ai.notes import Note

class HandChunks(Dataset):
    """Overlapping fixed-length chunks of consecutive notes, used for training."""

    def __init__(self, pieces: list[list[Note]], chunk_size: int = 128, stride: int = 64):
        self.inputs = []
        self.targets = []
        for piece in pieces:
            features = note_features(piece)
            labels = hand_labels(piece)
            for start in range(0, len(piece) - chunk_size + 1, stride):
                self.inputs.append(features[start:start + chunk_size])
                self.targets.append(labels[start:start + chunk_size])

    def __len__(self) -> int:
        return len(self.inputs)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, torch.Tensor]:
        return torch.from_numpy(self.inputs[index]), torch.from_numpy(self.targets[index])

class HandLSTM(nn.Module):
    """Bidirectional LSTM followed by a linear layer giving one logit per note."""

    def __init__(self, hidden_size: int = 64, num_layers: int = 2, dropout: float = 0.2):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=N_FEATURES,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            bidirectional=True,
            dropout=dropout,
        )
        self.head = nn.Linear(2 * hidden_size, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Map features of shape (batch, notes, N_FEATURES) to logits of shape (batch, notes)."""
        states, _ = self.lstm(x)
        return self.head(states).squeeze(-1)
    
def assign_hands_with_model(notes: list[Note], model: nn.Module) -> list[Note]:
    """Assign hands with a trained model, processing the whole piece at once.

    Args:
        notes: Notes sorted by start time. They are not modified.
        model: A trained hand assignment model.

    Returns:
        New Note objects with their `hand` field set.
    """
    if not notes:
        return []
    device = next(model.parameters()).device
    model.eval()
    with torch.no_grad():
        x = torch.from_numpy(note_features(notes)).unsqueeze(0).to(device)
        probabilities = torch.sigmoid(model(x))[0].cpu().tolist()
    return [replace(n, hand="right" if p >= 0.5 else "left") for n, p in zip(notes, probabilities)]

def train_hand_model(
    train_pieces: list[list[Note]],
    val_pieces: list[list[Note]],
    epochs: int = 30,
    batch_size: int = 64,
    learning_rate: float = 1e-3,
    device: str | None = None,
    seed: int = 0,
) -> tuple[HandLSTM, list[dict]]:
    """Train a HandLSTM and return the version with the best validation accuracy.

    Returns:
        The trained model and the training history (one dict per epoch).
    """
    torch.manual_seed(seed)
    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"

    model = HandLSTM().to(device)
    loader = DataLoader(HandChunks(train_pieces), batch_size=batch_size, shuffle=True)
    optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate)
    loss_fn = nn.BCEWithLogitsLoss()

    best_accuracy, best_state = -1.0, None
    history = []
    for epoch in range(1, epochs + 1):
        model.train()
        total_loss = 0.0
        for inputs, targets in loader:
            inputs, targets = inputs.to(device), targets.to(device)
            optimizer.zero_grad()
            loss = loss_fn(model(inputs), targets)
            loss.backward()
            optimizer.step()
            total_loss += loss.item() * len(inputs)
        train_loss = total_loss / len(loader.dataset)

        def method(notes):
            return assign_hands_with_model(notes, model)

        val_accuracy = evaluate_method(method, val_pieces).accuracy
        history.append({"epoch": epoch, "train_loss": train_loss, "val_accuracy": val_accuracy})
        print(f"epoch {epoch:3d}   train loss {train_loss:.4f}   val accuracy {val_accuracy:.1%}")

        if val_accuracy > best_accuracy:
            best_accuracy = val_accuracy
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}

    model.load_state_dict(best_state)
    return model, history   