"""The full pipeline: from a song to hand-labeled piano notes."""

from pathlib import Path

from piano_tiles_ai.hand_model import assign_hands_with_model, load_hand_model
from piano_tiles_ai.notes import Note, load_notes
from piano_tiles_ai.paths import HAND_MODEL_PATH
from piano_tiles_ai.separation import separate_piano
from piano_tiles_ai.transcription import transcribe_piano


def process_song(path: str | Path, hand_model_path: str | Path = HAND_MODEL_PATH) -> list[Note]:
    """Isolate the piano of a song, transcribe it and assign each note to a hand.

    Separation and transcription results are cached, so processing the same
    song again is fast.

    Args:
        path: Path to the song (any format supported by load_audio).
        hand_model_path: Path to the trained hand assignment model.

    Returns:
        Hand-labeled notes, sorted by start time.
    """
    piano_path = separate_piano(path)
    midi_path = transcribe_piano(piano_path)
    notes = load_notes(midi_path)
    model = load_hand_model(hand_model_path)
    return assign_hands_with_model(notes, model)