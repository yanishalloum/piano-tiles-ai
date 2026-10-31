"""Tests for piano_tiles_ai.cli."""

import pytest

from piano_tiles_ai import cli


def test_serve_command_starts_the_server(monkeypatch):
    calls = []
    monkeypatch.setattr("piano_tiles_ai.server.serve", lambda port: calls.append(port))
    monkeypatch.setattr("sys.argv", ["piano-tiles-ai", "serve", "--port", "9000"])
    cli.main()
    assert calls == [9000]


def test_a_command_is_required(monkeypatch):
    monkeypatch.setattr("sys.argv", ["piano-tiles-ai"])
    with pytest.raises(SystemExit):
        cli.main()