"""
FocusTrack Python Serial Bridge

Reads CSV data from ESP32 via USB serial and forwards it
to Supabase as JSON.

Install:
    pip install pyserial requests

Usage:
    python serial_reader.py [--port /dev/ttyUSB0] [--session SESSION_ID]
"""

import argparse
import time
import requests
import serial

from supabase_client import insert


def send_environment_data(session_id: str, data: dict):
    payload = {
        "session_id": session_id,
        "temperature": data["temperature"],
        "humidity": data["humidity"],
        "light": data["light"],
        "noise": data["noise"],
        "motion": data["motion"],
    }
    try:
        resp = insert("environment_logs", payload)
        print(f"[ENV] {resp.status_code} {payload}")
    except (requests.RequestException, RuntimeError) as e:
        print(f"[ENV] Error: {e}")


def main():
    parser = argparse.ArgumentParser(description="FocusTrack ESP32 Serial Bridge")
    parser.add_argument("--port", default="/dev/ttyUSB0", help="Serial port (default: /dev/ttyUSB0)")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate (default: 115200)")
    parser.add_argument("--session", required=True, help="Active session ID")
    args = parser.parse_args()

    print(f"Connecting to {args.port} at {args.baud} baud...")
    print(f"Session ID: {args.session}")

    try:
        ser = serial.Serial(args.port, args.baud, timeout=2)
    except serial.SerialException as e:
        print(f"Failed to open serial port: {e}")
        return

    print("Listening for sensor data... (Ctrl+C to stop)")

    while True:
        try:
            line = ser.readline().decode().strip()
            if not line:
                continue

            parts = line.split(",")
            if len(parts) != 5:
                print(f"[SKIP] Invalid line: {line}")
                continue

            temp, hum, light, noise, motion = parts
            data = {
                "temperature": float(temp),
                "humidity": float(hum),
                "light": int(light),
                "noise": int(noise),
                "motion": bool(int(motion)),
            }
            send_environment_data(args.session, data)

        except ValueError as e:
            print(f"[SKIP] Parse error: {e}")
        except KeyboardInterrupt:
            print("\nStopping...")
            break
        except Exception as e:
            print(f"[ERROR] {e}")

    ser.close()


if __name__ == "__main__":
    main()
