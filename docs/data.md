# Datasets

## Hand assignment: piano-midi.de

- **Author:** Bernd Krueger
- **Source:** http://www.piano-midi.de
- **License:** [CC BY-SA 3.0 DE](http://creativecommons.org/licenses/by-sa/3.0/de/deed.en)
- **Use:** training and evaluating hand assignment. Each file stores the right
  hand and the left hand on separate tracks ("Piano right", "Piano left"),
  which provides the reference labels.
- **Not redistributed:** the MIDI files are not included in this repository.
- **Known limitations:**
  - Files that store voices instead of hands on separate tracks (for example
    fugues) are skipped.
  - Labels reflect how the files were encoded and may occasionally differ from
    how a pianist would actually play.