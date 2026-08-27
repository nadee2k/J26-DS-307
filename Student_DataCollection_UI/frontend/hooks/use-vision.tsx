"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { visionLogs } from "@/lib/api"
import { VisionProcessor, type VisionFeatures, type CalibrationModel } from "@/lib/vision"
import { VISION_CONFIG } from "@/lib/vision/config"

type VisionContextType = {
  collecting: boolean
  calibrated: boolean
  lastFeatures: VisionFeatures | null
  error: string | null
  setEnabled: (enabled: boolean) => void
  setActiveSessionId: (id: string | null) => void
  setCalibration: (calibration: CalibrationModel) => void
  setVideoElement: (element: HTMLVideoElement | null) => void
}

const VisionContext = createContext<VisionContextType>({
  collecting: false,
  calibrated: false,
  lastFeatures: null,
  error: null,
  setEnabled: () => {},
  setActiveSessionId: () => {},
  setCalibration: () => {},
  setVideoElement: () => {},
})

export function VisionProvider({ children }: { children: ReactNode }) {
  const [collecting, setCollecting] = useState(false)
  const [calibrated, setCalibrated] = useState(false)
  const [lastFeatures, setLastFeatures] = useState<VisionFeatures | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sessionIdRef = useRef<string | null>(null)
  const enabledRef = useRef(false)
  const videoElementRef = useRef<HTMLVideoElement | null>(null)
  const processorRef = useRef<VisionProcessor | null>(null)
  const sendIntervalRef = useRef<number | null>(null)
  // Tracks which <video> element the processor is currently bound to, so we
  // can detect when the page swaps in a different video element (e.g. the
  // idle-state webcam preview unmounts and the running-state one mounts a
  // fresh <video> a moment later) and (re)bind processing to it.
  const runningVideoElementRef = useRef<HTMLVideoElement | null>(null)
  const startingRef = useRef(false)

  const setActiveSessionId = useCallback((id: string | null) => {
    sessionIdRef.current = id
  }, [])

  const setCalibration = useCallback((calibration: CalibrationModel) => {
    if (processorRef.current) {
      processorRef.current.setCalibration(calibration)
      setCalibrated(true)
    }
  }, [])

  const stopProcessing = useCallback(() => {
    if (sendIntervalRef.current) {
      window.clearInterval(sendIntervalRef.current)
      sendIntervalRef.current = null
    }
    if (processorRef.current) {
      processorRef.current.stop()
    }
    runningVideoElementRef.current = null
  }, [])

  // Idempotent: safe to call whenever enabled + video-element state changes
  // (from setEnabled or setVideoElement), regardless of which one fires first.
  const startProcessing = useCallback(async () => {
    const videoElement = videoElementRef.current
    if (!enabledRef.current || !videoElement) return
    if (runningVideoElementRef.current === videoElement || startingRef.current) return

    startingRef.current = true
    try {
      // Always (re-)initialize: initialize() is a cheap no-op once a
      // detector is already loaded, but if the processor had been fully
      // disposed (e.g. on a previous provider unmount / Fast Refresh),
      // reusing it without re-initializing would leave FaceDetector /
      // PhoneDetector permanently "not initialized" for the new session.
      if (!processorRef.current) {
        processorRef.current = new VisionProcessor()
      }
      await processorRef.current.initialize()

      // Bail out if disabled or swapped to a different video element while
      // we were awaiting initialize() above.
      if (!enabledRef.current || videoElementRef.current !== videoElement) return

      processorRef.current.start(videoElement, (features) => {
        setLastFeatures(features)
      })
      runningVideoElementRef.current = videoElement

      if (sendIntervalRef.current) {
        window.clearInterval(sendIntervalRef.current)
      }
      sendIntervalRef.current = window.setInterval(async () => {
        if (!enabledRef.current) return
        const sessionId = sessionIdRef.current
        const features = processorRef.current?.getLastFeatures()

        if (!sessionId || !features) return

        try {
          await visionLogs.create({
            sessionId,
            faceDetected: features.faceDetected,
            eyeGaze: features.eyeGaze,
            headDirection: features.headDirection,
            phoneDetected: features.phoneDetected,
          })
        } catch (err) {
          console.error("Failed to save vision log", err)
        }
      }, VISION_CONFIG.SEND_INTERVAL_MS)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start vision processing")
      setCollecting(false)
    } finally {
      startingRef.current = false
    }
  }, [])

  const setVideoElement = useCallback((element: HTMLVideoElement | null) => {
    videoElementRef.current = element
    if (!element) {
      // The video feed went away (e.g. webcam preview unmounted); stop
      // processing but keep enabledRef as-is so we resume automatically
      // once a new video element is provided.
      if (runningVideoElementRef.current) {
        stopProcessing()
      }
      return
    }
    void startProcessing()
  }, [startProcessing, stopProcessing])

  const setEnabled = useCallback((enabled: boolean) => {
    enabledRef.current = enabled
    setCollecting(enabled)
    setError(null)

    if (enabled) {
      // No-op if the video element isn't ready yet; setVideoElement will
      // call startProcessing again once it arrives.
      void startProcessing()
    } else {
      stopProcessing()
    }
  }, [startProcessing, stopProcessing])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sendIntervalRef.current) {
        window.clearInterval(sendIntervalRef.current)
      }
      if (processorRef.current) {
        processorRef.current.dispose()
      }
    }
  }, [])

  return (
    <VisionContext.Provider
      value={{
        collecting,
        calibrated,
        lastFeatures,
        error,
        setEnabled,
        setActiveSessionId,
        setCalibration,
        setVideoElement,
      }}
    >
      {children}
    </VisionContext.Provider>
  )
}

export function useVision() {
  return useContext(VisionContext)
}
