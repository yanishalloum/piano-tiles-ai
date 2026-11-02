# Third-party files

Copied here so that the page works offline, at a fixed version.

| File | Project | Version | Licence |
|---|---|---|---|
| `tf.min.js` | [TensorFlow.js](https://github.com/tensorflow/tfjs) | 4.22.0 | Apache 2.0 (header of the file) |
| `basic-pitch/` | [Basic Pitch](https://github.com/spotify/basic-pitch-ts), Spotify | 1.0.1 | Apache 2.0 (`basic-pitch/LICENSE`) |

Basic Pitch: R. M. Bittner, J. J. Bosch, D. Rubinstein, G. Meseguer-Brocal,
S. Ewert, *A Lightweight Instrument-Agnostic Model for Polyphonic Note
Transcription and Multipitch Estimation*, ICASSP 2022.

To update: `npm pack @tensorflow/tfjs@<version>` and
`npm pack @spotify/basic-pitch@<version>`, then copy `dist/tf.min.js` and
`model/` from the archives.
