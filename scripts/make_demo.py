"""Build the song of the online demo: Bach, Prelude in C major BWV 846, bars 1-11.

The notes are written here by hand, with the real hands: two notes for the
left hand and three for the right hand in each bar, played as the pattern
1 2 3 4 5 3 4 5, twice per bar. They are rendered with the samples of the
Salamander Grand Piano (Alexander Holm, CC BY 3.0).

Everything is free to publish: the composition is in the public domain and
the samples allow it with credit.

Usage (from the project root):

    uv run python scripts/make_demo.py

writes web/demo/songs.json and web/demo/bach-846/{song.json, mix.mp3}.
"""

import json
import subprocess
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DEMO_DIR = ROOT / "web" / "demo"
SONG_ID = "bach-846"
TITLE = "Prelude in C major, BWV 846"
SAMPLE_RATE = 48000
SAMPLES_URL = "https://raw.githubusercontent.com/Tonejs/audio/master/salamander/{name}.mp3"
CACHE_DIR = Path.home() / ".cache" / "piano-tiles-ai" / "salamander"

STEPS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
BARS = [  # (left hand, right hand)
    ("C4 E4", "G4 C5 E5"),
    ("C4 D4", "A4 D5 F5"),
    ("B3 D4", "G4 D5 F5"),
    ("C4 E4", "G4 C5 E5"),
    ("C4 E4", "A4 E5 A5"),
    ("C4 D4", "F#4 A4 D5"),
    ("B3 D4", "G4 D5 G5"),
    ("B3 C4", "E4 G4 C5"),
    ("A3 C4", "E4 G4 C5"),
    ("D3 A3", "D4 F#4 C5"),
    ("G3 B3", "D4 G4 B4"),
]
SIXTEENTH = 60 / 66 / 4  # seconds, quarter note = 66


def pitch(name: str) -> int:
    """MIDI number of a note name such as "F#4" (middle C = C4 = 60)."""
    return 12 * (int(name[-1]) + 1) + STEPS[name[0]] + (1 if "#" in name else 0)


def bach_notes() -> list[dict]:
    notes = []
    time = 0.5
    for left, right in BARS:
        bass, tenor = map(pitch, left.split())
        upper = list(map(pitch, right.split()))
        for half in range(2):
            start = time + half * 8 * SIXTEENTH
            end = start + 8 * SIXTEENTH
            notes.append(dict(pitch=bass, start=start, end=end, velocity=62, hand="left"))
            notes.append(dict(pitch=tenor, start=start + SIXTEENTH, end=end, velocity=58, hand="left"))
            for i, p in enumerate(upper + upper):
                onset = start + (2 + i) * SIXTEENTH
                velocity = 70 if i % 3 == 0 else 60
                notes.append(
                    dict(pitch=p, start=onset, end=onset + 1.6 * SIXTEENTH, velocity=velocity, hand="right")
                )
        time += 16 * SIXTEENTH
    for note in notes:
        note["start"], note["end"] = round(note["start"], 3), round(note["end"], 3)
    return sorted(notes, key=lambda n: (n["start"], n["pitch"]))


def decode(path: Path) -> np.ndarray:
    raw = subprocess.run(
        [
            "ffmpeg",
            "-loglevel",
            "error",
            "-i",
            str(path),
            "-ac",
            "1",
            "-ar",
            str(SAMPLE_RATE),
            "-f",
            "f32le",
            "-",
        ],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, np.float32)


def load_samples() -> dict[int, np.ndarray]:
    """One sample every minor third (A, C, D#, F#), downloaded once into a cache folder."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    samples = {}
    for midi in range(21, 109):
        names = {0: "C", 3: "Ds", 6: "Fs", 9: "A"}
        if midi % 12 not in names:
            continue
        name = f"{names[midi % 12]}{midi // 12 - 1}"
        path = CACHE_DIR / f"{name}.mp3"
        if not path.exists():
            print(f"downloading {name}")
            urllib.request.urlretrieve(SAMPLES_URL.format(name=name), path)
        samples[midi] = decode(path)
    return samples


def render(notes: list[dict], duration: float, samples: dict[int, np.ndarray]) -> np.ndarray:
    """Play each note with the nearest sample, shifted to the right pitch by resampling."""
    out = np.zeros(int((duration + 3) * SAMPLE_RATE), np.float32)
    keys = np.array(sorted(samples))
    release = int(0.3 * SAMPLE_RATE)
    for note in notes:
        base = int(keys[np.argmin(abs(keys - note["pitch"]))])
        sample = samples[base]
        ratio = 2 ** ((note["pitch"] - base) / 12)
        length = int((note["end"] - note["start"] + 0.3) * SAMPLE_RATE)
        positions = np.arange(length) * ratio
        positions = positions[positions < len(sample) - 1]
        sound = np.interp(positions, np.arange(len(sample)), sample).astype(np.float32)
        envelope = np.ones(len(sound), np.float32)
        if len(sound) > release:
            envelope[-release:] = np.linspace(1, 0, release)  # the damper falls
        sound *= envelope * note["velocity"] / 100
        start = int(note["start"] * SAMPLE_RATE)
        out[start : start + len(sound)] += sound[: len(out) - start]
    return out / np.max(np.abs(out)) * 0.8


def main() -> None:
    notes = bach_notes()
    duration = round(max(n["end"] for n in notes) + 1.0, 3)
    folder = DEMO_DIR / SONG_ID
    folder.mkdir(parents=True, exist_ok=True)

    song = {"format_version": 1, "title": TITLE, "duration": duration, "notes": notes}
    (folder / "song.json").write_text(json.dumps(song), encoding="utf-8")

    audio = render(notes, duration, load_samples())
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-f",
            "f32le",
            "-ar",
            str(SAMPLE_RATE),
            "-ac",
            "1",
            "-i",
            "-",
            "-b:a",
            "128k",
            str(folder / "mix.mp3"),
        ],
        input=audio.tobytes(),
        check=True,
    )

    songs = [{"id": SONG_ID, "title": TITLE, "status": "ready", "created_at": "2026-11-05T00:00:00+00:00"}]
    (DEMO_DIR / "songs.json").write_text(json.dumps(songs, indent=2), encoding="utf-8")
    print(f"{len(notes)} notes, {duration} s -> {folder}")


if __name__ == "__main__":
    main()
