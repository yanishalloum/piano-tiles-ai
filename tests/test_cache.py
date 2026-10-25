"""Tests for piano_tiles_ai.cache."""

from piano_tiles_ai.cache import file_hash


def test_hash_depends_on_content_not_name(tmp_path):
    a = tmp_path / "a.bin"
    b = tmp_path / "b.bin"
    c = tmp_path / "c.bin"
    a.write_bytes(b"hello")
    b.write_bytes(b"hello")
    c.write_bytes(b"world")
    assert file_hash(a) == file_hash(b)
    assert file_hash(a) != file_hash(c)