/**
 * Face detection and landmark extraction using MediaPipe Face Mesh
 *
 * NOTE: `@mediapipe/face_mesh` ships as a browser-global UMD script with no
 * ESM/CJS exports (and it touches `navigator`/`window` at parse time), so it
 * cannot be statically imported by webpack/Turbopack or run under SSR.
 * Instead we lazily inject the script tag client-side and use the
 * `window.FaceMesh` global it defines.
 */

import { VISION_CONFIG } from "./config"

export interface FaceLandmarks {
  landmarks: Array<{ x: number; y: number; z: number }>
  confidence: number
}

interface MediaPipeFaceMeshResults {
  multiFaceLandmarks?: Array<Array<{ x: number; y: number; z?: number }>>
}

interface MediaPipeFaceMeshInstance {
  setOptions: (options: Record<string, unknown>) => void
  onResults: (callback: (results: MediaPipeFaceMeshResults) => void) => void
  send: (input: { image: HTMLVideoElement }) => Promise<void>
  close: () => void
}

declare global {
  interface Window {
    FaceMesh?: new (config: { locateFile: (file: string) => string }) => MediaPipeFaceMeshInstance
  }
}

const MEDIAPIPE_CDN_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh"
const MEDIAPIPE_SCRIPT_URL = `${MEDIAPIPE_CDN_BASE}/face_mesh.js`

let scriptLoadingPromise: Promise<void> | null = null

function loadFaceMeshScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("FaceDetector can only run in the browser"))
  }
  if (window.FaceMesh) {
    return Promise.resolve()
  }
  if (scriptLoadingPromise) {
    return scriptLoadingPromise
  }

  scriptLoadingPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${MEDIAPIPE_SCRIPT_URL}"]`)
    if (existing) {
      existing.addEventListener("load", () => resolve())
      existing.addEventListener("error", () => reject(new Error("Failed to load MediaPipe Face Mesh script")))
      return
    }

    const script = document.createElement("script")
    script.src = MEDIAPIPE_SCRIPT_URL
    script.crossOrigin = "anonymous"
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error("Failed to load MediaPipe Face Mesh script"))
    document.head.appendChild(script)
  })

  return scriptLoadingPromise
}

export class FaceDetector {
  private faceMesh: MediaPipeFaceMeshInstance | null = null
  private initialized = false
  private loading = false

  async initialize(): Promise<void> {
    if (this.initialized || this.loading) return

    this.loading = true
    try {
      await loadFaceMeshScript()

      if (!window.FaceMesh) {
        throw new Error("MediaPipe FaceMesh failed to load")
      }

      this.faceMesh = new window.FaceMesh({
        locateFile: (file) => `${MEDIAPIPE_CDN_BASE}/${file}`,
      })

      this.faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: VISION_CONFIG.FACE_DETECTION_CONFIDENCE,
        minTrackingConfidence: 0.5,
      })

      this.initialized = true
    } catch (error) {
      console.error("Failed to initialize FaceDetector:", error)
      throw error
    } finally {
      this.loading = false
    }
  }

  async detectFace(videoElement: HTMLVideoElement): Promise<FaceLandmarks | null> {
    if (!this.faceMesh || !this.initialized) {
      throw new Error("FaceDetector not initialized")
    }

    return new Promise((resolve) => {
      this.faceMesh!.onResults((results: MediaPipeFaceMeshResults) => {
        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
          const landmarks = results.multiFaceLandmarks[0]
          resolve({
            landmarks: landmarks.map((lm) => ({
              x: lm.x,
              y: lm.y,
              z: lm.z || 0,
            })),
            confidence: 1.0, // MediaPipe doesn't provide per-face confidence
          })
        } else {
          resolve(null)
        }
      })

      this.faceMesh!.send({ image: videoElement })
    })
  }

  dispose(): void {
    if (this.faceMesh) {
      this.faceMesh.close()
      this.faceMesh = null
    }
    this.initialized = false
  }
}
