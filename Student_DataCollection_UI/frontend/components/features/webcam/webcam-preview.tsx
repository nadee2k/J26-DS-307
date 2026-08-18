"use client"

import { useEffect, useRef, useState } from "react"
import { Eye, EyeOff, Video, VideoOff } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useVision } from "@/hooks/use-vision"

export function WebcamPreview() {
  const [enabled, setEnabled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const { setVideoElement, lastFeatures } = useVision()

  useEffect(() => {
    let cancelled = false

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          // Expose video element to vision processor
          setVideoElement(videoRef.current)
        }
        setError(null)
      } catch {
        setError("Camera unavailable")
        setEnabled(false)
      }
    }

    function stop() {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      if (videoRef.current) videoRef.current.srcObject = null
      setVideoElement(null)
    }

    if (enabled) {
      start()
    } else {
      stop()
    }

    return () => {
      cancelled = true
      stop()
    }
  }, [enabled])

  return (
    <Card className="flex min-h-0 flex-1 flex-col gap-2.5 border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Video
            className={`h-4 w-4 ${enabled ? "text-green-500" : "text-primary"}`}
            aria-hidden="true"
          />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Webcam Monitor
          </h2>
        </div>
        <span className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            {enabled && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60" />
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${
                enabled ? "bg-green-500" : "bg-muted-foreground/50"
              }`}
            />
          </span>
          <span
            className={`font-mono text-[10px] font-semibold uppercase tracking-wider ${
              enabled ? "text-green-400" : "text-muted-foreground"
            }`}
          >
            {enabled ? "Live" : "Off"}
          </span>
        </span>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-background/60">
        {enabled ? (
          <>
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="h-full w-full object-cover"
            />
            {/* Vision status overlay */}
            {lastFeatures && (
              <div className="absolute bottom-2 left-2 flex flex-wrap gap-1">
                {lastFeatures.faceDetected && (
                  <span className="rounded bg-green-500/80 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-white">
                    FACE
                  </span>
                )}
                {lastFeatures.eyeGaze === "on-screen" && (
                  <span className="rounded bg-blue-500/80 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-white">
                    GAZE ON
                  </span>
                )}
                {lastFeatures.eyeGaze === "off-screen" && (
                  <span className="rounded bg-yellow-500/80 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-white">
                    GAZE OFF
                  </span>
                )}
                {lastFeatures.phoneDetected && (
                  <span className="rounded bg-red-500/80 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-white">
                    PHONE
                  </span>
                )}
                <span className="rounded bg-gray-500/80 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-white">
                  {lastFeatures.headDirection.toUpperCase()}
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
            <VideoOff className="h-6 w-6" aria-hidden="true" />
            <span className="font-mono text-[10px] uppercase tracking-wider">
              {error ?? "Feed hidden"}
            </span>
          </div>
        )}
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={() => setEnabled((v) => !v)}
        className="h-8 w-full gap-2 font-mono text-xs"
        aria-pressed={enabled}
      >
        {enabled ? (
          <>
            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
            Hide View
          </>
        ) : (
          <>
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            Show View
          </>
        )}
      </Button>
    </Card>
  )
}
