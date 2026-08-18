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

  const setActiveSessionId = useCallback((id: string | null) => {
    sessionIdRef.current = id
  }, [])

  const setVideoElement = useCallback((element: HTMLVideoElement | null) => {
    videoElementRef.current = element
  }, [])

  const setCalibration = useCallback((calibration: CalibrationModel) => {
    if (processorRef.current) {
      processorRef.current.setCalibration(calibration)
      setCalibrated(true)
    }
  }, [])

  const setEnabled = useCallback(async (enabled: boolean) => {
    enabledRef.current = enabled
    setCollecting(enabled)
    setError(null)

    if (enabled && videoElementRef.current) {
      try {
        // Initialize processor if needed
        if (!processorRef.current) {
          processorRef.current = new VisionProcessor()
          await processorRef.current.initialize()
        }

        // Start processing
        processorRef.current.start(videoElementRef.current, (features) => {
          setLastFeatures(features)
        })

        // Start sending data at regular intervals
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
      }
    } else {
      // Stop processing
      if (sendIntervalRef.current) {
        window.clearInterval(sendIntervalRef.current)
        sendIntervalRef.current = null
      }
      if (processorRef.current) {
        processorRef.current.stop()
      }
    }
  }, [])

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
