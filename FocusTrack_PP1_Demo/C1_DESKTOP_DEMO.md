# Component 1 — system-wide demo (desktop agent)

The `/c1` workbench originally saw only the FocusTrack browser tab. This adds an optional
local **desktop agent** so the same privacy-preserving logger works in *any* application
(VS Code, a PDF reader, Zoom, a browser, …), while the page still works browser-only when
the agent is not running.

```
 any application ─┐
                  ├─► desktop_agent.py (127.0.0.1:8765) ─► GET /events ─► /c1 page
 keyboard / mouse ┘        metadata only                   numeric epochs
                                                            └─► FastAPI / Supabase
```

## 1. Run it

Terminal 1 — the app (browser-only mode still works if you skip this step):

```bash
cd FocusTrack_PP1_Demo/frontend
npm run dev            # http://localhost:3000
```

Terminal 2 — the desktop agent:

```bash
cd FocusTrack_PP1_Demo/hardware/python_bridge
pip install -r requirements.txt
python desktop_agent.py
```

Open <http://localhost:3000/c1>. The page auto-detects the agent and selects
**Desktop agent (all apps)**. Press **Start logging**, then use any other application.

> The agent listens on `127.0.0.1` only and accepts browser origins on `localhost` /
> `127.0.0.1`. It is not reachable from the network.

## 2. What is and is not recorded

| Recorded (per event, in memory) | Never recorded |
|---|---|
| Timestamp of a key press | Which key, or any typed text |
| A boolean “was it Backspace/Delete” | Passwords, clipboard, file names |
| Mouse travel distance (pixels) | Mouse coordinates or screenshots |
| Click / scroll counts | Window titles |
| Active **application name** when it changes | URLs, document contents |

Raw events stay in the agent process and are discarded when the session stops. Only the
per-epoch numeric feature rows leave the machine (see §5).

## 3. Suggested 2-minute demo

1. Start the agent and open `/c1`; show the green **connected** badge and the input
   backend (`libinput` on Linux, `pynput` on Windows/macOS).
2. Keep epoch length at **15 s (fast demo)**, choose study mode and task, press
   **Start logging**.
3. Switch to another application (e.g. VS Code or a PDF). Type, make and correct a
   mistake, move the mouse, switch back. The **Active application** metric and the
   **App switches** count update live.
4. Press **Read epoch now** to avoid waiting: the latest-epoch panel shows typing rate,
   rhythm variability, corrections, idle time, mouse speed and app switching, plus the
   interaction state and behaviour-only `P(focused)`.
5. Open the transparency panel: it shows exactly the numeric row that is stored — no
   characters, titles or coordinates. **Export epochs** downloads the JSON.
6. Switch the source card to **This browser tab** to show the no-Python fallback.

## 4. Platform notes

| OS / session | Keyboard + mouse | Active application |
|---|---|---|
| Linux (X11) | `libinput` (preferred) or `pynput` | `xdotool` + `psutil` |
| Linux (Wayland, KDE Plasma 6) | `libinput` (needs the `input` group; usually no sudo) | KWin scripting bridge (automatic), else `kdotool` |
| Linux (Wayland, GNOME) | `libinput` or `pynput` | `gdbus` `get_wm_class()` |
| Windows | `pynput` | `psutil` process name |
| macOS | `pynput` | `osascript` (needs Automation/Accessibility permission) |

* If input capture fails the agent still serves `/health`, and the page shows the exact
  command to run and a **Retry** button.
* On Linux, make sure the user is in the `input` group for `libinput`
  (`sudo usermod -aG input $USER`, then log out and back in). Otherwise the agent falls
  back to `pynput`, which sees XWayland windows only.
* Force a backend when needed: `python desktop_agent.py --input libinput` or
  `--input pynput`. `--input none` serves the API without listeners (useful for testing).

## 5. Storing epochs

Each numeric epoch is saved when **Save each numeric epoch** is ticked (default on).

* If `NEXT_PUBLIC_C1_BACKEND_URL` is set (e.g. `http://localhost:8000`), the page POSTs to
  `POST /api/c1/epochs` on the FastAPI backend. If the backend is unreachable it falls back
  to the app database, so a demo never breaks.
* Otherwise it writes through the normal Supabase client — which is the in-browser demo
  database when no Supabase keys are configured.

Apply the new table once:

* Fresh Supabase project: run `supabase/schema.sql`.
* Existing project: run `supabase/migration_2026-10-22_c1_epochs.sql`.
* The FastAPI backend creates its table automatically on start (`init_db`).

Enable the backend destination by adding to `frontend/.env.local`:

```
NEXT_PUBLIC_C1_BACKEND_URL=http://localhost:8000
```

## 6. Agent HTTP API (all local)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | service, platform, input/window backend, readiness, active app |
| `POST` | `/session/start` | body `{mode, task, epochSec}` — clears the buffer and starts recording |
| `POST` | `/session/stop` | stops recording |
| `GET` | `/events?since=<seq>&limit=<n>` | metadata events with `seq > since` plus a new cursor |

The cursor is a sequence number (not a timestamp), so events that share a millisecond
cannot be skipped. `GET /events` also returns `activeApp`, `recording`, `now` and `more`.

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| Card says **not running** | Start `desktop_agent.py`; press **Retry**. Check the port with `curl http://127.0.0.1:8765/health`. |
| **input unavailable** | Linux: add the user to `input`, or run `--input pynput`. macOS: grant Accessibility to the terminal. |
| Key presses in another app are not counted (Linux) | You are probably on the `pynput` fallback under Wayland; install the `input` group / use `--input libinput`. |
| App switches show **unavailable** | KDE Wayland: `pip install dbus-next` (KWin bridge) or install `kdotool`. |
| Port already in use | Another agent is running; stop it or use `--port 8766` and set `NEXT_PUBLIC_C1_AGENT_URL`. |

## 8. Files

| File | Role |
|---|---|
| `hardware/python_bridge/desktop_agent.py` | system-wide logger + localhost API |
| `hardware/python_bridge/test_desktop_agent.py` | 13 unit tests (privacy + event buffer) |
| `frontend/lib/focus/desktop.ts` | typed agent client + event validation |
| `frontend/lib/focus/c1-store.ts` | epoch persistence (backend → app DB fallback) |
| `frontend/app/c1/page.tsx` | source switch, live agent polling, storage status |
| `backend/app/routes/c1_epochs.py` | `POST/GET /api/c1/epochs` |
| `supabase/migration_2026-10-22_c1_epochs.sql` | `c1_epochs` table for Supabase |

The models behind `P(focused)` are still trained on the simulated study; retraining on
real probe-labelled sessions is remaining work. In desktop mode an *app switch* means any
foreground application change, while the simulator counted leaving the study app — so treat
the behaviour-only score as illustrative, not calibrated.
