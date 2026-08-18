/**
 * Eye gaze tracking and on/off-screen estimation
 */

import { FaceLandmarks } from "./face-detector"
import { VISION_CONFIG } from "./config"

export interface GazeEstimate {
  leftEye: { x: number; y: number }
  rightEye: { x: number; y: number }
  gazePoint: { x: number; y: number }
  confidence: number
}

export type GazeState = "on-screen" | "off-screen" | "invalid"

export interface CalibrationModel {
  onScreenSamples: Array<{ iris: { x: number; y: number }; target: { x: number; y: number } }>
  offScreenSamples: Array<{ iris: { x: number; y: number } }>
  trained: boolean
}

export class GazeTracker {
  private calibrationModel: CalibrationModel | null = null
  private gazeHistory: GazeEstimate[] = []

  /**
   * Extract eye iris positions from facial landmarks
   */
  private extractIrisPositions(landmarks: FaceLandmarks): { left: { x: number; y: number }; right: { x: number; y: number } } | null {
    const points = landmarks.landmarks

    // Iris center approximations (MediaPipe Face Mesh indices)
    // Left eye center
    const leftEyePoints = [468, 469, 470, 471, 472]
    const leftIrisX = leftEyePoints.reduce((sum, idx) => sum + points[idx].x, 0) / leftEyePoints.length
    const leftIrisY = leftEyePoints.reduce((sum, idx) => sum + points[idx].y, 0) / leftEyePoints.length

    // Right eye center
    const rightEyePoints = [473, 474, 475, 476, 477]
    const rightIrisX = rightEyePoints.reduce((sum, idx) => sum + points[idx].x, 0) / rightEyePoints.length
    const rightIrisY = rightEyePoints.reduce((sum, idx) => sum + points[idx].y, 0) / rightEyePoints.length

    return {
      left: { x: leftIrisX, y: leftIrisY },
      right: { x: rightIrisX, y: rightIrisY },
    }
  }

  /**
   * Estimate gaze direction from iris positions
   */
  estimateGaze(landmarks: FaceLandmarks): GazeEstimate | null {
    const iris = this.extractIrisPositions(landmarks)
    if (!iris) return null

    // Average iris position
    const avgX = (iris.left.x + iris.right.x) / 2
    const avgY = (iris.left.y + iris.right.y) / 2

    const estimate: GazeEstimate = {
      leftEye: iris.left,
      rightEye: iris.right,
      gazePoint: { x: avgX, y: avgY },
      confidence: landmarks.confidence,
    }

    // Smooth gaze with history
    this.gazeHistory.push(estimate)
    if (this.gazeHistory.length > VISION_CONFIG.GAZE_SMOOTHING_WINDOW) {
      this.gazeHistory.shift()
    }

    // Return smoothed estimate
    const smoothedX = this.gazeHistory.reduce((sum, g) => sum + g.gazePoint.x, 0) / this.gazeHistory.length
    const smoothedY = this.gazeHistory.reduce((sum, g) => sum + g.gazePoint.y, 0) / this.gazeHistory.length

    return {
      ...estimate,
      gazePoint: { x: smoothedX, y: smoothedY },
    }
  }

  /**
   * Classify gaze as on-screen or off-screen using calibration
   */
  classifyGaze(estimate: GazeEstimate): GazeState {
    if (!estimate || estimate.confidence < 0.5) {
      return "invalid"
    }

    // If no calibration, use simple heuristic (iris position relative to face)
    if (!this.calibrationModel || !this.calibrationModel.trained) {
      return this.classifyUncalibrated(estimate)
    }

    // Use calibration model for classification
    return this.classifyCalibrated(estimate)
  }

  /**
   * Uncalibrated classification (simple heuristic)
   */
  private classifyUncalibrated(estimate: GazeEstimate): GazeState {
    const { x, y } = estimate.gazePoint
    
    // Simple heuristic: gaze within reasonable bounds
    if (x >= 0.2 && x <= 0.8 && y >= 0.2 && y <= 0.8) {
      return "on-screen"
    }
    return "off-screen"
  }

  /**
   * Calibrated classification using trained model
   */
  private classifyCalibrated(estimate: GazeEstimate): GazeState {
    if (!this.calibrationModel) return "invalid"

    const { gazePoint } = estimate

    // Simple nearest-neighbor classification
    let minOnScreenDist = Infinity
    let minOffScreenDist = Infinity

    // Check distance to on-screen samples
    for (const sample of this.calibrationModel.onScreenSamples) {
      const dist = Math.sqrt(
        Math.pow(gazePoint.x - sample.iris.x, 2) + Math.pow(gazePoint.y - sample.iris.y, 2)
      )
      minOnScreenDist = Math.min(minOnScreenDist, dist)
    }

    // Check distance to off-screen samples
    for (const sample of this.calibrationModel.offScreenSamples) {
      const dist = Math.sqrt(
        Math.pow(gazePoint.x - sample.iris.x, 2) + Math.pow(gazePoint.y - sample.iris.y, 2)
      )
      minOffScreenDist = Math.min(minOffScreenDist, dist)
    }

    // Classify based on nearest neighbors
    return minOnScreenDist < minOffScreenDist ? "on-screen" : "off-screen"
  }

  /**
   * Set calibration model
   */
  setCalibration(model: CalibrationModel): void {
    this.calibrationModel = model
  }

  /**
   * Reset gaze history
   */
  reset(): void {
    this.gazeHistory = []
  }
}
