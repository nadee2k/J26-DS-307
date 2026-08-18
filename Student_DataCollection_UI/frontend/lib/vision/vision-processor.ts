/**
 * Main vision processor coordinating all CV modules
 */

import { FaceDetector } from "./face-detector"
import { GazeTracker, type CalibrationModel } from "./gaze-tracker"
import { PoseEstimator } from "./pose-estimator"
import { PhoneDetector } from "./phone-detector"
import { VISION_CONFIG } from "./config"

export interface VisionFeatures {
  faceDetected: boolean
  eyeGaze: "on-screen" | "off-screen" | "invalid"
  headDirection: "center" | "left" | "right" | "up" | "down"
  phoneDetected: boolean
  timestamp: number
}

export class VisionProcessor {
  private faceDetector: FaceDetector
  private gazeTracker: GazeTracker
  private poseEstimator: PoseEstimator
  private phoneDetector: PhoneDetector

  private videoElement: HTMLVideoElement | null = null
  private processingInterval: number | null = null
  private lastFeatures: VisionFeatures | null = null
  private isProcessing = false

  constructor() {
    this.faceDetector = new FaceDetector()
    this.gazeTracker = new GazeTracker()
    this.poseEstimator = new PoseEstimator()
    this.phoneDetector = new PhoneDetector()
  }

  async initialize(): Promise<void> {
    await Promise.all([
      this.faceDetector.initialize(),
      this.phoneDetector.initialize(),
    ])
  }

  async start(videoElement: HTMLVideoElement, onFeatures: (features: VisionFeatures) => void): Promise<void> {
    if (this.processingInterval) {
      this.stop()
    }

    this.videoElement = videoElement
    const frameIntervalMs = 1000 / VISION_CONFIG.TARGET_FPS

    this.processingInterval = window.setInterval(async () => {
      if (this.isProcessing || !this.videoElement) return

      this.isProcessing = true
      try {
        const features = await this.processFrame(this.videoElement)
        if (features) {
          this.lastFeatures = features
          onFeatures(features)
        }
      } catch (error) {
        console.error("Frame processing error:", error)
      } finally {
        this.isProcessing = false
      }
    }, frameIntervalMs)
  }

  stop(): void {
    if (this.processingInterval) {
      window.clearInterval(this.processingInterval)
      this.processingInterval = null
    }
    this.videoElement = null
    this.lastFeatures = null
  }

  async processFrame(videoElement: HTMLVideoElement): Promise<VisionFeatures | null> {
    const startTime = performance.now()

    // Detect face and landmarks
    const faceLandmarks = await this.faceDetector.detectFace(videoElement)

    if (!faceLandmarks) {
      return {
        faceDetected: false,
        eyeGaze: "invalid",
        headDirection: "center",
        phoneDetected: false,
        timestamp: Date.now(),
      }
    }

    // Estimate gaze
    const gazeEstimate = this.gazeTracker.estimateGaze(faceLandmarks)
    const gazeState = gazeEstimate ? this.gazeTracker.classifyGaze(gazeEstimate) : "invalid"

    // Estimate head pose
    const headPose = this.poseEstimator.estimatePose(faceLandmarks)
    const headDirection = this.poseEstimator.classifyDirection(headPose)

    // Detect phone (only if processing time allows)
    let phoneDetected = false
    const elapsedTime = performance.now() - startTime
    if (elapsedTime < VISION_CONFIG.MAX_PROCESSING_TIME_MS) {
      const phoneDetection = await this.phoneDetector.detectPhone(videoElement)
      phoneDetected = phoneDetection.detected
    }

    return {
      faceDetected: true,
      eyeGaze: gazeState,
      headDirection,
      phoneDetected,
      timestamp: Date.now(),
    }
  }

  setCalibration(calibration: CalibrationModel): void {
    this.gazeTracker.setCalibration(calibration)
  }

  getLastFeatures(): VisionFeatures | null {
    return this.lastFeatures
  }

  dispose(): void {
    this.stop()
    this.faceDetector.dispose()
    this.phoneDetector.dispose()
    this.gazeTracker.reset()
  }
}
