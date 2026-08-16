"""
FocusTrack Vision Logger

Uses webcam to detect face, eye gaze direction, head direction,
and phone presence. Sends data to Supabase every second.

Install:
    pip install opencv-python mediapipe requests numpy

Usage:
    python vision_logger.py --session SESSION_ID [--camera 0]
"""

import argparse
import time
import requests
import cv2
import mediapipe as mp
import numpy as np

from supabase_client import insert

FaceLandmarker = mp.tasks.vision.FaceLandmarker
FaceLandmarkerOptions = mp.tasks.vision.FaceLandmarkerOptions
BaseOptions = mp.tasks.BaseOptions


class VisionAnalyzer:
    def __init__(self):
        options = FaceLandmarkerOptions(
            base_options=BaseOptions(
                model_asset_path="/home/Dhananjana/GitHub/Student_DataCollection_UI/models/face_landmarker.task"
            ),
            num_faces=1,
            min_face_detection_confidence=0.5,
            min_tracking_confidence=0.5,
            output_face_blendshapes=False,
        )

        self.landmarker = FaceLandmarker.create_from_options(options)

    def analyze(self, frame):
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = self.landmarker.detect(mp_image)

        data = {
            "faceDetected": False,
            "eyeGaze": "unknown",
            "headDirection": "unknown",
            "phoneDetected": False,
        }

        if result.face_landmarks:
            landmarks = result.face_landmarks[0]
            data["faceDetected"] = True

            nose = landmarks[1]
            head_x = nose.x - 0.5
            if head_x < -0.1:
                data["headDirection"] = "left"
            elif head_x > 0.1:
                data["headDirection"] = "right"
            else:
                data["headDirection"] = "center"

            left_iris = landmarks[468]
            eye_center_x = (landmarks[33].x + landmarks[133].x) / 2
            gaze_offset = left_iris.x - eye_center_x
            if gaze_offset < -0.02:
                data["eyeGaze"] = "left"
            elif gaze_offset > 0.02:
                data["eyeGaze"] = "right"
            else:
                data["eyeGaze"] = "center"

        data["phoneDetected"] = self._detect_phone(frame)
        return data

    def _detect_phone(self, frame):
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        lower_black = np.array([0, 0, 0])
        upper_black = np.array([180, 50, 80])
        mask = cv2.inRange(hsv, lower_black, upper_black)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in contours:
            area = cv2.contourArea(c)
            if 5000 < area < 50000:
                x, y, w, h = cv2.boundingRect(c)
                aspect = w / h if h > 0 else 0
                if 0.3 < aspect < 0.8:
                    return True
        return False

    def close(self):
        self.landmarker.close()


def send_vision_data(session_id: str, data: dict):
    payload = {
        "session_id": session_id,
        "face_detected": data["faceDetected"],
        "eye_gaze": data["eyeGaze"],
        "head_direction": data["headDirection"],
        "phone_detected": data["phoneDetected"],
    }
    try:
        resp = insert("vision_logs", payload)
        print(f"[VIS] {resp.status_code} face={data['faceDetected']} gaze={data['eyeGaze']} head={data['headDirection']} phone={data['phoneDetected']}")
    except (requests.RequestException, RuntimeError) as e:
        print(f"[VIS] Error: {e}")


def main():
    parser = argparse.ArgumentParser(description="FocusTrack Vision Logger")
    parser.add_argument("--session", required=True, help="Active session ID")
    parser.add_argument("--camera", type=int, default=0, help="Camera index (default: 0)")
    parser.add_argument("--interval", type=float, default=1.0, help="Logging interval in seconds")
    args = parser.parse_args()

    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        print("Failed to open camera")
        return

    print("Downloading face landmarker model (first run only)...")
    analyzer = VisionAnalyzer()
    print(f"Vision logger started. Session: {args.session}")
    print("Analyzing webcam feed... (Ctrl+C to stop)")

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                print("[WARN] Failed to read frame")
                time.sleep(1)
                continue

            data = analyzer.analyze(frame)
            send_vision_data(args.session, data)
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nStopping vision logger...")
    finally:
        analyzer.close()
        cap.release()


if __name__ == "__main__":
    main()
