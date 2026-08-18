/**
 * Head pose estimation from facial landmarks
 */

import { FaceLandmarks } from "./face-detector"
import { VISION_CONFIG } from "./config"

export interface HeadPose {
  yaw: number // Horizontal rotation (left/right)
  pitch: number // Vertical rotation (up/down)
  roll: number // Tilt rotation
}

export type HeadDirection = "center" | "left" | "right" | "up" | "down"

export class PoseEstimator {
  /**
   * Estimate head pose from facial landmarks
   * Uses a simplified PnP-like approach based on key facial points
   */
  estimatePose(landmarks: FaceLandmarks): HeadPose {
    const points = landmarks.landmarks

    // Key landmark indices (MediaPipe Face Mesh)
    const noseTip = points[1]
    const chin = points[152]
    const leftEye = points[33]
    const rightEye = points[263]
    const leftMouth = points[61]
    const rightMouth = points[291]

    // Estimate yaw (horizontal) from eye and mouth asymmetry
    const eyeWidth = rightEye.x - leftEye.x
    const mouthWidth = rightMouth.x - leftMouth.x
    const noseToCenterX = noseTip.x - 0.5
    
    const yaw = Math.atan2(noseToCenterX, 0.5) * (180 / Math.PI) * 2

    // Estimate pitch (vertical) from nose-chin distance and position
    const noseToChiny = chin.y - noseTip.y
    const noseCenterY = noseTip.y - 0.5
    
    const pitch = Math.atan2(noseCenterY, 0.3) * (180 / Math.PI) * 1.5

    // Estimate roll (tilt) from eye line angle
    const eyeLineAngle = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x)
    const roll = eyeLineAngle * (180 / Math.PI)

    return {
      yaw: Math.max(-90, Math.min(90, yaw)),
      pitch: Math.max(-90, Math.min(90, pitch)),
      roll: Math.max(-45, Math.min(45, roll)),
    }
  }

  /**
   * Classify head direction based on pose angles
   */
  classifyDirection(pose: HeadPose): HeadDirection {
    const { yaw, pitch } = pose
    const yawThreshold = VISION_CONFIG.HEAD_POSE_CENTER_YAW_THRESHOLD
    const pitchThreshold = VISION_CONFIG.HEAD_POSE_CENTER_PITCH_THRESHOLD
    const downThreshold = VISION_CONFIG.HEAD_POSE_DOWN_PITCH_THRESHOLD

    // Check pitch first (up/down takes priority)
    if (pitch > downThreshold) {
      return "down"
    }
    if (pitch < -pitchThreshold) {
      return "up"
    }

    // Check yaw (left/right)
    if (yaw < -yawThreshold) {
      return "left"
    }
    if (yaw > yawThreshold) {
      return "right"
    }

    return "center"
  }
}
