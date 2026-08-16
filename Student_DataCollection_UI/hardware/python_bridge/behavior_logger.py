"""
FocusTrack Behavior Logger

Collects:
- Keyboard key presses
- Mouse movement distance
- Mouse clicks
- Idle time
- Active application

Sends data every second to Supabase.

Usage:
    python behavior_logger.py --session SESSION_ID
"""

import argparse
import math
import os
import re
import shutil
import subprocess
import sys
import threading
import time

import requests

from supabase_client import insert

# -----------------------------
# Global counters
# -----------------------------

keyboard_count = 0
mouse_click_count = 0
mouse_distance = 0.0

last_activity = time.time()
active_application = "Unknown"

lock = threading.Lock()
running = True
libinput_process = None

MOTION_DELTA_RE = re.compile(r"\(\s*([+-]?[\d.]+)/\s*([+-]?[\d.]+)\)\s*$")


# -----------------------------
# Input events
# -----------------------------
def _register_activity():
    global last_activity
    last_activity = time.time()


def _handle_libinput_line(line):
    global keyboard_count, mouse_click_count, mouse_distance

    if "POINTER_MOTION" in line:
        match = MOTION_DELTA_RE.search(line)
        if not match:
            return

        distance = math.hypot(float(match.group(1)), float(match.group(2)))
        if distance <= 0:
            return

        with lock:
            mouse_distance += distance
        _register_activity()
        return

    if "POINTER_BUTTON" in line and "pressed" in line:
        with lock:
            mouse_click_count += 1
        _register_activity()
        return

    if "KEYBOARD_KEY" in line and "pressed" in line and "repeated" not in line:
        with lock:
            keyboard_count += 1
        _register_activity()


def _start_libinput_listener():
    global libinput_process

    libinput_process = subprocess.Popen(
        ["libinput", "debug-events"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        bufsize=1,
    )

    def listener():
        assert libinput_process.stdout is not None

        for line in libinput_process.stdout:
            if not running:
                break
            _handle_libinput_line(line)

        if libinput_process.poll() is None:
            libinput_process.terminate()

    threading.Thread(target=listener, daemon=True).start()
    return True


def _start_pynput_listeners():
    from pynput import keyboard, mouse

    last_mouse_position = None

    def on_key_press(_key):
        global keyboard_count
        with lock:
            keyboard_count += 1
        _register_activity()

    def on_move(x, y):
        nonlocal last_mouse_position
        global mouse_distance
        with lock:
            if last_mouse_position is not None:
                dx = x - last_mouse_position[0]
                dy = y - last_mouse_position[1]
                mouse_distance += math.hypot(dx, dy)
            last_mouse_position = (x, y)
        _register_activity()

    def on_click(_x, _y, _button, pressed):
        global mouse_click_count
        if pressed:
            with lock:
                mouse_click_count += 1
            _register_activity()

    keyboard.Listener(on_press=on_key_press).start()
    mouse.Listener(on_move=on_move, on_click=on_click).start()
    return True


def start_input_listeners():
    if sys.platform == "linux" and shutil.which("libinput"):
        try:
            if _start_libinput_listener():
                print("Input: libinput debug-events (passive, does not grab devices)")
                return
        except Exception as exc:
            print(f"Input: libinput unavailable ({exc}), falling back to pynput")

    _start_pynput_listeners()
    print("Input: pynput")


# -----------------------------
# Active window
# -----------------------------
def _fetch_active_window():
    if os.environ.get("XDG_SESSION_TYPE") == "wayland":
        desktop = os.environ.get("XDG_CURRENT_DESKTOP", "").upper()
        if "KDE" in desktop:
            try:
                result = subprocess.run(
                    [
                        "qdbus-qt6",
                        "org.kde.KWin",
                        "/KWin",
                        "org.kde.KWin.queryWindowInfo",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                for line in result.stdout.splitlines():
                    if line.startswith("caption:"):
                        title = line.split(":", 1)[1].strip()
                        if title:
                            return title
            except Exception:
                pass

        try:
            result = subprocess.run(
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
                    "global.display.focus_window ? global.display.focus_window.get_title() : ''",
                ],
                capture_output=True,
                text=True,
                timeout=5,
            )
            title = result.stdout.strip().strip("'\"")
            if title and title not in {"false", "''", '""'}:
                if title.startswith("("):
                    parts = title.split(",", 1)
                    if len(parts) == 2:
                        title = parts[1].strip().strip(")'")
                if title:
                    return title
        except Exception:
            pass

    try:
        result = subprocess.run(
            ["xdotool", "getactivewindow", "getwindowname"],
            capture_output=True,
            text=True,
            timeout=2,
        )
        title = result.stdout.strip()
        if title:
            return title
    except Exception:
        pass

    return None


def _start_window_poller(interval):
    def poller():
        global active_application

        title = _fetch_active_window()
        if title:
            with lock:
                active_application = title

        while running:
            time.sleep(interval)
            title = _fetch_active_window()
            if title:
                with lock:
                    active_application = title

    threading.Thread(target=poller, daemon=True).start()


# -----------------------------
# Send API
# -----------------------------
def send_behavior(payload):
    row = {
        "session_id": payload["sessionId"],
        "keyboard_count": payload["keyboardCount"],
        "mouse_distance": payload["mouseMovement"],
        "mouse_clicks": payload["mouseClicks"],
        "idle_time": payload["idleTime"],
        "active_application": payload["activeApplication"],
    }
    try:
        r = insert("behavior_logs", row)

        print(
            f"[{r.status_code}] "
            f"Keys={payload['keyboardCount']} "
            f"MouseDist={payload['mouseMovement']:.1f}px "
            f"Clicks={payload['mouseClicks']} "
            f"Idle={payload['idleTime']:.1f}s "
            f"App={payload['activeApplication']}"
        )

    except (requests.RequestException, RuntimeError) as e:
        print(e)


# -----------------------------
# Main
# -----------------------------
def main():
    global running
    global keyboard_count, mouse_distance, mouse_click_count

    parser = argparse.ArgumentParser()
    parser.add_argument("--session", required=True, help="Session ID")
    parser.add_argument("--interval", default=1, type=float)
    args = parser.parse_args()

    print("Starting FocusTrack Behavior Logger...")
    print("Press Ctrl+C to stop.")

    start_input_listeners()
    _start_window_poller(max(args.interval, 2.0))

    try:
        while True:
            time.sleep(args.interval)

            with lock:
                idle = round(time.time() - last_activity, 1)
                payload = {
                    "sessionId": args.session,
                    "keyboardCount": keyboard_count,
                    "mouseMovement": round(mouse_distance, 2),
                    "mouseClicks": mouse_click_count,
                    "idleTime": idle,
                    "activeApplication": active_application,
                }
                keyboard_count = 0
                mouse_distance = 0.0
                mouse_click_count = 0

            send_behavior(payload)

    except KeyboardInterrupt:
        running = False
        if libinput_process and libinput_process.poll() is None:
            libinput_process.terminate()
        print("\nStopping logger...")


if __name__ == "__main__":
    main()
