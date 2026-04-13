# MVP manual acceptance (golden audio)

Use the committed track under `tests/fixtures/audio/` (see that folder’s README) unless you override with `PULSEHZ_TEST_WAV`.

1. Load the golden audio in the app and set **manual BPM** to the reference value (~136).
2. Add **one or two short video clips** in clip slots; set **bars per loop** to 1 / 2 / 4 as needed.
3. **Visually** confirm layers stay **bar-aligned** with the transport.
4. Run **Detect BPM** and confirm it is within a **reasonable tolerance** of the manual reference (e.g. ±2 BPM), depending on material and browser audio pipeline.
