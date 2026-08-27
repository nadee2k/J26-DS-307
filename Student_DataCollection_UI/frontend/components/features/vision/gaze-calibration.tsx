"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { FaceDetector } from "@/lib/vision/face-detector"
import { type CalibrationModel } from "@/lib/vision/gaze-tracker"
import { VISION_CONFIG } from "@/lib/vision/config"

interface CalibrationPoint {
  x: number
  y: number
  label: string
}

const CALIBRATION_POINTS: CalibrationPoint[] = [
  { x: 0.1, y: 0.1, label: "top-left" },
  { x: 0.5, y: 0.1, label: "top-center" },
  { x: 0.9, y: 0.1, label: "top-right" },
  { x: 0.1, y: 0.5, label: "middle-left" },
  { x: 0.5, y: 0.5, label: "center" },
  { x: 0.9, y: 0.5, label: "middle-right" },
  { x: 0.1, y: 0.9, label: "bottom-left" },
  { x: 0.5, y: 0.9, label: "bottom-center" },
  { x: 0.9, y: 0.9, label: "bottom-right" },
]

const OFF_SCREEN_PROMPTS = [
  "Look LEFT (away from screen)",
  "Look RIGHT (away from screen)",
  "Look UP (ceiling)",
  "Look DOWN (keyboard/desk)",
]

interface GazeCalibrationProps {
  videoElement: HTMLVideoElement
  onComplete: (calibration: CalibrationModel) => void
  onCancel: () => void
}

