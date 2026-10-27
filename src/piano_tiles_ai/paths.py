"""Absolute paths of the project folders, independent of the current directory."""

from pathlib import Path

# This file is src/piano_tiles_ai/paths.py: the project root is two levels above its folder.
PROJECT_ROOT = Path(__file__).resolve().parents[2]

OUTPUTS_DIR = PROJECT_ROOT / "outputs"
MODELS_DIR = PROJECT_ROOT / "models"
HAND_MODEL_PATH = MODELS_DIR / "hand_lstm.pt"