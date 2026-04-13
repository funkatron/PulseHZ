# Golden reference audio (MVP)

- **Title:** VCO Berlin (deathbycuriosity remix)
- **Release context:** Dead Agent – Mauerfall / VCO Berlin Deconstructed
- **In-repo file:** `vco-berlin-deathbycuriosity-remix.mp3`
- **Meter:** 4/4
- **Reference BPM (manual / musical grid):** **136** — use this for PulseHZ manual BPM and bar alignment.
- **Rights:** Included by the rights-holder for PulseHZ development, testing, and demos in this repository.

## BPM check (verified in repo)

On this file, automated estimators **disagree** (common on dense electronic mixes):

- **`librosa.beat.beat_track`** reports ~**120 BPM** and its median beat interval matches ~120.
- **Onset-strength autocorrelation** shows the strongest periodicity peaks around **117** and **172 BPM**, with a **clear peak at 136 BPM** as well—consistent with treating **136** as the intended musical tempo for manual sync.

So: **136** is the documented reference; “Detect BPM” in the app may land nearer **120** depending on algorithm—treat ±10–15 BPM as plausible unless we tune detection for this material.

To use a different file locally, set `PULSEHZ_TEST_WAV` to that path (see `tests/support/audio_fixtures.py`).
