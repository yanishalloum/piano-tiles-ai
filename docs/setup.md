# Setup guide

This guide takes you from a fresh computer to the web app running with your first song.
Every step says what to type, where to type it, what you should see, and what to do if
it fails. Allow about an hour, most of it waiting for downloads, and **15 GB of free disk space**.

- [What you need](#what-you-need)
- [1. NVIDIA driver (Windows)](#1-nvidia-driver-windows)
- [2. WSL 2 and Ubuntu (Windows)](#2-wsl-2-and-ubuntu-windows)
- [3. Git and FFmpeg](#3-git-and-ffmpeg)
- [4. uv](#4-uv)
- [5. Get the code](#5-get-the-code)
- [6. Install the dependencies](#6-install-the-dependencies)
- [7. Run the tests](#7-run-the-tests)
- [8. Train the hand model](#8-train-the-hand-model)
- [9. Start the web app](#9-start-the-web-app)
- [Troubleshooting](#troubleshooting)

## What you need

| | Recommended | Also works |
|---|---|---|
| System | Windows 10 or 11 with WSL 2 | Linux (Ubuntu 22.04 or newer); skip steps 1 and 2 and install your distribution's NVIDIA driver |
| GPU | NVIDIA, 6 GB of memory or more | No GPU: everything runs on the CPU, but processing a song takes several minutes instead of under one |
| Browser | Chrome or Edge | Firefox (the practice mode works, but listening is less tested) |
| For the practice mode | A microphone near your piano | |

macOS is not supported: the models are installed for NVIDIA GPUs (CUDA).

> **Terminals.** Steps 1 and 2 use **PowerShell**, the Windows terminal (Start menu, type
> "PowerShell"). Every other command goes in the **Ubuntu** terminal (Start menu, type
> "Ubuntu"). Paste with right-click or Ctrl + Shift + V.

## 1. NVIDIA driver (Windows)

The GPU driver is installed **in Windows only**. WSL uses it automatically; never install an
NVIDIA driver inside Ubuntu.

1. Download the latest driver for your card from [nvidia.com/drivers](https://www.nvidia.com/drivers)
   (Game Ready or Studio, either works) and install it.
2. Check, in PowerShell:

   ```powershell
   nvidia-smi
   ```

   You should see a table with the name of your GPU and a "CUDA Version" of **12.6 or higher**.
   If the version is lower, update the driver.

## 2. WSL 2 and Ubuntu (Windows)

WSL (Windows Subsystem for Linux) runs a real Linux inside Windows. The project is developed
and tested on Linux.

1. Open PowerShell **as administrator** (right-click, "Run as administrator") and type:

   ```powershell
   wsl --install -d Ubuntu-24.04
   ```

2. Restart the computer when asked. Ubuntu opens by itself and asks for a user name and a
   password. Choose them; the password is asked by `sudo`, and nothing shows while you type it.
3. Check, in PowerShell:

   ```powershell
   wsl -l -v
   ```

   The `VERSION` column must say **2**. If it says 1: `wsl --set-version Ubuntu-24.04 2`.
4. Check that Ubuntu sees the GPU, **in the Ubuntu terminal**:

   ```bash
   nvidia-smi
   ```

   Same table as in step 1. If you get `command not found`, update the Windows driver and WSL
   (`wsl --update` in PowerShell), then restart.

## 3. Git and FFmpeg

Git downloads the code; FFmpeg reads and converts audio and video files.

```bash
sudo apt update
sudo apt install -y git ffmpeg curl
```

Check:

```bash
git --version      # git version 2.x
ffmpeg -version    # ffmpeg version 6.x or newer, followed by many lines
```

## 4. uv

[uv](https://docs.astral.sh/uv/) installs the right Python (3.11) and every Python package,
at the exact versions written in `uv.lock`.

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.bashrc
uv --version       # uv 0.x
```

`source ~/.bashrc` reloads the terminal settings, so that the new `uv` command is found.
Closing and reopening the terminal does the same.

## 5. Get the code

Keep the project **in your Linux home folder**, not in `/mnt/c/...` (the Windows drive): files
there are read through a slow bridge, and everything would be several times slower.

```bash
mkdir -p ~/Code
cd ~/Code
git clone https://github.com/yanishalloum/piano-tiles-ai.git
cd piano-tiles-ai
```

From now on, every command is typed **in this folder**. If you open a new terminal, start with
`cd ~/Code/piano-tiles-ai`.

## 6. Install the dependencies

```bash
uv sync
```

This downloads Python 3.11, PyTorch for CUDA 12.6 and the other packages into a `.venv`
folder: several gigabytes, so it takes from a few minutes to half an hour depending on your
connection. It ends with a list of installed packages.

Check that PyTorch sees the GPU:

```bash
uv run python -c "import torch; print(torch.__version__, torch.cuda.is_available())"
```

Expected: a version ending in `+cu126`, then **True**. `False` means the CPU will be used:
see [Troubleshooting](#troubleshooting).

## 7. Run the tests

```bash
uv run pytest -q
```

Expected: a line of dots, then `passed` with no failure. The tests replace the AI models by
fakes: they need neither a GPU nor any data, and take a few seconds.

## 8. Train the hand model

The app needs a model that assigns each note to the left or the right hand. It is not
distributed (see the licence section of the README), so you train it yourself. It learns from
MIDI files of [piano-midi.de](http://www.piano-midi.de) by Bernd Krueger, in which each hand is
stored on its own track.

1. **Download the MIDI files.** On piano-midi.de, open the page of each composer and download
   their pieces. The more pieces, the better the model.
   The files are under the licence CC BY-SA 3.0 DE: you may use them, but do not commit them
   (the `data/` folder is ignored by git for this reason).
2. **Put them all in one folder**, directly, not in sub-folders:

   ```bash
   mkdir -p data/hands/piano-midi-de
   cp /mnt/c/Users/<your Windows name>/Downloads/*.mid data/hands/piano-midi-de/
   ls data/hands/piano-midi-de | head     # alb_esp1.mid, bach_846.mid...
   ```

   Downloaded ZIP files must be extracted first: `python3 -m zipfile -e archive.zip data/hands/piano-midi-de`.
   If the extraction creates sub-folders, move the `.mid` files up into `data/hands/piano-midi-de`.
3. **Train:**

   ```bash
   uv run piano-tiles-ai train-hands data/hands/piano-midi-de
   ```

   The pieces are split into training, validation and test sets by a hash of their file name
   (always the same split). You should see how many pieces were found, then one line per epoch
   (your numbers will differ):

   ```
   77 training pieces, 16 validation pieces
   epoch   1   train loss 0.3412   val accuracy 89.7%
   ...
   epoch  30   train loss 0.0721   val accuracy 96.4%
   Best validation accuracy: 96.6%. Model saved to .../models/hand_lstm.pt
   ```

   The version with the best validation accuracy is kept. A few minutes on a recent GPU,
   much longer on a CPU. Options: `--epochs 30`, `--augment 3` (augmented copies of each
   training piece), `--force` to replace an existing model. `uv run piano-tiles-ai train-hands --help`
   lists them.
4. **Check** that the model loads:

   ```bash
   uv run python -c "from piano_tiles_ai.hand_model import load_hand_model; from piano_tiles_ai.paths import HAND_MODEL_PATH; print(load_hand_model(HAND_MODEL_PATH))"
   ```

   Expected: a description of the network, starting with `HandLSTM(`.

## 9. Start the web app

```bash
uv run piano-tiles-ai serve
```

Expected: `Uvicorn running on http://127.0.0.1:8765`. The server keeps the terminal busy; stop
it with **Ctrl + C**. Open **http://localhost:8765** in your Windows browser: WSL shares
`localhost` with Windows.

- **Add a song**: drop an audio or video file anywhere on the page, or paste a YouTube or
  TikTok link in the Library panel. The first song takes longer: the separation and
  transcription models are downloaded once (a few hundred megabytes). After that, allow about
  a minute per song with a GPU.
- **Correct hands**: click a tile to move it to the other hand.
- **Practice**: allow the microphone when the browser asks. Leave "Song sound" off, or wear
  headphones, or the microphone will hear the song instead of you.
- The API is documented at http://localhost:8765/docs.

## Troubleshooting

| Problem | Cause and fix |
|---|---|
| `uv: command not found` | The terminal does not know the new command yet: `source ~/.bashrc`, or open a new terminal. |
| `torch.cuda.is_available()` prints `False` | Ubuntu does not see the GPU. Check `nvidia-smi` in Ubuntu (step 2); update the Windows driver and run `wsl --update` in PowerShell, then restart. |
| `ModuleNotFoundError: No module named 'pkg_resources'` | Transkun needs an older setuptools; `pyproject.toml` pins `setuptools<81`. Run `uv sync` again. |
| An error mentioning `libcudart.so` | torchaudio was built for another CUDA version than torch. Both must come from the CUDA 12.6 index set in `pyproject.toml`: run `uv sync --reinstall-package torch --reinstall-package torchaudio`. |
| `ffprobe` or `ffmpeg` not found | FFmpeg is missing: step 3. |
| `address already in use` | Another program uses the port: `uv run piano-tiles-ai serve --port 8766`, then open http://localhost:8766. |
| A song stays in "Processing failed" | Hover the status in the Library to read the error. A missing `models/hand_lstm.pt` means step 8 was skipped. |
| `No usable MIDI file in ...` (step 8) | The `.mid` files are in a sub-folder: move them directly into the folder you give. |
| A YouTube link fails | Sites change often: update the downloader with `uv lock --upgrade-package yt-dlp` then `uv sync`. If the error mentions a JavaScript runtime, install [Deno](https://deno.com): `curl -fsSL https://deno.land/install.sh \| sh`. |
| "Microphone refused" | Click the icon left of the address bar, allow the microphone, reload the page. |
| Practice mode shows "slow listening" | The browser computes on the CPU: enable hardware acceleration in the browser settings, and close other heavy tabs. |
| Everything is slow | The project is on the Windows drive (`/mnt/c/...`): clone it again in your Linux home (step 5). |
