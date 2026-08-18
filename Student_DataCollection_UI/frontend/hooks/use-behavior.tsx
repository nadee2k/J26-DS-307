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
import { behaviorLogs } from "@/lib/api"

type BehaviorSnapshot = {
  keyboardCount: number
  mouseMovement: number
  mouseClicks: number
  idleTime: number
  activeApplication: string
}

type BehaviorContextType = {
  collecting: boolean
  lastSnapshot: BehaviorSnapshot | null
  setEnabled: (enabled: boolean) => void
  setActiveSessionId: (id: string | null) => void
}

const BehaviorContext = createContext<BehaviorContextType>({
  collecting: false,
  lastSnapshot: null,
  setEnabled: () => {},
  setActiveSessionId: () => {},
})

export function BehaviorProvider({ children }: { children: ReactNode }) {
  const [collecting, setCollecting] = useState(false)
  const [lastSnapshot, setLastSnapshot] = useState<BehaviorSnapshot | null>(null)

  const sessionIdRef = useRef<string | null>(null)
  const enabledRef = useRef(false)
  const countsRef = useRef({
    keys: 0,
    clicks: 0,
    mouse: 0,
    lastX: null as number | null,
    lastY: null as number | null,
    lastActivity: Date.now(),
  })

  const setActiveSessionId = useCallback((id: string | null) => {
    sessionIdRef.current = id
  }, [])

  const setEnabled = useCallback((enabled: boolean) => {
    enabledRef.current = enabled
    setCollecting(enabled)
    if (enabled) {
      countsRef.current.lastActivity = Date.now()
    }
  }, [])

  useEffect(() => {
    const markActivity = () => {
      countsRef.current.lastActivity = Date.now()
    }

    const onKey = () => {
      if (!enabledRef.current) return
      countsRef.current.keys += 1
      markActivity()
    }

    const onClick = () => {
      if (!enabledRef.current) return
      countsRef.current.clicks += 1
      markActivity()
    }

    const onMove = (event: MouseEvent) => {
      if (!enabledRef.current) return
      const counts = countsRef.current
      if (counts.lastX !== null && counts.lastY !== null) {
        counts.mouse += Math.hypot(event.clientX - counts.lastX, event.clientY - counts.lastY)
      }
      counts.lastX = event.clientX
      counts.lastY = event.clientY
      markActivity()
    }

    window.addEventListener("keydown", onKey)
    window.addEventListener("mousedown", onClick)
    window.addEventListener("mousemove", onMove)

    const interval = window.setInterval(async () => {
      if (!enabledRef.current) return
      const sessionId = sessionIdRef.current
      if (!sessionId) return

      const counts = countsRef.current
      const snapshot: BehaviorSnapshot = {
        keyboardCount: counts.keys,
        mouseMovement: Math.round(counts.mouse * 100) / 100,
        mouseClicks: counts.clicks,
        idleTime: Math.round(((Date.now() - counts.lastActivity) / 1000) * 10) / 10,
        activeApplication: document.hidden ? "away" : document.title || "FocusTrack",
      }
      counts.keys = 0
      counts.mouse = 0
      counts.clicks = 0

      setLastSnapshot(snapshot)
      try {
        await behaviorLogs.create({
          sessionId,
          keyboardCount: snapshot.keyboardCount,
          mouseMovement: snapshot.mouseMovement,
          mouseClicks: snapshot.mouseClicks,
          idleTime: snapshot.idleTime,
          activeApplication: snapshot.activeApplication,
        })
      } catch (err) {
        console.error("Failed to save behavior log", err)
      }
    }, 2000)

    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("mousedown", onClick)
      window.removeEventListener("mousemove", onMove)
      window.clearInterval(interval)
    }
  }, [])

  return (
    <BehaviorContext.Provider
      value={{ collecting, lastSnapshot, setEnabled, setActiveSessionId }}
    >
      {children}
    </BehaviorContext.Provider>
  )
}

export function useBehavior() {
  return useContext(BehaviorContext)
}
