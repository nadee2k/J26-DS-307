/**
 * Component 3 vision processor: per-frame features at ~3 fps, entirely in browser memory (frames are never stored).
 * Head pose comes from the 3D landmark frame and gaze from the iris position relative to the eye corners
 * (lib/focus/vision-math.ts); the phone detector runs on every third frame (~1 fps) to stay within the frame budget.
 */

import { FaceDetector } from "./face-detector"
import { PhoneDetector } from "./phone-detector"
import { VISION_CONFIG } from "./config"
import type { FrameFeatures } from "@/lib/focus/buffers"
import { eyeBoxes, faceWidth, fixedZone, headPose, imageQuality, irisOffset } from "@/lib/focus/vision-math"
import { predictZone } from "@/lib/focus/zone-model"
import type { ZoneModelJson } from "@/lib/focus/types"

export interface VisionFeatures {
  faceDetected: boolean
  eyeGaze: "on-screen" | "off-screen" | "invalid"
  headDirection: "center" | "left" | "right" | "up" | "down"
  phoneDetected: boolean
  timestamp: number
  frame: FrameFeatures
  processingMs: number
}

export class VisionProcessor {
  private faceDetector = new FaceDetector()
  private phoneDetector = new PhoneDetector()
  private videoElement: HTMLVideoElement | null = null
  private processingInterval: number | null = null
  private lastFeatures: VisionFeatures | null = null
  private isProcessing = false
  private frameCount = 0
  private canvas: HTMLCanvasElement | null = null
  private zoneModel: ZoneModelJson | null = null
  private lastPhone = false

  async initialize(): Promise<void> {
    await this.faceDetector.initialize()
    // the phone detector is optional: if its model cannot load, face/pose/gaze features still work
    try { await this.phoneDetector.initialize() } catch (e) { console.warn("Phone detector unavailable:", e) }
  }

  setZoneModel(model: ZoneModelJson | null) { this.zoneModel = model }

  async start(videoElement: HTMLVideoElement, onFeatures: (features: VisionFeatures) => void): Promise<void> {
    if (this.processingInterval) this.stop()
    this.videoElement = videoElement
    this.processingInterval = window.setInterval(async () => {
      if (this.isProcessing || !this.videoElement) return
      this.isProcessing = true
      try {
        const features = await this.processFrame(this.videoElement)
        if (features) { this.lastFeatures = features; onFeatures(features) }
      } catch (error) {
        console.error("Frame processing error:", error)
      } finally {
        this.isProcessing = false
      }
    }, 1000 / VISION_CONFIG.TARGET_FPS)
  }

  stop(): void {
    if (this.processingInterval) { window.clearInterval(this.processingInterval); this.processingInterval = null }
    this.videoElement = null
    this.lastFeatures = null
  }

  private grab(video: HTMLVideoElement): ImageData | null {
    if (!this.canvas) { this.canvas = document.createElement("canvas"); this.canvas.width = 320; this.canvas.height = 240 }
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx || video.videoWidth === 0) return null
    ctx.drawImage(video, 0, 0, 320, 240)
    return ctx.getImageData(0, 0, 320, 240)
  }

  async processFrame(video: HTMLVideoElement): Promise<VisionFeatures | null> {
    const t0 = performance.now()
    if (video.readyState < 2 || video.videoWidth === 0) return null
    this.frameCount++
    const lm = await this.faceDetector.detectFace(video)
    const img = this.grab(video)
    const w = video.videoWidth, h = video.videoHeight

    // phone check at ~1 fps; a phone may be visible even when the face is not
    let phone: boolean | null = null, phoneScore = 0
    if (this.frameCount % 3 === 0 && performance.now() - t0 < VISION_CONFIG.MAX_PROCESSING_TIME_MS) {
      try { const d = await this.phoneDetector.detectPhone(video); phone = d.detected; phoneScore = d.confidence; this.lastPhone = d.detected } catch { phone = null }
    }

    let frame: FrameFeatures
    if (!lm) {
      frame = { t: Date.now(), face: false, yaw: 0, pitch: 0, roll: 0, irisX: 0, irisY: 0, faceSize: 0, luminance: img ? imageQuality(img, []).luminance : 0, glare: 0, phone, phoneScore, zone: -1, zoneProb: 0 }
    } else {
      const pose = headPose(lm.landmarks, w, h)
      const iris = irisOffset(lm.landmarks, w, h) ?? { x: 0, y: 0 }
      const q = img ? imageQuality(img, eyeBoxes(lm.landmarks)) : { luminance: 0, glare: 0 }
      const base = { irisX: iris.x, irisY: iris.y, pitch: pose.pitch, yaw: pose.yaw }
      const z = this.zoneModel ? predictZone(this.zoneModel, base) : null
      frame = { t: Date.now(), face: true, ...pose, irisX: iris.x, irisY: iris.y, faceSize: faceWidth(lm.landmarks), luminance: q.luminance, glare: q.glare, phone, phoneScore, zone: z ? z.zone : -1, zoneProb: z ? z.prob : 0 }
    }

    // categorical fields kept for the shared data-collection logs
    const zone = frame.face ? (frame.zone >= 0 ? frame.zone : fixedZone(frame.pitch, frame.yaw)) : -1
    const dir: VisionFeatures["headDirection"] = !frame.face ? "center" : frame.pitch > 20 ? "down" : frame.pitch < -15 ? "up" : frame.yaw < -20 ? "left" : frame.yaw > 20 ? "right" : "center"
    return {
      faceDetected: frame.face,
      eyeGaze: zone === -1 ? "invalid" : zone === 0 ? "on-screen" : "off-screen",
      headDirection: dir,
      phoneDetected: phone ?? this.lastPhone,
      timestamp: frame.t,
      frame,
      processingMs: performance.now() - t0,
    }
  }

  getLastFeatures(): VisionFeatures | null { return this.lastFeatures }

  dispose(): void {
    this.stop()
    this.faceDetector.dispose()
    this.phoneDetector.dispose()
  }
}
