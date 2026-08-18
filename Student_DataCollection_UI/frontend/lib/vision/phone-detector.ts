/**
 * Phone detection using TensorFlow.js COCO-SSD model
 */

import * as cocoSsd from "@tensorflow-models/coco-ssd"
import "@tensorflow/tfjs"
import { VISION_CONFIG } from "./config"

export interface PhoneDetection {
  detected: boolean
  confidence: number
  bbox?: { x: number; y: number; width: number; height: number }
}

export class PhoneDetector {
  private model: cocoSsd.ObjectDetection | null = null
  private initialized = false
  private loading = false

  async initialize(): Promise<void> {
    if (this.initialized || this.loading) return

    this.loading = true
    try {
      this.model = await cocoSsd.load()
      this.initialized = true
    } catch (error) {
      console.error("Failed to initialize PhoneDetector:", error)
      throw error
    } finally {
      this.loading = false
    }
  }

  async detectPhone(videoElement: HTMLVideoElement): Promise<PhoneDetection> {
    if (!this.model || !this.initialized) {
      throw new Error("PhoneDetector not initialized")
    }

    try {
      const predictions = await this.model.detect(videoElement)

      // Look for cell phone or remote (can be mistaken for phone)
      const phoneClasses = ["cell phone", "remote"]
      const phoneDetections = predictions.filter((pred) =>
        phoneClasses.includes(pred.class.toLowerCase())
      )

      if (phoneDetections.length > 0) {
        // Return highest confidence detection
        const bestDetection = phoneDetections.reduce((best, current) =>
          current.score > best.score ? current : best
        )

        return {
          detected: bestDetection.score >= VISION_CONFIG.PHONE_DETECTION_CONFIDENCE,
          confidence: bestDetection.score,
          bbox: {
            x: bestDetection.bbox[0],
            y: bestDetection.bbox[1],
            width: bestDetection.bbox[2],
            height: bestDetection.bbox[3],
          },
        }
      }

      return {
        detected: false,
        confidence: 0,
      }
    } catch (error) {
      console.error("Phone detection error:", error)
      return {
        detected: false,
        confidence: 0,
      }
    }
  }

  dispose(): void {
    this.model = null
    this.initialized = false
  }
}
