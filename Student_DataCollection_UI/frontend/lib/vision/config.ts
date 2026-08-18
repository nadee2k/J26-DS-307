/**
 * Vision processing configuration for Component 3 CV pipeline
 */

export const VISION_CONFIG = {
  // Processing rates
  TARGET_FPS: 3,
  SEND_INTERVAL_MS: 2000, // Align with behavior/environment polling

  // Detection thresholds
  FACE_DETECTION_CONFIDENCE: 0.7,
  PHONE_DETECTION_CONFIDENCE: 0.6,

  // Calibration settings
  CALIBRATION_POINTS: 9,
  CALIBRATION_SAMPLES_PER_POINT: 30,
  CALIBRATION_SAMPLE_DELAY_MS: 100,

  // Gaze estimation
  GAZE_SMOOTHING_WINDOW: 5,
  GAZE_ON_SCREEN_THRESHOLD: 0.5,

  // Head pose thresholds (degrees)
  HEAD_POSE_CENTER_YAW_THRESHOLD: 15,
  HEAD_POSE_CENTER_PITCH_THRESHOLD: 15,
  HEAD_POSE_DOWN_PITCH_THRESHOLD: 30,

  // Performance
  MAX_PROCESSING_TIME_MS: 300, // Max time per frame before skipping
} as const

export type VisionConfig = typeof VISION_CONFIG
