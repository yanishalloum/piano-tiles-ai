"""Command-line interface: `piano-tiles-ai <command>`."""

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(prog="piano-tiles-ai", description="Piano Tiles AI")
    commands = parser.add_subparsers(dest="command", required=True)

    serve_parser = commands.add_parser("serve", help="start the web app")
    serve_parser.add_argument("--port", type=int, default=8765, help="port to listen on (default: 8765)")

    args = parser.parse_args()
    if args.command == "serve":
        from piano_tiles_ai.server import serve

        serve(port=args.port)
