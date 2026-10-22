# FocusTrack — Integrated Experience Demo

A standalone frontend that shows what FocusTrack looks like **after** the four research
components are integrated: one learner, one session, one loop.

```
login → start session → live alerts → session outcomes → feedback → progress
```

Built for demo evaluators: it is offline, deterministic, runs on this laptop, and never
writes simulated data into the research database.

---

## Run it

```bash
cd FocusTrack_Integrated_Demo
npm install
npm run dev          # http://localhost:3001
```

Production build:

```bash
npm run build
npm start            # http://localhost:3001
```

No environment variables, no Supabase account, no camera, no ESP32 board required.

---

## The five-minute demo script

1. **Login** (`/login`)
   - Pick **Nimali Perera** (paper learner) or **Kasun Fernando** (screen learner).
   - Say: *"Same profile fields as the data-collection app; this demo keeps everything local."*

2. **Start** (`/demo/session`)
   - Choose a task, place and duration.
   - Point out the three ready sources (C1 behaviour, C2 environment, C3 vision) and the
     privacy note: derived features only, no video or key content.
   - Optional: turn C2 or C3 off to show the decision-level fallback.

3. **Live** (`/demo/live`)
   - The session starts playing automatically; it plays 50 minutes in ~90 seconds
     (0.5× / 1× / 3×). Use **Pause** to talk over a moment.
   - Point at the focus score, the 5–10 minute risk forecast and the state ribbon.
   - Use **Next alert** in the presenter bar to jump straight to the next warning.
   - When an alert appears: read **Why**, read **Try**, press **Helpful** or **Not now**,
     and show the alert level move.
   - For a paper session, show the green *"Quiet is expected here"* card — the research
     point that quiet reading is not distraction.
   - **Presenter bar**: play/pause, next alert, skip to outcome, speed, restart.

4. **Outcomes** (`/demo/outcome`)
   - Hero sentence, focus trend, states, probe self-reports.
   - Three insight cards: behaviour, environment, vision.
   - The **"Why this session means something"** panel has the research numbers.
   - *"Show the science"* adds model notes everywhere.

5. **Feedback** (`/demo/feedback`)
   - 1–5 session rating, per-alert usefulness, three experience statements, comment, consent.
   - Submit → *"Feedback saved"* closes the loop and explains what the data tunes.

6. **Progress** (`/demo/history`) and **Evidence** (`/demo/science`)
   - Progress shows a deterministic sample history plus the run just completed.
   - Evidence is the one-page argument: integration diagram, SO1–SO6 mapping, headline
     numbers and honest limitations.

---

## Structure

```
app/
  login/                 existing-profile login, register, PP1 profile import
  demo/session/          task, place, duration, sources, consent
  demo/live/             focus gauge, risk forecast, timeline, states, alerts
  demo/outcome/          session summary, insights, research evidence
  demo/feedback/         ratings, alert usefulness, consent, completion
  demo/history/          multi-session trend, next best action, session log
  demo/science/          integration and evidence one-pager
components/
  demo/                  shell, stepper, presenter bar, gauge, timeline,
                         state ribbon, alert card, source status
  ui/                    local button, card, input, segmented primitives
hooks/
  use-auth.tsx           local profile session
  use-demo.tsx           run state, alert policy, feedback, persistence
lib/
  sim/                   simulator copied from the PP1 app
  focus/                 models and scoring copied from the PP1 app
  demo/                  run builder, outcome summary, history, evidence
```

### How the live data is produced

- `lib/demo/run.ts` builds a session from the simulator with a seed derived from the
  logged-in profile, so the learner is someone the models were not trained on.
- Every minute is scored by the same exported C1 model and the C4 fusion/risk models used
  in the PP1 app. Focus score, risk, contributions, counterfactuals and interaction states
  are computed, not hard-coded.
- The run picker prefers a session with two to four alert moments and a mid-range focus
  profile, so the demo is informative rather than flat.
- The starting alert level is chosen for the demo so each session has two to four meaningful
  warnings (clamped to 0.28–0.55). In the research design the threshold is a policy parameter
  tuned from feedback, not a property of the model.
- Alerts are gated live by the alert level, a 3-per-hour budget and a 10-minute gap.
  **Helpful / Not now** changes the level immediately (`updateThreshold`).

### What is reused from the research

| Source | Reused here |
|---|---|
| `FocusTrack_PP1_Demo/frontend/lib/sim/*` | simulator, RNG, ML helpers, types |
| `FocusTrack_PP1_Demo/frontend/lib/focus/*` | C1 model, C2/C3 features, C4 fusion, policy |
| `FocusTrack_PP1_Demo/frontend/public/models/c1.json` | exported C1 weights |
| `doc/DEMO_SUMMARY.md`, `research/README.md` | evaluation numbers, limitations |

Copying keeps the demo self-contained. If the PP1 models change, re-copy the files and
re-run the app; `scripts/sync-core.sh` can automate it.

---

## Honesty rules built into the UI

- Every page carries a *Simulated learner* message; the footer says demo data never enters
  the research database.
- The login screen says *Demo mode · three sample profiles* — no claim of a live database.
- The outcome evidence panel quotes the study (Macro-F1 0.534 vs 0.442, non-screen 0.499
  vs 0.380, cross-context 0.377 vs 0.083) and the science page lists the limitations,
  including that the integrated model is not yet validated end-to-end.
- The history page labels its first four entries as sample history.

---

## Limitations / next steps

- **No real authentication backend.** Profiles are local. To use the real student table,
  add Supabase environment variables and the same `students` query used in the PP1 app;
  the demo deliberately avoids writing research rows.
- **One session at a time.** A refresh restores the active run from `sessionStorage`.
- **Browser models, not the full HMM.** The demo uses the deployable C1 subset and the C4
  fusion models, matching the PP1 prototype. The full Gaussian-HMM representation still
  needs a scoring endpoint or ONNX export.
- **No live capture.** Behaviour, environment and vision come from the deterministic
  replay; the PP1 workbenches remain the place to demonstrate real sensors and camera.
