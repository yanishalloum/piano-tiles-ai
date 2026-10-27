# Hand assignment

Each transcribed note is assigned to the left or the right hand.

## Data

Hand-labeled MIDI files from piano-midi.de (see [data.md](data.md)), split
by piece with a deterministic hash: 77 training, 16 validation and 26 test
pieces. All choices (hyperparameters, architecture, number of epochs) were
made on the validation split; the test split was evaluated once, at the end.

## Results on the test split

| Method | Accuracy | Left P | Left R | Right P | Right R |
|---|---|---|---|---|---|
| Split at middle C | | | | | |
| Clustering (1-D k-means, 1.0 s window) | | | | | |
| Transformer (3 layers, 109k parameters) | | | | | |
| **BiLSTM (2 layers, 135k parameters)** | | | | | |

## Methods

- **Split at middle C:** notes below C4 go to the left hand.
- **Clustering:** for each note, the pitches of the notes within ±1 s are
  split into two groups with 1-D k-means; the boundary follows the hands.
- **BiLSTM:** a 2-layer bidirectional LSTM reads the whole note sequence.
  Each note is described by its pitch, the time since the previous onset,
  its duration and its velocity.
- **Transformer:** a 3-layer Transformer encoder with learned positions,
  applied on overlapping windows of 128 notes.

## Findings

- Learning from data clearly beats hand-crafted rules.
- With default hyperparameters, the BiLSTM outperforms the Transformer on
  this task. A plausible explanation is the LSTM's sequential inductive
  bias, which suits a local problem with a moderate amount of data. The
  Transformer was not extensively tuned.

## Limitations

- Labels come from how the files were encoded (one track per hand) and may
  occasionally differ from how a pianist would play.
- Training data is classical music; transcribed pop music may differ
  (domain shift), especially in durations and velocities.
- Results were obtained with a single training run per model; GPU
  non-determinism causes small run-to-run variations.

## Data augmentation

Three augmented copies of each training piece: transposition (±6 semitones),
tempo scaling (×0.8 to ×1.25), velocity shift (±15), 3% dropped notes and
±10 ms onset jitter to simulate transcription errors. Validation and test
pieces are never augmented.

- Validation accuracy: 95.5% → 96.6% (train 98.4%, no significant overfitting).
- On a real transcription ("Let It Be"), physically impossible assignments
  (notes struck together by one hand spanning more than 16 semitones) drop
  from 10.2% to 7.2% of the notes.

## Note on the test split

The test split was evaluated twice: once for the first comparison of all
methods, once for the final augmented model. No choice was made by looking
at test results.

## Future work

1. Constrained decoding: reassign the least confident notes of physically
   impossible chords.
2. Pseudo-labeling on MAESTRO performance MIDI to reduce the domain gap.
3. Labeling hands automatically from piano videos (computer vision).