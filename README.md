# Piano Tiles AI

## Requirements

- Python 3.11 (managed by uv)
- FFmpeg (`sudo apt install ffmpeg` on Ubuntu)
- An NVIDIA GPU with CUDA 12.6+ is strongly recommended

> Extract the piano notes from any song and display it as interactive falling piano tiles, with left and right hands in different colors.

## How it works

1. **Source separation**: isolate the piano from the full mix (Demucs)
2. **Transcription**: convert the piano audio into notes (MIDI)
3. **Hand separation**: assign each note to the left or right hand
4. **Visualization**: play the notes as falling tiles (pause, speed control, rewind)

## Roadmap

- [x] Project setup
- [ ] Audio loading & signal basics
- [ ] Piano source separation
- [ ] Audio-to-MIDI transcription
- [ ] Left/right hand separation
- [ ] Interactive piano tiles visualizer

## License

MIT, see [LICENSE](LICENSE).
