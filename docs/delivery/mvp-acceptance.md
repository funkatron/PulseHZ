# MVP manual acceptance (browser-first)

**TL;DR:** Golden-path checklist before merging [PR #1](https://github.com/funkatron/PulseHZ/pull/1) to `main`. Automated CI covers server APIs and basic UI smoke; this doc covers tempo sync and export behavior that still need a human or scripted browser pass.

**Default golden audio:** `tests/fixtures/audio/vco-berlin-deathbycuriosity-remix.mp3` (reference BPM **~136**). Override with `PULSEHZ_TEST_WAV`.

---

## Quickstart (shortest path)

```bash
uv sync --extra dev --extra audio --extra e2e
uv run playwright install chromium
uv run pulsehz-server
# open http://127.0.0.1:6066/app/?autoload=first
```

Run the scripted partial pass (server must be up on 6066):

```bash
uv run python scripts/mvp_acceptance_check.py
uv run python scripts/mvp_manual_remaining.py   # bar sync, autosave reload, WebM export
```

---

## Checklist

| # | Step | Pass criteria | Automated |
|---|------|---------------|-----------|
| 1 | Load golden audio | File loads; no error in status line | `scripts/mvp_acceptance_check.py` |
| 2 | Set **manual BPM** to reference (~136) | `#manual-bpm` shows 136; bar duration updates | script |
| 3 | Load **1–2 demo or user clips** | `#loaded-layers` ≥ 1; layer not `aria-busy` | script (`?autoload=first`) |
| 4 | **Play** transport | `#preview-transport-label` → **Playing** | script |
| 5 | **Visual** bar alignment | Layers stay on shared bar grid while playing | **Manual** (watch preview + beat ring) |
| 6 | **Detect BPM** (file) | Detected value plausible; record Δ vs manual reference (ideal ±2 BPM — golden track often wider) | script (plausibility + WARN) |
| 7 | **Reload** / autosave | Clips + settings restore after refresh | **Manual** (optional before merge) |
| 8 | **Export WebM** (one bar or audio length) | File downloads; non-zero size | **Manual** |
| 9 | **CI** | `pytest tests/` + `pytest e2e/` green on PR | GitHub Actions |

---

## Sign-off (fill on merge)

| Field | Value |
|-------|--------|
| **Branch / commit** | `feature/browser-first-mvp` @ `6ed7ab0` (+ manual script) |
| **Tester** | agent / local Playwright (2026-07-02) |
| **Date** | 2026-07-02 |
| **Detect BPM result** | manual 136 / detected 161.5 (Δ 25.5) — plausible, not ideal ±2 |
| **Visual bar sync** | pass — beat 1.81→3.94, progress bar moved while Playing |
| **Autosave reload** | pass — snapshot restored `1 / 4`, status “Restored project…” |
| **WebM export** | pass — **493,798 bytes**, status “WebM export finished…” |
| **Notes** | `scripts/mvp_manual_remaining.py` automates rows 5/7/8 in headless Chromium |

---

## Appendix (skippable): why this exists

The checklist lived briefly in `tests/MVP_ACCEPTANCE.md` (commit `82366a7`) and was removed to avoid duplicating user docs. Delivery sign-off belongs here under `docs/delivery/`, not in the test tree.
