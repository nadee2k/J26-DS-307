"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { Play, Square, Pause, Eye, EyeOff, Gauge, Wifi, Keyboard } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { AppShell } from "@/components/layout/app-shell"
import { Esp32ConnectPanel } from "@/components/features/telemetry/esp32-connect-panel"
import { BehaviorEnablePanel } from "@/components/features/telemetry/behavior-enable-panel"
import { LocationPicker } from "@/components/features/session/location-picker"
import { useAuth } from "@/hooks/use-auth"
import { useBehavior } from "@/hooks/use-behavior"
import { useEsp32 } from "@/hooks/use-esp32"
import { useVision } from "@/hooks/use-vision"
import { GazeCalibration } from "@/components/features/vision/gaze-calibration"
import { sessions, concentrationLogs, dataSources } from "@/lib/api"
import { TASK_OPTIONS, CONCENTRATION_LEVELS, ENVIRONMENT_OPTIONS, isLocationReady, locationSelectValue, locationOtherValue, resolvedLocation } from "@/lib/constants"
import { formatSriLankaTime } from "@/lib/utils"
import type { StudySession, SessionState, ConcentrationLevel } from "@/types"
import type { DataSourcesStatus } from "@/lib/api"

function DataSourceIndicator({
  label,
  icon: Icon,
  color,
  status,
  consented,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  color: string
  status: { active: boolean; lastSeen: string | null; count: number } | null
  consented: boolean
}) {
  const isActive = consented && (status?.active ?? false)
  const count = status?.count ?? 0

  let badge = "OFF"
  let badgeClass = "bg-red-500/10 text-red-400 ring-1 ring-inset ring-red-500/20"
  if (!consented) {
    badge = "NO CONSENT"
    badgeClass = "bg-secondary text-muted-foreground ring-1 ring-inset ring-border"
  } else if (isActive) {
    badge = "ACTIVE"
    badgeClass = "bg-emerald-500/10 text-emerald-400 ring-1 ring-inset ring-emerald-500/20"
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2">
      <Icon className={`h-3.5 w-3.5 ${isActive ? "text-emerald-400" : color}`} />
      <span className="text-[11px] font-medium">{label}</span>
      <span className="ml-auto text-[9px] font-mono text-muted-foreground">
        {consented && count > 0 && `${count} msgs`}
      </span>
      <span className={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold ${badgeClass}`}>
        {badge}
      </span>
    </div>
  )
}

export default function StudySessionPage() {
  const { student, isLoading } = useAuth()
  const { connected: esp32Connected, setActiveSessionId } = useEsp32()
  const {
    collecting: behaviorCollecting,
    setEnabled: setBehaviorEnabled,
    setActiveSessionId: setBehaviorSessionId,
  } = useBehavior()
  const {
    collecting: visionCollecting,
    calibrated: visionCalibrated,
    setEnabled: setVisionEnabled,
    setActiveSessionId: setVisionSessionId,
    setCalibration: setVisionCalibration,
  } = useVision()
  const router = useRouter()
  
  const [showCalibration, setShowCalibration] = useState(false)
  const videoElementRef = useRef<HTMLVideoElement | null>(null)

  const [activeSession, setActiveSession] = useState<StudySession | null>(null)
  const [sessionState, setSessionState] = useState<SessionState>("idle")

  const [taskType, setTaskType] = useState("")
  const [location, setLocation] = useState("")
  const [locationOther, setLocationOther] = useState("")
  const [expectedDuration, setExpectedDuration] = useState("")

  const [concentration, setConcentration] = useState<ConcentrationLevel>(3)
  const [environment, setEnvironment] = useState("")
  const [showReport, setShowReport] = useState(false)

  const [consentVision, setConsentVision] = useState(false)
  const [consentBehavior, setConsentBehavior] = useState(false)
  const [startError, setStartError] = useState("")

  const [editing, setEditing] = useState(false)
  const [editTaskType, setEditTaskType] = useState("")
  const [editLocation, setEditLocation] = useState("")
  const [editLocationOther, setEditLocationOther] = useState("")
  const [editDuration, setEditDuration] = useState("")

  const [elapsed, setElapsed] = useState(0)
  const [sourceStatus, setSourceStatus] = useState<DataSourcesStatus | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const reportTimerRef = useRef<NodeJS.Timeout | null>(null)
  const statusTimerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!isLoading && !student) {
      router.push("/login")
    }
  }, [student, isLoading, router])

  useEffect(() => {
    if (sessionState === "running" && activeSession) {
      const startTime = new Date(activeSession.startedAt!).getTime()
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTime) / 1000))
      }, 1000)

      reportTimerRef.current = setInterval(() => {
        setShowReport(true)
      }, 15 * 60 * 1000)

      statusTimerRef.current = setInterval(() => {
        dataSources.status(activeSession.id).then(setSourceStatus).catch(() => {})
      }, 2000)

      return () => {
        if (timerRef.current) clearInterval(timerRef.current)
        if (reportTimerRef.current) clearTimeout(reportTimerRef.current)
        if (statusTimerRef.current) clearInterval(statusTimerRef.current)
      }
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
      if (statusTimerRef.current) clearInterval(statusTimerRef.current)
    }
  }, [sessionState, activeSession])

  useEffect(() => {
    if (sessionState === "running" && activeSession) {
      setActiveSessionId(activeSession.id)
      setBehaviorSessionId(activeSession.id)
      setVisionSessionId(activeSession.id)
      setBehaviorEnabled(consentBehavior)
      setVisionEnabled(consentVision)
    } else {
      setActiveSessionId(null)
      setBehaviorEnabled(false)
      setVisionEnabled(false)
      if (sessionState !== "paused") {
        setBehaviorSessionId(null)
        setVisionSessionId(null)
      }
    }
  }, [
    sessionState,
    activeSession,
    consentBehavior,
    consentVision,
    setActiveSessionId,
    setBehaviorSessionId,
    setVisionSessionId,
    setBehaviorEnabled,
    setVisionEnabled,
  ])

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
  }

  const canStart = Boolean(
    taskType &&
      isLocationReady(location, locationOther) &&
      expectedDuration &&
      Number(expectedDuration) > 0 &&
      esp32Connected &&
      consentBehavior,
  )

  const handleCreateAndStart = async () => {
    if (!student || !canStart) {
      setStartError("Fill task, location, duration, then connect ESP32 and enable Behavior Logger.")
      return
    }
    
    // If vision consent is given, show calibration first
    if (consentVision && !visionCalibrated) {
      // Get video element
      const videoElements = document.querySelectorAll('video')
      if (videoElements.length > 0) {
        videoElementRef.current = videoElements[0] as HTMLVideoElement
        setShowCalibration(true)
      } else {
        setStartError("Please show the webcam view before starting with vision consent.")
      }
      return
    }
    
    setStartError("")
    try {
      const session = await sessions.create({
        studentId: student.id,
        taskType: taskType as any,
        location: resolvedLocation(location, locationOther),
        expectedDuration: parseInt(expectedDuration),
        status: "idle",
      })
      const started = await sessions.start(session.id)
      setActiveSession(started)
      setSessionState("running")
    } catch (err) {
      console.error("Failed to create session")
      const message = err instanceof Error ? err.message : ""
      if (/location|check constraint/i.test(message)) {
        setStartError("Run the location SQL in Supabase first, then try again.")
      } else {
        setStartError("Could not start the session. Try again.")
      }
    }
  }
  
  const handleCalibrationComplete = async (calibration: any) => {
    setVisionCalibration(calibration)
    setShowCalibration(false)
    // Now actually start the session
    if (!student) return
    
    try {
      const session = await sessions.create({
        studentId: student.id,
        taskType: taskType as any,
        location: resolvedLocation(location, locationOther),
        expectedDuration: parseInt(expectedDuration),
        status: "idle",
      })
      const started = await sessions.start(session.id)
      setActiveSession(started)
      setSessionState("running")
    } catch (err) {
      console.error("Failed to create session")
      setStartError("Could not start the session. Try again.")
    }
  }
  
  const handleCalibrationCancel = () => {
    setShowCalibration(false)
    setStartError("Calibration cancelled. Uncheck vision consent if you don't want to use it.")
  }

  const handlePause = async () => {
    if (!activeSession) return
    if (sessionState === "running") {
      const paused = await sessions.pause(activeSession.id)
      setActiveSession(paused)
      setSessionState("paused")
    } else {
      const resumed = await sessions.resume(activeSession.id)
      setActiveSession(resumed)
      setSessionState("running")
    }
  }

  const handleStop = async () => {
    if (!activeSession) return
    try {
      const stopped = await sessions.stop(activeSession.id)
      setActiveSession(stopped)
      setSessionState("completed")
      if (timerRef.current) clearInterval(timerRef.current)
      if (reportTimerRef.current) clearTimeout(reportTimerRef.current)
      if (statusTimerRef.current) clearInterval(statusTimerRef.current)
      setSourceStatus(null)
      setEditing(false)
    } catch {
      console.error("Failed to stop session")
    }
  }

  const startEditing = () => {
    setEditTaskType(taskType)
    setEditLocation(locationSelectValue(location))
    setEditLocationOther(location === "other" ? locationOther : locationOtherValue(location))
    setEditDuration(expectedDuration)
    setEditing(true)
  }

  const handleEditSave = async () => {
    if (!activeSession) return
    try {
      if (!isLocationReady(editLocation, editLocationOther) || !editDuration) return
      const updated = await sessions.update(activeSession.id, {
        taskType: editTaskType as any,
        location: resolvedLocation(editLocation, editLocationOther),
        expectedDuration: parseInt(editDuration),
      })
      setActiveSession(updated)
      setTaskType(editTaskType)
      setLocation(editLocation)
      setLocationOther(editLocationOther)
      setExpectedDuration(editDuration)
      setEditing(false)
    } catch {
      console.error("Failed to update session")
    }
  }

  const submitConcentration = useCallback(async () => {
    if (!activeSession) return
    try {
      await concentrationLogs.create({
        sessionId: activeSession.id,
        level: concentration,
        environment: (environment as any) || "campus",
      })
      setShowReport(false)
    } catch {
      console.error("Failed to submit concentration log")
    }
  }, [activeSession, concentration, environment])

  const isActive = sessionState === "running" || sessionState === "paused"

  if (isLoading || !student) return null

  return (
    <AppShell studentName={student.name}>
      <div className="flex flex-col gap-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-[#8b6bb0]">Collection</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Study Session</h1>
          <p className="mt-1 text-sm text-muted-foreground">Fill the form, connect sensors, then start.</p>
        </div>

        {sessionState === "idle" && (
          <Card className="border-white/10 bg-card/80 p-6 shadow-sm">
            <div className="mb-6">
              <h2 className="text-lg font-semibold">Start a study session</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Fill every field, connect the ESP32, and enable the Behavior Logger.
              </p>
            </div>
            <div className="grid gap-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Task *</Label>
                  <Select value={taskType} onValueChange={setTaskType}>
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Select task" />
                    </SelectTrigger>
                    <SelectContent>
                      {TASK_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <LocationPicker
                  location={location}
                  locationOther={locationOther}
                  onLocationChange={setLocation}
                  onOtherChange={setLocationOther}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Expected Duration (minutes) *</Label>
                <Input
                  type="number"
                  value={expectedDuration}
                  onChange={(e) => setExpectedDuration(e.target.value)}
                  placeholder="60"
                  min={1}
                  className="h-10"
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Esp32ConnectPanel required />
                <BehaviorEnablePanel
                  required
                  enabled={consentBehavior}
                  onChange={setConsentBehavior}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <span className={`rounded-full px-3 py-1 text-[11px] font-medium ring-1 ring-inset ${
                  taskType && isLocationReady(location, locationOther) && expectedDuration
                    ? "bg-emerald-100 text-emerald-800 ring-emerald-200"
                    : "bg-stone-100 text-muted-foreground ring-stone-200"
                }`}>
                  1. Session details
                </span>
                <span className={`rounded-full px-3 py-1 text-[11px] font-medium ring-1 ring-inset ${
                  esp32Connected
                    ? "bg-emerald-100 text-emerald-800 ring-emerald-200"
                    : "bg-stone-100 text-muted-foreground ring-stone-200"
                }`}>
                  2. ESP32 {esp32Connected ? "ready" : "not connected"}
                </span>
                <span className={`rounded-full px-3 py-1 text-[11px] font-medium ring-1 ring-inset ${
                  consentBehavior
                    ? "bg-emerald-100 text-emerald-800 ring-emerald-200"
                    : "bg-stone-100 text-muted-foreground ring-stone-200"
                }`}>
                  3. Behavior {consentBehavior ? "enabled" : "permission needed"}
                </span>
              </div>

              {startError && <p className="text-xs text-red-600">{startError}</p>}
              <button
                onClick={handleCreateAndStart}
                disabled={!canStart}
                className="flex items-center justify-center gap-2 rounded-2xl bg-[#7b3fa0] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#6b4c9a] disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-500"
              >
                <Play className="h-4 w-4 fill-current" />
                START SESSION
              </button>
              {!canStart && (
                <p className="text-center text-[12px] text-muted-foreground">
                  Task, location, duration, ESP32, and Behavior Logger are all required.
                </p>
              )}
            </div>
          </Card>
        )}

        {isActive && (
          <>
            <Card className="border-white/10 bg-card/80 p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-3 w-3">
                      <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${
                        sessionState === "running" ? "bg-emerald-400" : "bg-amber-400"
                      }`} />
                      <span className={`relative inline-flex h-3 w-3 rounded-full ${
                        sessionState === "running" ? "bg-emerald-400" : "bg-amber-400"
                      }`} />
                    </span>
                    <span className="text-sm font-semibold uppercase tracking-wider">
                      {sessionState === "running" ? "Session Active" : "Session Paused"}
                    </span>
                  </div>
                  {!editing && (
                    <div className="mt-1">
                      <p className="text-xs text-muted-foreground">
                        {taskType} | {location || "No location"} | Started {activeSession ? formatSriLankaTime(activeSession.startedAt) : ""}
                      </p>
                      {activeSession && (
                        <button
                          type="button"
                          onClick={() => navigator.clipboard.writeText(activeSession.id)}
                          className="mt-1 font-mono text-[11px] text-primary hover:underline"
                          title="Copy session ID for the ESP32 logger"
                        >
                          Session ID: {activeSession.id}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {!editing ? (
                    <button
                      onClick={startEditing}
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary"
                    >
                      Edit
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={handleEditSave}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditing(false)}
                        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  <div className="font-mono text-3xl font-bold tabular-nums text-primary">
                    {formatTime(elapsed)}
                  </div>
                </div>
              </div>

              {editing && (
                <div className="mt-4 grid grid-cols-3 gap-3 rounded-md border border-primary/30 bg-primary/5 p-4">
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Task</Label>
                    <Select value={editTaskType} onValueChange={setEditTaskType}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TASK_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <LocationPicker
                    location={editLocation}
                    locationOther={editLocationOther}
                    onLocationChange={setEditLocation}
                    onOtherChange={setEditLocationOther}
                  />
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Duration (min)</Label>
                    <Input
                      type="number"
                      value={editDuration}
                      onChange={(e) => setEditDuration(e.target.value)}
                      placeholder="60"
                      min={1}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              )}

              {!esp32Connected && (
                <p className="mt-3 text-xs text-amber-400">
                  ESP32 is disconnected. Reconnect the board or sensor data will stop.
                </p>
              )}
              <div className="mt-4">
                <Esp32ConnectPanel required />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <DataSourceIndicator
                  label="ESP32"
                  icon={Wifi}
                  color="text-orange-400"
                  status={
                    esp32Connected
                      ? {
                          active: true,
                          lastSeen: sourceStatus?.environment?.lastSeen ?? null,
                          count: sourceStatus?.environment?.count ?? 0,
                        }
                      : sourceStatus?.environment ?? null
                  }
                  consented={true}
                />
                <DataSourceIndicator
                  label="Behavior"
                  icon={Keyboard}
                  color="text-[#7b3fa0]"
                  status={
                    behaviorCollecting
                      ? {
                          active: true,
                          lastSeen: sourceStatus?.behavior?.lastSeen ?? null,
                          count: sourceStatus?.behavior?.count ?? 0,
                        }
                      : sourceStatus?.behavior ?? null
                  }
                  consented={consentBehavior}
                />
                <DataSourceIndicator
                  label="Vision"
                  icon={consentVision ? Eye : EyeOff}
                  color="text-purple-400"
                  status={
                    visionCollecting
                      ? {
                          active: true,
                          lastSeen: new Date().toISOString(),
                          count: 0,
                        }
                      : sourceStatus?.vision ?? null
                  }
                  consented={consentVision}
                />
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  onClick={handlePause}
                  className="flex flex-1 items-center justify-center gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-2.5 text-sm font-semibold text-amber-300 transition-colors hover:bg-amber-500/20"
                >
                  {sessionState === "paused" ? (
                    <><Play className="h-4 w-4 fill-current" /> RESUME</>
                  ) : (
                    <><Pause className="h-4 w-4 fill-current" /> PAUSE</>
                  )}
                </button>
                <button
                  onClick={handleStop}
                  className="flex flex-1 items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-500"
                >
                  <Square className="h-4 w-4 fill-current" /> STOP &amp; SAVE
                </button>
              </div>
            </Card>

            <Card className="border-white/10 bg-card/80 p-6 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider">Self Report</h2>
              <p className="mb-3 text-xs text-muted-foreground">Rate your current concentration level (prompted every 15 minutes)</p>

              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">Concentration Level</span>
                <span className="font-mono text-2xl font-bold leading-none text-primary">
                  {concentration}<span className="ml-1 text-sm font-normal text-muted-foreground">/5</span>
                </span>
              </div>
              <p className="mb-3 text-sm font-medium">{CONCENTRATION_LEVELS[concentration]}</p>

              <Slider
                value={[concentration]}
                onValueChange={(v) => setConcentration((Array.isArray(v) ? v[0] : v) as ConcentrationLevel)}
                min={1}
                max={5}
                step={1}
              />
              <div className="mb-3 flex items-center justify-between px-0.5 pt-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setConcentration(n as ConcentrationLevel)}
                    className={`flex h-6 w-6 items-center justify-center rounded-md font-mono text-xs font-semibold transition-colors ${
                      concentration === n
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-secondary"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs">Environment</Label>
                <Select value={environment} onValueChange={setEnvironment}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    {ENVIRONMENT_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <button
                onClick={submitConcentration}
                disabled={!environment}
                className="mt-3 w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Submit Report
              </button>
            </Card>
          </>
        )}

        {sessionState === "completed" && (
          <Card className="border-white/10 bg-card/80 p-6 shadow-sm">
            <div className="text-center">
              <p className="text-lg font-semibold text-emerald-400">Session Completed</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Data has been saved. Duration: {formatTime(elapsed)}
              </p>
              <button
                onClick={() => {
                  setActiveSession(null)
                  setSessionState("idle")
                  setTaskType("")
                  setLocation("")
                  setLocationOther("")
                  setExpectedDuration("")
                  setElapsed(0)
                  setConsentVision(false)
                  setConsentBehavior(false)
                }}
                className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Start Another Session
              </button>
            </div>
          </Card>
        )}
      </div>

      {showReport && isActive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <Card className="mx-4 w-full max-w-sm border-border bg-card p-6">
            <div className="mb-3 flex items-center gap-2">
              <Gauge className="h-5 w-5 text-primary" />
              <h3 className="text-sm font-semibold">Concentration Check</h3>
            </div>
            <p className="mb-4 text-xs text-muted-foreground">How focused are you right now?</p>

            <div className="mb-4 flex items-center justify-center gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setConcentration(n as ConcentrationLevel)}
                  className={`flex h-10 w-10 items-center justify-center rounded-lg font-mono text-sm font-bold transition-colors ${
                    concentration === n
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="mb-4 text-center text-sm font-medium">{CONCENTRATION_LEVELS[concentration]}</p>

            <div className="grid gap-1.5">
              <Label className="text-xs">Environment</Label>
              <Select value={environment} onValueChange={setEnvironment}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                  {ENVIRONMENT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setShowReport(false)}
                className="flex-1 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary"
              >
                Skip
              </button>
              <button
                onClick={submitConcentration}
                disabled={!environment}
                className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Submit
              </button>
            </div>
          </Card>
        </div>
      )}
      
      {/* Gaze Calibration Modal */}
      {showCalibration && videoElementRef.current && (
        <GazeCalibration
          videoElement={videoElementRef.current}
          onComplete={handleCalibrationComplete}
          onCancel={handleCalibrationCancel}
        />
      )}
    </AppShell>
  )
}
