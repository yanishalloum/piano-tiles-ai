"""Command-line interface: `piano-tiles-ai <command>`."""

import argparse
import sys


def main() -> None:
    from piano_tiles_ai.paths import HAND_MODEL_PATH

    parser = argparse.ArgumentParser(prog="piano-tiles-ai", description="Piano Tiles AI")
    commands = parser.add_subparsers(dest="command", required=True)

    serve_parser = commands.add_parser("serve", help="start the web app")
    serve_parser.add_argument("--port", type=int, default=8765, help="port to listen on (default: 8765)")

    train_parser = commands.add_parser("train-hands", help="train the hand model on hand-labeled MIDI files")
    train_parser.add_argument("data_dir", help="folder that directly contains the .mid files")
    train_parser.add_argument("--epochs", type=int, default=30, help="training epochs (default: 30)")
    train_parser.add_argument(
        "--augment", type=int, default=3, help="augmented copies of each training piece (default: 3)"
    )
    train_parser.add_argument(
        "--output", default=str(HAND_MODEL_PATH), help=f"where to save the model (default: {HAND_MODEL_PATH})"
    )
    train_parser.add_argument("--force", action="store_true", help="replace an existing model")

    args = parser.parse_args()
    if args.command == "serve":
        from piano_tiles_ai.server import serve

        serve(port=args.port)
    elif args.command == "train-hands":
        from piano_tiles_ai.training import train_and_save

        try:
            train_and_save(args.data_dir, args.output, args.epochs, args.augment, args.force)
        except (FileExistsError, ValueError) as error:
            sys.exit(f"Error: {error}")
