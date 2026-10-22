"""
FocusTrack Component 1 – desktop agent.

A small localhost service that records *interaction metadata* from the whole desktop, so the
C1 workbench can demonstrate logging in any application (VS Code, a PDF reader, a browser,
Zoom, …), not only inside the FocusTrack browser tab.

What is recorded
----------------
* when a key was pressed (timestamp only)
* whether that key was Backspace / Delete (a flag, never the character)
* mouse movement distance (never screen coordinates)
* mouse clicks and scroll events (counts only)
* the *name* of the active application when it changes (never the window title)

What is never recorded
----------------------
Key characters, typed text, clipboard contents, passwords, window titles, file names,
mouse coordinates, or screenshots. Raw events stay in this process's memory and are
discarded when the session stops; only the per-epoch feature rows exported/persisted by the
C1 workbench leave the machine.

Run
---
    python desktop_agent.py
    python desktop_agent.py --port 8765
    python desktop_agent.py --input libinput      # Linux/Wayland fallback

Then open http://localhost:3000/c1 and choose "Desktop agent (all apps)".

The HTTP API is bound to 127.0.0.1 by default and only allows browser origins on
localhost / 127.0.0.1, so it is not reachable from the network.

Dependencies: pynput (already in requirements.txt). psutil is optional but recommended for
application names on Windows/X11; without it the agent falls back to the window class.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import platform
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional
from urllib.parse import parse_qs, urlparse

SERVICE = "focustrack-c1-desktop"
VERSION = "1.0.0"
DEFAULT_PORT = 8765
MAX_BODY_BYTES = 256 * 1024
MAX_EVENTS = 200_000
MOVE_SAMPLE_SECONDS = 0.006  # at most ~160 mouse samples per second

_APP_ALIASES = {
    "code": "VS Code",
    "code-insiders": "VS Code",
    "codium": "VSCodium",
    "chrome": "Chrome",
    "google-chrome": "Chrome",
    "google-chrome-stable": "Chrome",
    "chromium": "Chromium",
    "brave": "Brave",
    "brave-browser": "Brave",
    "firefox": "Firefox",
    "firefox-esr": "Firefox",
    "librewolf": "LibreWolf",
    "zen": "Zen Browser",
    "zen_browser": "Zen Browser",
    "msedge": "Edge",
    "microsoft-edge": "Edge",
    "safari": "Safari",
    "zoom": "Zoom",
    "zoom.us": "Zoom",
    "slack": "Slack",
    "discord": "Discord",
    "telegram": "Telegram",
    "spotify": "Spotify",
    "vlc": "VLC",
    "mpv": "mpv",
    "evince": "Document viewer",
    "okular": "Document viewer",
    "zathura": "Document viewer",
    "acroread": "PDF viewer",
    "libreoffice": "LibreOffice",
    "soffice": "LibreOffice",
    "pycharm": "PyCharm",
    "idea": "IntelliJ IDEA",
    "webstorm": "WebStorm",
    "gnome-terminal": "Terminal",
    "gnome-terminal-server": "Terminal",
    "konsole": "Terminal",
    "alacritty": "Terminal",
    "kitty": "Terminal",
    "wezterm": "Terminal",
    "xterm": "Terminal",
    "nautilus": "Files",
    "dolphin": "Files",
    "thunar": "Files",
    "explorer": "File Explorer",
    "notepad": "Notepad",
    "notepad++": "Notepad++",
    "python": "Python",
    "python3": "Python",
    "pythonw": "Python",
    "node": "Node.js",
    "electron": "Electron app",
}

_BACKSPACE_KEYS = {"KEY_BACKSPACE", "KEY_DELETE"}
_KEY_RE = re.compile(r"KEYBOARD_KEY.*?\s(KEY_[A-Za-z0-9_]+)\s+(pressed|released|repeated)", re.IGNORECASE)
_MOTION_RE = re.compile(r"POINTER_MOTION.*?\(\s*([+-]?[\d.]+)/\s*([+-]?[\d.]+)\)")
_QUOTED_RE = re.compile(r"['\"]([^'\"]+)['\"]")

_libinput_process: Optional[subprocess.Popen] = None


def now_ms() -> int:
    return int(time.time() * 1000)


def normalize_app_name(raw: Optional[str]) -> Optional[str]:
    """Turn a process / window-class name into a short, human-readable app name.

    Only the application name is kept. Window titles are never passed to this function.
    """
    if not raw:
        return None
    value = raw.strip().strip("'\"")
    if not value or value.lower() in {"unknown", "none", "null", "false"}:
        return None
    base = os.path.basename(value.replace("\\", "/")).lower()
    if base.endswith(".exe"):
        base = base[:-4]
    if base in _APP_ALIASES:
        return _APP_ALIASES[base]
    # Qt/KDE desktop files sometimes look like "org.kde.konsole" or "konsole.desktop".
    if base.endswith(".desktop"):
        base = base[: -len(".desktop")]
    if base in _APP_ALIASES:
        return _APP_ALIASES[base]
    # Dotted desktop IDs such as "org.kde.konsole".
    tail = base.rsplit(".", 1)[-1]
    if tail in _APP_ALIASES:
        return _APP_ALIASES[tail]
    # Preserve a friendly name (e.g. macOS "Visual Studio Code") but cap its length.
    return value[:60]


class EventStore:
    """Thread-safe in-memory event buffer plus session state.

    The cursor is a monotonically increasing sequence number, not a timestamp, so two
    events with the same millisecond cannot be skipped by the browser poller.
    """

    def __init__(self, max_events: int = MAX_EVENTS) -> None:
        self._lock = threading.RLock()
        self._events: deque[dict[str, Any]] = deque(maxlen=max_events)
        self._seq = 0
        self._recording = False
        self._started_at: Optional[int] = None
        self._stopped_at: Optional[int] = None
        self._mode: Optional[str] = None
        self._task: Optional[str] = None
        self._epoch_sec = 60
        self._active_app: Optional[str] = None
        self._last_move_at = 0.0
        self._input_ok = False
        self._input_backend = "none"
        self._input_error: Optional[str] = None
        self._window_ok = False
        self._window_backend = "none"
        self._window_error: Optional[str] = None

    # ---------- input / window status ----------
    def set_input_status(self, ok: bool, backend: str, error: Optional[str] = None) -> None:
        with self._lock:
            self._input_ok = ok
            self._input_backend = backend
            self._input_error = error

    def set_window_status(self, ok: bool, backend: str, error: Optional[str] = None) -> None:
        with self._lock:
            self._window_ok = ok
            self._window_backend = backend
            self._window_error = error

    @property
    def ready(self) -> bool:
        return self._input_ok

    # ---------- event recording ----------
    def record(self, kind: str, dist: Optional[float] = None) -> bool:
        """Append one private metadata event. Returns False when not recording."""
        if kind not in {"key", "back", "click", "move", "scroll"}:
            return False
        stamp = now_ms()
        with self._lock:
            if not self._recording:
                return False
            if kind == "move":
                if dist is None or not math.isfinite(dist) or dist <= 0:
                    return False
                # pynput can fire hundreds of times per second; sample the distance stream.
                monotonic = time.monotonic()
                if monotonic - self._last_move_at < MOVE_SAMPLE_SECONDS:
                    return False
                self._last_move_at = monotonic
            event: dict[str, Any] = {"t": stamp, "kind": kind}
            if kind == "move":
                event["dist"] = round(float(dist or 0), 2)
            self._append_locked(event)
            return True

    def set_active_app(self, raw_app: Optional[str]) -> None:
        """Track the foreground app and record a switch event when it changes.

        This only stores the application name. Nothing about the window title or file is
        kept.
        """
        app = normalize_app_name(raw_app)
        with self._lock:
            previous = self._active_app
            if not app:
                return
            self._active_app = app
            if self._recording and previous is not None and app != previous:
                self._append_locked({"t": now_ms(), "kind": "switch", "app": app})

    def _append_locked(self, event: dict[str, Any]) -> None:
        # Keep timestamps non-decreasing so the browser's windowing is stable.
        if self._events and event["t"] < self._events[-1]["t"]:
            event["t"] = self._events[-1]["t"]
        self._seq += 1
        event["seq"] = self._seq
        self._events.append(event)

    # ---------- session ----------
    def start(self, mode: Optional[str] = None, task: Optional[str] = None, epoch_sec: int = 60) -> dict[str, Any]:
        with self._lock:
            self._events.clear()
            self._seq = 0
            self._recording = True
            self._started_at = now_ms()
            self._stopped_at = None
            self._mode = mode
            self._task = task
            try:
                self._epoch_sec = max(1, int(epoch_sec or 60))
            except (TypeError, ValueError):
                self._epoch_sec = 60
            self._last_move_at = 0.0
            return {
                "ok": True,
                "startedAt": self._started_at,
                "cursor": 0,
                "mode": self._mode,
                "task": self._task,
                "epochSec": self._epoch_sec,
            }

    def stop(self) -> dict[str, Any]:
        with self._lock:
            self._recording = False
            self._stopped_at = now_ms()
            return {"ok": True, "stoppedAt": self._stopped_at, "count": len(self._events)}

    def status(self) -> dict[str, Any]:
        with self._lock:
            return {
                "ok": True,
                "service": SERVICE,
                "version": VERSION,
                "ready": self._input_ok,
                "platform": platform.platform(),
                "input": {
                    "ok": self._input_ok,
                    "backend": self._input_backend,
                    "error": self._input_error,
                },
                "window": {
                    "ok": self._window_ok,
                    "backend": self._window_backend,
                    "error": self._window_error,
                },
                "recording": self._recording,
                "activeApp": self._active_app,
                "count": len(self._events),
                "session": (
                    {
                        "startedAt": self._started_at,
                        "mode": self._mode,
                        "task": self._task,
                        "epochSec": self._epoch_sec,
                    }
                    if self._started_at is not None
                    else None
                ),
            }

    def snapshot(self, since: int = 0, limit: int = 5_000) -> dict[str, Any]:
        """Return events with seq > since, oldest first."""
        with self._lock:
            stamp = now_ms()
            pending = [dict(e) for e in self._events if int(e["seq"]) > since]
            batch = pending[: max(0, limit)]
            cursor = int(batch[-1]["seq"]) if batch else since
            return {
                "ok": True,
                "now": stamp,
                "cursor": cursor,
                "events": batch,
                "more": len(pending) > len(batch),
                "recording": self._recording,
                "activeApp": self._active_app,
            }


# ---------------------------------------------------------------------------
# Foreground application (name only, never the window title)
# ---------------------------------------------------------------------------
def _run(cmd: list[str], timeout: float = 1.5) -> Optional[str]:
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    output = (result.stdout or "").strip()
    return output or None


def _process_name(pid: Any) -> Optional[str]:
    try:
        import psutil  # optional dependency

        return psutil.Process(int(pid)).name()
    except Exception:
        return None


def _x11_app() -> Optional[str]:
    pid = _run(["xdotool", "getactivewindow", "getwindowpid"])
    if pid:
        name = _process_name(pid.strip())
        if name:
            return name
    return _run(["xdotool", "getactivewindow", "getwindowclassname"])


def _kde_wayland_app() -> Optional[str]:
    # kdotool uses KWin's scripting API and is the cleanest non-interactive route.
    if shutil.which("kdotool"):
        return _run(["kdotool", "getactivewindow", "getwindowclassname"], timeout=2)
    return None


def _gnome_wayland_app() -> Optional[str]:
    # get_wm_class() is the application class, not the window title.
    script = "global.display.focus_window ? global.display.focus_window.get_wm_class() : ''"
    output = _run(
        [
            "gdbus",
            "call",
            "--session",
            "--dest",
            "org.gnome.Shell",
            "--object-path",
            "/org/gnome/Shell",
            "--method",
            "org.gnome.Shell.Eval",
            script,
        ],
        timeout=2,
    )
    if not output:
        return None
    match = _QUOTED_RE.search(output)
    return match.group(1) if match else None


def _macos_app() -> Optional[str]:
    return _run(
        [
            "osascript",
            "-e",
            'tell application "System Events" to get name of first application process whose frontmost is true',
        ],
        timeout=2,
    )


def _windows_app() -> Optional[str]:
    try:
        import ctypes

        user32 = ctypes.windll.user32  # type: ignore[attr-defined]
        handle = user32.GetForegroundWindow()
        pid = ctypes.c_ulong()
        user32.GetWindowThreadProcessId(handle, ctypes.byref(pid))
        return _process_name(pid.value)
    except Exception:
        return None


def foreground_app() -> tuple[Optional[str], str]:
    """Return (application name, backend label) using only application identifiers."""
    if sys.platform.startswith("win"):
        return _windows_app(), "win32"
    if sys.platform == "darwin":
        return _macos_app(), "osascript"
    if sys.platform.startswith("linux"):
        desktop = os.environ.get("XDG_CURRENT_DESKTOP", "").upper()
        session_type = os.environ.get("XDG_SESSION_TYPE", "").lower()
        if session_type == "wayland":
            if "KDE" in desktop:
                app = _kde_wayland_app()
                if app:
                    return app, "kdotool"
            app = _gnome_wayland_app()
            if app:
                return app, "gnome-eval"
        app = _x11_app()
        if app:
            return app, "xdotool"
    return None, "none"


class KWinBridge:
    """Passive KDE Plasma 6 (Wayland) active-application source.

    KWin has no readable "active window" D-Bus property. The supported route is a tiny
    KWin script: it calls back into this process over D-Bus whenever the active window
    changes. Only ``resourceClass`` (the application id) is sent – never the title.
    """

    SERVICE_NAME = "org.focustrack.C1Agent"
    IFACE = "org.focustrack.C1Agent"

    def __init__(self, store: EventStore) -> None:
        self.store = store
        self.error: Optional[str] = None
        self._thread: Optional[threading.Thread] = None
        self._loop: Any = None
        self._bus: Any = None
        self._ready = threading.Event()
        self._plugin: Optional[str] = None
        self._script_path: Optional[str] = None

    def start(self, timeout: float = 5.0) -> bool:
        try:
            import asyncio

            from dbus_next.aio import MessageBus
            from dbus_next.constants import RequestNameReply
            from dbus_next.service import ServiceInterface, method
        except Exception as exc:
            self.error = f"dbus-next is not available ({exc})"
            return False

        store = self.store

        class Reporter(ServiceInterface):
            def __init__(self) -> None:
                super().__init__(KWinBridge.IFACE)

            @method()
            def Report(self, app: "s") -> "":  # noqa: N802 - D-Bus method name
                store.set_active_app(app)

        def run() -> None:
            loop = asyncio.new_event_loop()
            self._loop = loop
            asyncio.set_event_loop(loop)

            async def main() -> None:
                bus = await MessageBus().connect()
                self._bus = bus
                bus.export("/", Reporter())
                reply = await bus.request_name(KWinBridge.SERVICE_NAME)
                if reply != RequestNameReply.PRIMARY_OWNER:
                    raise RuntimeError("another FocusTrack agent already owns the KWin bridge name")
                self._ready.set()
                await bus.wait_for_disconnect()

            try:
                loop.run_until_complete(main())
            except Exception as exc:  # keep the agent alive without app tracking
                self.error = str(exc)[:160]
                self._ready.set()
            finally:
                loop.close()

        self._thread = threading.Thread(target=run, name="c1-kwin-bridge", daemon=True)
        self._thread.start()
        if not self._ready.wait(timeout) or self.error:
            self.error = self.error or "KWin bridge did not become ready"
            return False
        return self._install_script()

    def _qdbus(self) -> Optional[str]:
        for command in ("qdbus-qt6", "qdbus6", "qdbus"):
            if shutil.which(command):
                return command
        return None

    def _install_script(self) -> bool:
        qdbus = self._qdbus()
        if not qdbus:
            self.error = "no qdbus binary found"
            return False
        script = (
            "function focustrackReport() {\n"
            "  var w = workspace.activeWindow;\n"
            f'  callDBus("{self.SERVICE_NAME}", "/", "{self.IFACE}", "Report", w ? w.resourceClass : "");\n'
            "}\n"
            "focustrackReport();\n"
            "workspace.windowActivated.connect(focustrackReport);\n"
        )
        handle, path = tempfile.mkstemp(prefix="focustrack-kwin-", suffix=".js")
        with os.fdopen(handle, "w", encoding="utf-8") as file:
            file.write(script)
        self._script_path = path
        self._plugin = f"focustrack_c1_agent_{os.getpid()}"
        loaded = _run([qdbus, "org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.loadScript", path, self._plugin], timeout=3)
        if not loaded or not loaded.strip().isdigit():
            self.error = "KWin refused to load the active-window script"
            self._remove_script_file()
            return False
        script_id = loaded.strip()
        _run([qdbus, "org.kde.KWin", f"/Scripting/Script{script_id}", "org.kde.kwin.Script.run"], timeout=3)
        return True

    def _remove_script_file(self) -> None:
        if self._script_path:
            try:
                os.remove(self._script_path)
            except OSError:
                pass
            self._script_path = None

    def stop(self) -> None:
        qdbus = self._qdbus()
        if qdbus and self._plugin:
            _run([qdbus, "org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.unloadScript", self._plugin], timeout=2)
        self._remove_script_file()
        if self._loop is not None and self._bus is not None:
            try:
                import asyncio

                asyncio.run_coroutine_threadsafe(self._disconnect(), self._loop)
            except Exception:
                pass
            try:
                self._loop.call_soon_threadsafe(self._loop.stop)
            except Exception:
                pass

    async def _disconnect(self) -> None:
        if self._bus is not None:
            self._bus.disconnect()


class WindowTracker:
    def __init__(self, store: EventStore, interval: float = 0.75) -> None:
        self.store = store
        self.interval = max(0.25, interval)
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._bridge: Optional[KWinBridge] = None
        self.backend = "pending"
        self.error: Optional[str] = None

    def start(self) -> None:
        session_type = os.environ.get("XDG_SESSION_TYPE", "").lower()
        desktop = os.environ.get("XDG_CURRENT_DESKTOP", "").upper()
        if sys.platform.startswith("linux") and session_type == "wayland" and "KDE" in desktop:
            bridge = KWinBridge(self.store)
            if bridge.start():
                self._bridge = bridge
                self.backend = "kwin-script"
                self.store.set_window_status(True, "kwin-script", None)
                return
            self.error = bridge.error
        self._thread = threading.Thread(target=self._loop, name="c1-window-tracker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._bridge:
            self._bridge.stop()

    def _loop(self) -> None:
        first = True
        while not self._stop.is_set():
            try:
                app, backend = foreground_app()
                self.backend = backend
                if app:
                    self.error = None
                    self.store.set_window_status(True, backend, None)
                    self.store.set_active_app(app)
                elif first:
                    self.error = "Could not read the active application; app switches will be unavailable."
                    self.store.set_window_status(False, backend, self.error)
            except Exception as exc:  # keep the input listeners alive
                self.error = str(exc)[:160]
                self.store.set_window_status(False, self.backend, self.error)
            first = False
            self._stop.wait(self.interval)


# ---------------------------------------------------------------------------
# Input backends
# ---------------------------------------------------------------------------
def _start_pynput(store: EventStore) -> tuple[bool, str]:
    try:
        from pynput import keyboard, mouse
    except Exception as exc:
        return False, f"pynput is not available ({exc})"

    last_position: Optional[tuple[int, int]] = None

    def on_press(key: Any) -> None:
        # Only the Backspace/Delete *identity* is inspected; the key itself is discarded.
        is_back = key == keyboard.Key.backspace or key == keyboard.Key.delete
        store.record("back" if is_back else "key")

    def on_move(x: int, y: int) -> None:
        nonlocal last_position
        if last_position is not None:
            store.record("move", dist=math.hypot(x - last_position[0], y - last_position[1]))
        last_position = (x, y)

    def on_click(_x: int, _y: int, _button: Any, pressed: bool) -> None:
        if pressed:
            store.record("click")

    def on_scroll(_x: int, _y: int, _dx: int, _dy: int) -> None:
        store.record("scroll")

    try:
        keyboard_listener = keyboard.Listener(on_press=on_press)
        mouse_listener = mouse.Listener(on_move=on_move, on_click=on_click, on_scroll=on_scroll)
        # Older pynput releases do not forward the daemon keyword to threading.Thread.
        keyboard_listener.daemon = True
        mouse_listener.daemon = True
        keyboard_listener.start()
        mouse_listener.start()
    except Exception as exc:
        return False, f"pynput could not start ({exc})"
    return True, "pynput"


def _start_libinput(store: EventStore) -> tuple[bool, str]:
    global _libinput_process
    if not shutil.which("libinput"):
        return False, "libinput is not installed"

    try:
        process = subprocess.Popen(
            ["libinput", "debug-events"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return False, f"libinput could not start ({exc})"
    _libinput_process = process

    # libinput exits immediately when the user cannot read input devices.
    time.sleep(0.35)
    if process.poll() is not None:
        detail = ""
        try:
            detail = (process.stderr.read() or "").strip().splitlines()[-1]
        except Exception:
            pass
        return False, detail or "libinput needs permission (add the user to the 'input' group or run with sudo)"

    def listener() -> None:
        assert process.stdout is not None
        for line in process.stdout:
            if not line:
                continue
            if "KEYBOARD_KEY" in line:
                match = _KEY_RE.search(line)
                if not match:
                    continue
                key_name, action = match.group(1).upper(), match.group(2).lower()
                if action == "pressed":
                    store.record("back" if key_name in _BACKSPACE_KEYS else "key")
            elif "POINTER_MOTION" in line:
                match = _MOTION_RE.search(line)
                if match:
                    store.record("move", dist=math.hypot(float(match.group(1)), float(match.group(2))))
            elif "POINTER_BUTTON" in line and "pressed" in line:
                store.record("click")
            elif "POINTER_AXIS" in line or "POINTER_SCROLL" in line:
                store.record("scroll")

    threading.Thread(target=listener, name="c1-libinput", daemon=True).start()
    return True, "libinput"


def start_input(store: EventStore, requested: str) -> bool:
    if requested == "auto":
        # On Linux, libinput sees native Wayland and XWayland windows alike; pynput is
        # X11-only. Prefer libinput and fall back to pynput when it is not permitted.
        backends = ["libinput", "pynput"] if sys.platform.startswith("linux") else ["pynput"]
    else:
        backends = [requested]
    errors: list[str] = []
    for backend in backends:
        if backend == "none":
            store.set_input_status(False, "none", "Input capture disabled (--input none)")
            print("Input: disabled (--input none); the API starts without listeners.")
            return False
        if backend == "pynput":
            ok, detail = _start_pynput(store)
        elif backend == "libinput":
            ok, detail = _start_libinput(store)
        else:
            errors.append(f"unknown input backend '{backend}'")
            continue
        if ok:
            store.set_input_status(True, detail, None)
            print(f"Input: {detail} (global keyboard and mouse metadata)")
            return True
        errors.append(detail)
        print(f"Input: {backend} failed – {detail}")
    store.set_input_status(False, "none", " | ".join(errors))
    print("Input: no listener is active. The API will still start, but the C1 page cannot record.")
    print("       Linux/Wayland: try `python desktop_agent.py --input libinput`")
    print("       macOS: grant Accessibility permission to your terminal/Python.")
    return False


# ---------------------------------------------------------------------------
# HTTP API
# ---------------------------------------------------------------------------
class AgentServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], handler: type[BaseHTTPRequestHandler], store: EventStore, allowed_origins: set[str], verbose: bool = False) -> None:
        super().__init__(address, handler)
        self.store = store
        self.allowed_origins = allowed_origins
        self.verbose = verbose


class Handler(BaseHTTPRequestHandler):
    server: AgentServer

    def log_message(self, fmt: str, *args: Any) -> None:
        if self.server.verbose:
            super().log_message(fmt, *args)

    # ---------- CORS / responses ----------
    def _origin_allowed(self, origin: str) -> bool:
        if origin in self.server.allowed_origins:
            return True
        return origin.startswith("http://localhost:") or origin.startswith("http://127.0.0.1:")

    def _cors(self) -> None:
        origin = self.headers.get("Origin", "")
        if origin and self._origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Requested-With")
        self.send_header("Access-Control-Max-Age", "600")
        if self.headers.get("Access-Control-Request-Private-Network", "").lower() == "true":
            # Chrome's Private Network Access preflight for a localhost service.
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _error(self, status: int, message: str) -> None:
        self._send(status, {"ok": False, "error": message})

    # ---------- verbs ----------
    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_HEAD(self) -> None:  # noqa: N802
        self.do_GET()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        if path in {"/", "/health"}:
            self._send(200, self.server.store.status())
            return
        if path == "/events":
            query = parse_qs(parsed.query)
            try:
                since = int(float(query.get("since", ["0"])[0] or 0))
                limit = int(float(query.get("limit", ["5000"])[0] or 5000))
            except (TypeError, ValueError):
                self._error(400, "since and limit must be numbers")
                return
            self._send(200, self.server.store.snapshot(since=since, limit=max(1, min(10_000, limit))))
            return
        if path == "/status":
            self._send(200, self.server.store.status())
            return
        self._error(404, f"unknown endpoint {path}")

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length > MAX_BODY_BYTES:
            self._error(413, "request body is too large")
            return
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8") or "{}") if raw else {}
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._error(400, "body must be JSON")
            return
        if not isinstance(payload, dict):
            self._error(400, "body must be a JSON object")
            return

        if path == "/session/start":
            mode = payload.get("mode")
            task = payload.get("task")
            epoch_sec = payload.get("epochSec", 60)
            try:
                result = self.server.store.start(
                    mode=str(mode) if mode is not None else None,
                    task=str(task) if task is not None else None,
                    epoch_sec=int(epoch_sec),
                )
            except (TypeError, ValueError):
                self._error(400, "epochSec must be a number")
                return
            self._send(200, result)
            return
        if path == "/session/stop":
            self._send(200, self.server.store.stop())
            return
        self._error(404, f"unknown endpoint {path}")


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="FocusTrack C1 desktop agent (system-wide metadata only)")
    parser.add_argument("--host", default="127.0.0.1", help="bind address (default: 127.0.0.1, local only)")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"HTTP port (default: {DEFAULT_PORT})")
    parser.add_argument(
        "--input",
        choices=["auto", "pynput", "libinput", "none"],
        default="auto",
        help="input backend: pynput, libinput (Linux/Wayland), or none",
    )
    parser.add_argument("--no-window", action="store_true", help="do not track the active application")
    parser.add_argument("--window-interval", type=float, default=0.75, help="active-app poll interval in seconds")
    parser.add_argument("--allow-origin", action="append", default=[], help="extra allowed browser origin")
    parser.add_argument("--verbose", action="store_true", help="log every HTTP request")
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    store = EventStore()

    print("FocusTrack C1 desktop agent")
    print(f"  API: http://{args.host}:{args.port}")
    print("  Privacy: key timing + Backspace/Delete flag, mouse distance, clicks, scroll, app name only")
    print("           No characters, text, passwords, window titles, coordinates, or screenshots.")
    start_input(store, args.input)

    tracker: Optional[WindowTracker] = None
    if args.no_window:
        store.set_window_status(False, "none", "Active-app tracking disabled (--no-window)")
    else:
        tracker = WindowTracker(store, interval=args.window_interval)
        tracker.start()

    allowed = set(args.allow_origin or [])
    try:
        server = AgentServer((args.host, args.port), Handler, store, allowed, verbose=args.verbose)
    except OSError as exc:
        print(f"\nCould not bind {args.host}:{args.port} – {exc}")
        print("Is another copy of the agent already running? Try --port 8766.")
        return 1

    def shutdown(_signum: int, _frame: Any) -> None:
        # Raising KeyboardInterrupt is safe here; calling server.shutdown() from the
        # serve_forever thread itself would deadlock.
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, shutdown)
    print("\nReady. Open http://localhost:3000/c1 and choose 'Desktop agent (all apps)'.")
    print("Press Ctrl+C to stop.\n")
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        print("\nStopping desktop agent…")
    finally:
        if tracker:
            tracker.stop()
        server.server_close()
        if _libinput_process and _libinput_process.poll() is None:
            _libinput_process.terminate()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
