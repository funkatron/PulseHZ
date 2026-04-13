# Golden reference audio (MVP)

- **Title:** VCO Berlin (deathbycuriosity remix)
- **Release context:** Dead Agent – Mauerfall / VCO Berlin Deconstructed
- **In-repo file:** `vco-berlin-deathbycuriosity-remix.mp3`
- **Meter:** 4/4
- **Nominal BPM (for tests / smoke):** **~136** — useful as a **starting point** when exercising the UI; not a claim that tempo is constant for the whole file.
- **Rights:** Included by the rights-holder for PulseHZ development, testing, and demos in this repository.

Real mixes often **drift or change tempo** over time. PulseHZ’s transport uses **one global BPM at a time**, but you are expected to **adjust manual BPM on the fly** while listening (and/or use **live capture**, which estimates tempo continuously from the input). Automated “Detect BPM” is a **single snapshot** from the file, not a tempo map.

To use a different file locally, set `PULSEHZ_TEST_WAV` to that path (see `tests/support/audio_fixtures.py`).
