# FocusTrack – PP1 prototype: shared data collection + four component workbenches

Branch `demo/dummy-data`. Runs on one laptop with no Supabase account, no ESP32 board and no participants
(demo mode), or against Supabase and a real board.

> **Simulated data is not research data.** The simulator and every model trained on it exist to build and test
> the pipeline. Never report their numbers as findings.

## What is built for PP1 (≈ 50% per component)

The four components are **deliberately not integrated** at PP1. Each owner demonstrates their own part in a
standalone workbench; integration (C1–C3 epochs feeding C4 live) is part of the remaining work.

| Page | Owner | What it demonstrates |
|---|---|---|
| `/sessions` | shared | Data collection: study mode **per session**, tasks filtered by mode, ESP32 + behaviour + optional vision logging, random focus probes (1–5, every 8–12 min; "Fast demo" = 20–40 s), end-of-session rating, active time without pauses |
| `/c1` | Kumari (C1) | Privacy-preserving interaction logger (key timing + Backspace flag only), per-epoch features, interaction states (k-means prototype), transitions, behaviour-only focus estimate with mode/task context, exact view of what is stored |
| `/c2` | Kapuwella (C2) | ESP32 stream (or demo board), two-point sensor calibration (lux, dB(A)), missing-data handling, Hampel filter, per-epoch features, comfort band and index (personal from earlier probe-labelled sessions, population otherwise) |
| `/c3` | Vithana (C3) | In-browser vision at 3 fps: 3D head pose, eye-relative iris position, quality flags, personal three-zone calibration with a held-out scripted check (personal vs fixed rule, phone recall, reading motion), Downward-Gaze Disambiguation vs the fixed-angle rule |
| `/c4` | Ayyash (C4) | Replay of a simulated session from a learner the models never saw: focus score, 5–10-minute drop forecast, personal threshold with "Helpful / Not now" feedback, alert budget and gap, explanations + counterfactuals, phase-1/phase-2 switch, stream-drop fallback |
| `/research` | all | Each component's analysis on the simulated study (LOPO, paired Wilcoxon, ablations); workbenches deep-link to their tab |

## Run it

```bash
cd Student_DataCollection_UI/frontend
npm ci
npm run dev          # http://localhost:3000
npm run test:logic   # 22 unit tests for the component logic (head pose, iris, zones, DGD, Hampel, comfort, C1 rates)
```

Demo mode is on when `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are not set (or
`NEXT_PUBLIC_DEMO_MODE=1`): data are kept in the browser (localStorage) and "Connect ESP32 board" streams simulated
readings (with occasional failed DHT22 reads and sound glitches, so cleaning can be shown). The sidebar has
**Demo mode · reset demo data** to start clean before a presentation.

**C3 needs a real browser with a camera** (Chrome or Edge on the laptop) and an internet connection the first time:
MediaPipe Face Mesh and the COCO-SSD phone model load from a CDN.

## Suggested PP1 demo order (≈ 2 minutes per component)

1. **Shared app** – register, start a non-screen *reading* session (library), tick *Fast demo*, answer a probe, stop, rate the session.
2. **C1** – start logging (15-s epochs), type and correct in the study pad, switch tab once; show the state sequence and the "what is stored" panel.
3. **C2** – connect the board, start 15-s epochs; show cleaning (missing/outliers), comfort band and the calibration form.
4. **C3** – start the camera, run the quick calibration (~1 min, spoken prompts), show held-out accuracy; then read the book and pick up the phone: the fixed rule calls both "distracted", DGD separates them.
5. **C4** – play the default replay (fast); open the alert, explain the reasons and the counterfactual, press "Helpful/Not now", toggle phase 1, drop the C3 stream to show the fallback.

## Hardware (C2)

`hardware/esp32/sensor_reader.ino` prints one CSV line per second: `temperature,humidity,light_raw,sound_p2p_raw,motion`.
A failed DHT22 read is printed as `nan` and stored as **missing** (never 0 or −1). Sound is the peak-to-peak amplitude
over 50 ms (a loudness level, not one sample). Raw light/sound values are mapped to lux / dB(A) with the two-point
calibration on the C2 page, measured once against a lux meter and a sound-level meter.

## Database

`supabase/schema.sql` (fresh install) or `supabase/migration_2026-10-20_pp1.sql` (existing database) adds
`study_sessions.study_mode`, `session_rating`, `active_seconds`, allows the `handwriting` task and free-text places,
and creates the `calibrations` table for C3.

**Before real data collection:** replace the open row-level-security policies with policies scoped to an
authenticated participant or a server-side role – the current development policies let anyone with the public key
read and write every table.

## Prototype simplifications (stated on each workbench)
* Models are trained on the simulated study until real probe-labelled data exist.
* C1 uses k-means states; the final system uses a Gaussian HMM. The browser logger sees this tab only; the desktop
  logger (`hardware/python_bridge/behavior_logger.py`) covers other apps.
* C3 uses COCO-SSD in the browser; the plan is a fine-tuned YOLOv8n exported to the browser so the evaluated model
  is the deployed one. C3's keyboard-activity cue uses its own key listener until C1 is integrated.
* C4's threshold update is a simple feedback rule; Bayesian optimisation is planned for phase 2.