export function GazeCalibration({ videoElement, onComplete, onCancel }: GazeCalibrationProps) {
  const [step, setStep] = useState<"intro" | "loading" | "onscreen" | "offscreen" | "training">("loading")
  const [currentPointIndex, setCurrentPointIndex] = useState(0)
  const [currentPromptIndex, setCurrentPromptIndex] = useState(0)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState("Loading the vision model...")
  const [loadError, setLoadError] = useState<string | null>(null)

  const faceDetectorRef = useRef<FaceDetector | null>(null)
  const calibrationDataRef = useRef<CalibrationModel>({
    onScreenSamples: [],
    offScreenSamples: [],
    trained: false,
  })
  // Guards every async loop below so that if this component unmounts (cancel,
  // a dev Fast Refresh reload, or the parent removing the modal) mid-collection,
  // the in-flight recursive collectOnScreenPoint/collectSamples chain stops
  // immediately instead of spinning forever against a disposed FaceDetector.
  const activeRef = useRef(true)

  useEffect(() => {
    activeRef.current = true
    const detector = new FaceDetector()
    detector
      .initialize()
      .then(() => {
        if (!activeRef.current) return
        faceDetectorRef.current = detector
        setStep("intro")
        setMessage("Get ready to calibrate your gaze...")
      })
      .catch((error) => {
        if (!activeRef.current) return
        console.error("Failed to load vision model for calibration:", error)
        setLoadError("Could not load the vision model. Check your internet connection and try again.")
      })

    return () => {
      activeRef.current = false
      detector.dispose()
    }
  }, [])

  const collectSamples = async (targetPoint?: { x: number; y: number }) => {
    if (!faceDetectorRef.current) return []

    const samples: Array<{ iris: { x: number; y: number }; target?: { x: number; y: number } }> = []
    const sampleCount = VISION_CONFIG.CALIBRATION_SAMPLES_PER_POINT

    for (let i = 0; i < sampleCount; i++) {
      if (!activeRef.current) break
      try {
        const landmarks = await faceDetectorRef.current.detectFace(videoElement)
        if (landmarks && landmarks.landmarks.length > 468) {
          // Extract iris position (simplified)
          const leftIrisPoints = [468, 469, 470, 471, 472]
          const rightIrisPoints = [473, 474, 475, 476, 477]

          const leftX = leftIrisPoints.reduce((sum, idx) => sum + landmarks.landmarks[idx].x, 0) / 5
          const leftY = leftIrisPoints.reduce((sum, idx) => sum + landmarks.landmarks[idx].y, 0) / 5
          const rightX = rightIrisPoints.reduce((sum, idx) => sum + landmarks.landmarks[idx].x, 0) / 5
          const rightY = rightIrisPoints.reduce((sum, idx) => sum + landmarks.landmarks[idx].y, 0) / 5

          const irisX = (leftX + rightX) / 2
          const irisY = (leftY + rightY) / 2

          samples.push({
            iris: { x: irisX, y: irisY },
            target: targetPoint,
          })
        }
      } catch (error) {
        // Skip this frame rather than aborting the whole calibration point.
        console.warn("Skipped a calibration sample due to a detection error:", error)
      }

      setProgress(((i + 1) / sampleCount) * 100)
      await new Promise((resolve) => setTimeout(resolve, VISION_CONFIG.CALIBRATION_SAMPLE_DELAY_MS))
    }

    return samples
  }

  const startCalibration = () => {
    setStep("onscreen")
    setMessage("Look at the dot and keep your head still")
    collectOnScreenPoint(0)
  }

  // Takes the point index explicitly (instead of reading `currentPointIndex`
  // state) because this function recurses on itself before React re-renders,
  // so the state value captured in the closure would otherwise stay stale
  // across iterations and the loop would keep re-collecting the same point.
  const collectOnScreenPoint = async (pointIndex: number) => {
    if (!activeRef.current) return

    if (pointIndex >= CALIBRATION_POINTS.length) {
      setStep("offscreen")
      setCurrentPromptIndex(0)
      setMessage(OFF_SCREEN_PROMPTS[0])
      return
    }

    setCurrentPointIndex(pointIndex)
    const point = CALIBRATION_POINTS[pointIndex]
    setProgress(0)

    const samples = await collectSamples(point)
    if (!activeRef.current) return

    if (samples) {
      calibrationDataRef.current.onScreenSamples.push(...samples)
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
    if (!activeRef.current) return

    const nextIndex = pointIndex + 1
    if (nextIndex < CALIBRATION_POINTS.length) {
      collectOnScreenPoint(nextIndex)
    } else {
      setStep("offscreen")
      setCurrentPromptIndex(0)
      setMessage(OFF_SCREEN_PROMPTS[0])
    }
  }

  // Same rationale as collectOnScreenPoint: pass the prompt index explicitly.
  const collectOffScreenSample = async (promptIndex: number = currentPromptIndex) => {
    if (!activeRef.current) return

    setProgress(0)
    const samples = await collectSamples()
    if (!activeRef.current) return

    if (samples) {
      calibrationDataRef.current.offScreenSamples.push(...samples)
    }

    const nextIndex = promptIndex + 1
    if (nextIndex < OFF_SCREEN_PROMPTS.length) {
      setCurrentPromptIndex(nextIndex)
      setMessage(OFF_SCREEN_PROMPTS[nextIndex])
    } else {
      trainModel()
    }
  }

  const trainModel = () => {
    setStep("training")
    setMessage("Training calibration model...")
    setProgress(100)

    // Mark as trained
    calibrationDataRef.current.trained = true

    setTimeout(() => {
      if (!activeRef.current) return
      onComplete(calibrationDataRef.current)
    }, 1000)
  }

  const currentPoint = step === "onscreen" ? CALIBRATION_POINTS[currentPointIndex] : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
      {/* Calibration dot */}
      {step === "onscreen" && currentPoint && (
        <div
          className="absolute h-8 w-8 rounded-full bg-green-500 shadow-lg shadow-green-500/50 animate-pulse"
          style={{
            left: `${currentPoint.x * 100}%`,
            top: `${currentPoint.y * 100}%`,
            transform: "translate(-50%, -50%)",
          }}
        />
      )}

      {/* Instructions overlay */}
      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 flex flex-col items-center gap-4 text-center">
        <div className="rounded-lg bg-black/80 px-8 py-4 backdrop-blur-sm">
          <p className="text-lg font-medium text-white">{message}</p>
          {step !== "intro" && (
            <div className="mt-3 h-2 w-64 overflow-hidden rounded-full bg-gray-700">
              <div
                className="h-full bg-green-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>

        {loadError && (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-red-400">{loadError}</p>
            <Button onClick={onCancel} variant="outline" size="lg">
              Cancel
            </Button>
          </div>
        )}

        {step === "loading" && !loadError && (
          <Button variant="outline" size="lg" disabled>
            Loading...
          </Button>
        )}

        {step === "intro" && !loadError && (
          <div className="flex gap-3">
            <Button onClick={startCalibration} size="lg">
              Start Calibration
            </Button>
            <Button onClick={onCancel} variant="outline" size="lg">
              Cancel
            </Button>
          </div>
        )}

        {step === "offscreen" && progress >= 100 && (
          <Button onClick={() => collectOffScreenSample()} size="lg">
            Next
          </Button>
        )}

        {(step === "onscreen" || step === "offscreen" || step === "training") && (
          <Button onClick={onCancel} variant="ghost" size="sm" className="text-gray-400">
            Cancel Calibration
          </Button>
        )}
      </div>
    </div>
  )
}
