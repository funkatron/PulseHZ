# MVP manual acceptance (golden audio)

Use the committed track under `tests/fixtures/audio/` (see that folder’s README) unless you override with `PULSEHZ_TEST_WAV`.

1. Load the golden audio and set **manual BPM** to a reasonable starting value (e.g. ~136 for this clip).
2. **While playing**, nudge manual BPM **on the fly** if the bar grid drifts—variable tempo in the material is normal.
3. Optionally enable **live capture** (loopback) and confirm **continuous tempo estimation** tracks the stream when that path is in use.
4. Add **one or two short video clips** in clip slots; set **bars per loop** to 1 / 2 / 4 as needed.
5. **Visually** confirm layers stay **bar-aligned** with the transport at the BPM you have set **right now** (not a single BPM for the whole song unless the material is steady).
