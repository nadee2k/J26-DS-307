#!/bin/bash
# FocusTrack Data Collector - Run All
# Usage: ./run_all.sh --session SESSION_ID [--port /dev/ttyUSB0] [--camera 0] [--no-esp32] [--no-camera]

SESSION=""
PORT="/dev/ttyUSB0"
CAMERA=0
SKIP_ESP32=false
SKIP_CAMERA=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --session) SESSION="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --camera) CAMERA="$2"; shift 2 ;;
    --no-esp32) SKIP_ESP32=true; shift ;;
    --no-camera) SKIP_CAMERA=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [ -z "$SESSION" ]; then
  echo "Usage: ./run_all.sh --session SESSION_ID [--port /dev/ttyUSB0] [--camera 0] [--no-esp32] [--no-camera]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PIDS=()

cleanup() {
  echo ""
  echo "Stopping all data collectors..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null
  done
  wait "${PIDS[@]}" 2>/dev/null
  echo "All stopped."
}

trap cleanup SIGINT SIGTERM

echo "=== FocusTrack Data Collectors ==="
echo "Session: $SESSION"
echo "---"

# Behavior logger (always runs)
python3 "$SCRIPT_DIR/behavior_logger.py" --session "$SESSION" &
PIDS+=($!)
echo "[OK] Behavior logger started (PID: $!)"

# ESP32 serial reader
if [ "$SKIP_ESP32" = true ]; then
  echo "[SKIP] ESP32 serial reader (--no-esp32)"
elif [ ! -e "$PORT" ]; then
  echo "[WARN] $PORT not found — ESP32 not connected. Skipping serial reader."
else
  python3 "$SCRIPT_DIR/serial_reader.py" --session "$SESSION" --port "$PORT" &
  PIDS+=($!)
  echo "[OK] ESP32 serial reader started on $PORT (PID: $!)"
fi

# Vision logger
if [ "$SKIP_CAMERA" = true ]; then
  echo "[SKIP] Vision logger (--no-camera)"
else
  python3 "$SCRIPT_DIR/vision_logger.py" --session "$SESSION" --camera "$CAMERA" &
  PIDS+=($!)
  echo "[OK] Vision logger started on camera $CAMERA (PID: $!)"
fi

echo "---"
echo "Press Ctrl+C to stop all."
echo ""

wait
