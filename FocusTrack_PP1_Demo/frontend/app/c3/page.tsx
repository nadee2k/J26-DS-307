"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Camera, Crosshair, Download, Play, Square } from "lucide-react"
import { AppShell } from "@/components/layout/app-shell"
import { Metric, Panel, WorkbenchShell, type WorkbenchInfo } from "@/components/workbench/workbench-shell"
import { ZoneCalibration } from "@/components/workbench/zone-calibration"
import { useAuth } from "@/hooks/use-auth"
import type { FrameFeatures } from "@/lib/focus/buffers"
import { aggregateC3, dgdFrame, readingLike } from "@/lib/focus/c3"
import { calibrationsByStudent, saveCalibration } from "@/lib/focus/store"
import { DGD_FOCUSED, DGD_LABELS, TASK_LABELS, tasksFor, type C3Features, type CalibrationResult, type DgdState, type LiveTask, type StudyMode } from "@/lib/focus/types"
import { fixedZone } from "@/lib/focus/vision-math"
import { VisionProcessor, type VisionFeatures } from "@/lib/vision"

const INFO: WorkbenchInfo = {
  n: 3, title: "Context-Aware Visual Attention Analysis", owner: "Vithana Y.S.D.", id: "IT23195066",
  question: "Can a webcam, processed in the browser without storing video, tell reading apart from phone use when both look down?",
  done: [
    "In-browser pipeline at 3 fps: face landmarks → 3D head pose → iris position relative to the eye corners; frames never stored",
    "Quality flags: no face, low light, glare in the eye region",
    "Personal three-zone calibration (screen / desk / away) with a held-out scripted check: personal vs fixed-rule accuracy, phone recall",
    "Phone-in-frame detection at ~1 fps (COCO-SSD prototype)",
    "Downward-Gaze Disambiguation per frame and per epoch, compared live with the fixed-angle rule",
  ],
  next: [
    "Head-pose accuracy on the BIWI benchmark (target MAE ≤ 10°)",
    "Fine-tune YOLOv8n on hand-held phones and export it to the browser, so the evaluated model is the deployed one",
    "Automatic re-calibration on posture drift; latency tests on 2–3 student laptops",
    "Integration: C1 keyboard-activity flag (this workbench uses its own key listener) and export of C3 epochs to C4",
  ],
  analysisTab: "C3 Vision",
}

const STATE_COL: Record<DgdState, string> = { screen: "#1B2F6E", reading: "#1E8E5A", typing: "#2A6FDB", phone: "#C0392B", away: "#9AA3B2", unclear: "#C77C0E", "no-face": "#D5DBE6" }
interface Row { at: string; f: C3Features; fixedDistracted: boolean; dgdDistracted: boolean | null }

export default function C3Workbench() {
  const { student, isLoading } = useAuth()
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const procRef = useRef<VisionProcessor | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const framesRef = useRef<{ f: FrameFeatures; s: DgdState }[]>([])
  const sinkRef = useRef<((f: FrameFeatures) => void) | null>(null)
  const keysRef = useRef<number[]>([])
  const [camOn, setCamOn] = useState(false)
  const [status, setStatus] = useState("")
  const [last, setLast] = useState<VisionFeatures | null>(null)
  const [state, setState] = useState<DgdState>("no-face")
  const [mode, setMode] = useState<StudyMode>("non-screen")
  const [task, setTask] = useState<LiveTask>("reading")
  const [quick, setQuick] = useState(true)
  const [calibrating, setCalibrating] = useState(false)
  const [cal, setCal] = useState<CalibrationResult | null>(null)
  const [history, setHistory] = useState<CalibrationResult[]>([])
  const [epochSec, setEpochSec] = useState(15)
  const [running, setRunning] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [latency, setLatency] = useState<number[]>([])
  const ctxRef = useRef({ mode, deskAnchor: null as number | null, screenPitch: null as number | null })
  const lastTickRef = useRef(0)

  useEffect(() => { if (!isLoading && !student) router.push("/login") }, [student, isLoading, router])
  useEffect(() => { ctxRef.current = { mode, deskAnchor: cal?.deskAnchor ?? null, screenPitch: cal?.screenPitch ?? null } }, [mode, cal])
  useEffect(() => { if (student) calibrationsByStudent(student.id).then(setHistory).catch(() => {}) }, [student])
  useEffect(() => {
    const onKey = () => { keysRef.current.push(Date.now()); if (keysRef.current.length > 200) keysRef.current.shift() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const onFeatures = useCallback((v: VisionFeatures) => {
    sinkRef.current?.(v.frame)
    const now = Date.now()
    const recent = framesRef.current.filter((x) => x.f.t > now - 10000).map((x) => x.f)
    const ctx = ctxRef.current
    const s = dgdFrame(v.frame, { ...ctx, keyboardActive: keysRef.current.filter((t) => t > now - 5000).length >= 3, readingNow: readingLike([...recent, v.frame], ctx) })
    framesRef.current.push({ f: v.frame, s })
    if (framesRef.current.length > 4000) framesRef.current.splice(0, 1000)
    setLast(v); setState(s)
    setLatency((l) => [...l.slice(-29), v.processingMs])
  }, [])

  const startCamera = async () => {
    setStatus("Starting camera and loading the face and phone models…")
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play() }
      if (!procRef.current) procRef.current = new VisionProcessor()
      await procRef.current.initialize()
      procRef.current.setZoneModel(cal?.model ?? null)
      await procRef.current.start(videoRef.current!, onFeatures)
      setCamOn(true); setStatus("")
    } catch (e) {
      const name = e instanceof DOMException ? e.name : ""
      if (name === "NotAllowedError" || name === "SecurityError") setStatus("Camera permission was denied. Allow the camera for this site in the browser (Chrome or Edge on the laptop) and try again.")
      else if (name === "NotFoundError" || name === "NotReadableError") setStatus("No usable camera found, or another app is using it. Close other video apps and try again.")
      else setStatus(`Could not load the face or phone model (${e instanceof Error ? e.message : "unknown error"}). They load from a CDN, so an internet connection is needed.`)
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }
  const stopCamera = () => { procRef.current?.stop(); streamRef.current?.getTracks().forEach((t) => t.stop()); setCamOn(false); setRunning(false) }
  useEffect(() => () => { procRef.current?.dispose(); streamRef.current?.getTracks().forEach((t) => t.stop()) }, [])

  const onCalibrated = useCallback(async (r: CalibrationResult) => {
    setCalibrating(false)
    procRef.current?.setZoneModel(r.model)
    setCal(r)
    try { const saved = await saveCalibration(r); setHistory((h) => [...h, saved]) } catch { setHistory((h) => [...h, r]) }
  }, [])

  const tick = useCallback(() => {
    const now = Date.now(), from = lastTickRef.current
    const win = framesRef.current.filter((x) => x.f.t >= from && x.f.t < now)
    const ctx = ctxRef.current
    const f = aggregateC3(win.map((x) => x.f), win.map((x) => x.s), ctx, !!cal)
    if (f) {
      // the fixed-angle baseline on the same frames: "looking down or not at the screen = distracted"
      const faces = win.filter((x) => x.f.face).map((x) => x.f)
      const fixedScreen = faces.length ? faces.filter((x) => fixedZone(x.pitch, x.yaw) === 0).length / faces.length : 0
      setRows((r) => [...r, { at: new Date(now).toLocaleTimeString(), f, fixedDistracted: f.pitchMean > 20 || fixedScreen < 0.5, dgdDistracted: DGD_FOCUSED[f.dgdState] === null ? null : !DGD_FOCUSED[f.dgdState] }])
    }
    lastTickRef.current = now
  }, [cal])
  useEffect(() => { if (!running) return; const id = setInterval(tick, epochSec * 1000); return () => clearInterval(id) }, [running, epochSec, tick])

  const fr = last?.frame
  const avgLatency = latency.length ? latency.reduce((a, b) => a + b, 0) / latency.length : 0
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ component: "C3", note: "Numeric features only – no frames", mode, task, calibration: cal, epochs: rows }, null, 2)], { type: "application/json" })
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "focustrack_c3_epochs.json"; a.click()
  }
  const pct = (v: number | null | undefined) => (v == null ? "–" : `${(v * 100).toFixed(0)}%`)

  if (isLoading || !student) return null
  return (
    <AppShell studentName={student.name}>
      <WorkbenchShell info={INFO}>
        <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <Panel title="Webcam (processed in memory, never stored)" right={camOn ? <span className="text-[11px] text-muted-foreground">~{avgLatency.toFixed(0)} ms per frame (budget 333 ms)</span> : null}>
            <div className="relative overflow-hidden rounded-xl bg-[#141820]" style={{ aspectRatio: "4 / 3" }}>
              <video ref={videoRef} muted playsInline className="h-full w-full object-cover" style={{ transform: "scaleX(-1)" }} />
              {camOn && (
                <div className="absolute left-2 top-2 rounded-lg px-3 py-1.5 text-sm font-semibold text-white" style={{ background: STATE_COL[state] }}>{DGD_LABELS[state]}</div>
              )}
              {camOn && fr && (
                <div className="absolute bottom-2 left-2 flex flex-wrap gap-1 font-mono text-[10px]">
                  {!fr.face && <span className="rounded bg-red-600 px-1.5 py-0.5 text-white">NO FACE</span>}
                  {fr.luminance < 50 && <span className="rounded bg-amber-600 px-1.5 py-0.5 text-white">LOW LIGHT</span>}
                  {fr.glare > 0.08 && <span className="rounded bg-amber-600 px-1.5 py-0.5 text-white">GLARE</span>}
                  {last?.phoneDetected && <span className="rounded bg-red-600 px-1.5 py-0.5 text-white">PHONE</span>}
                </div>
              )}
              {!camOn && <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">{status || "Camera off"}</div>}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {!camOn ? <button onClick={startCamera} className="flex items-center gap-2 rounded-xl bg-[#D9711C] px-4 py-2 text-sm font-semibold text-white"><Camera className="h-4 w-4" />Start camera</button>
                : <button onClick={stopCamera} className="rounded-xl border px-3 py-2 text-sm">Stop camera</button>}
              <button onClick={() => setCalibrating(true)} disabled={!camOn} className="flex items-center gap-2 rounded-xl border border-[#D9711C] px-3 py-2 text-sm font-semibold text-[#D9711C] disabled:opacity-40"><Crosshair className="h-4 w-4" />Calibrate</button>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={quick} onChange={(e) => setQuick(e.target.checked)} />Quick (~1 min)</label>
              {status && camOn && <span className="text-xs text-muted-foreground">{status}</span>}
            </div>
          </Panel>

          <div className="grid content-start gap-4">
            <Panel title="Context for DGD">
              <div className="flex flex-wrap gap-3">
                <label className="grid gap-1 text-xs">Study mode
                  <select className="rounded-lg border px-2 py-1.5 text-sm" value={mode} onChange={(e) => { const m = e.target.value as StudyMode; setMode(m); setTask(tasksFor(m)[0]) }}>
                    <option value="screen">Screen</option><option value="non-screen">Non-screen</option>
                  </select></label>
                <label className="grid gap-1 text-xs">Task
                  <select className="rounded-lg border px-2 py-1.5 text-sm" value={task} onChange={(e) => setTask(e.target.value as LiveTask)}>
                    {tasksFor(mode).map((t) => <option key={t} value={t}>{TASK_LABELS[t]}</option>)}
                  </select></label>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">Gaze model: <b>{cal ? "personal three-zone model" : "fixed-angle fallback – calibrate for the personal model"}</b>{cal ? ` · desk anchor ${cal.deskAnchor.toFixed(0)}° pitch` : ""}</p>
            </Panel>
            <Panel title="Current frame">
              {fr ? (
                <div className="grid grid-cols-3 gap-2">
                  <Metric label="Head pitch" value={fr.face ? `${fr.pitch.toFixed(0)}°` : "–"} hint="+ = looking down" />
                  <Metric label="Head yaw" value={fr.face ? `${fr.yaw.toFixed(0)}°` : "–"} />
                  <Metric label="Iris (x, y)" value={fr.face ? `${fr.irisX.toFixed(2)}, ${fr.irisY.toFixed(2)}` : "–"} hint="relative to eye corners" />
                  <Metric label="Zone" value={fr.zone === -1 ? (fr.face ? ["screen", "desk", "away"][fixedZone(fr.pitch, fr.yaw)] + "*" : "–") : `${["screen", "desk", "away"][fr.zone]} ${(fr.zoneProb * 100).toFixed(0)}%`} hint={fr.zone === -1 ? "* fixed rule" : "personal model"} />
                  <Metric label="Light / glare" value={`${fr.luminance.toFixed(0)} / ${(fr.glare * 100).toFixed(0)}%`} />
                  <Metric label="Phone check" value={fr.phone === null ? "…" : fr.phone ? "phone" : "none"} hint="~1 fps" />
                </div>
              ) : <p className="text-sm text-muted-foreground">Start the camera.</p>}
            </Panel>
          </div>
        </div>

        {cal && (
          <Panel title="Calibration result (held-out scripted check)">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <Metric label="Zone accuracy – personal model" value={pct(cal.accuracyPersonal)} hint={`${cal.nTest} held-out frames`} />
              <Metric label="Zone accuracy – fixed-angle rule" value={pct(cal.accuracyFixed)} hint="same frames" />
              <Metric label="Phone recall" value={pct(cal.phoneRecall)} hint={`${cal.phoneFrames} checked frames while using the phone`} />
              <Metric label="Reading motion: reading" value={pct(cal.readingMotionRead)} hint="should be high" />
              <Metric label="Reading motion: phone" value={pct(cal.readingMotionPhone)} hint="should be lower" />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Per zone (personal / fixed): {cal.perZone.map((z) => `${["screen", "desk", "away"][z.zone]} ${pct(z.personal)} / ${pct(z.fixed)} (n=${z.n})`).join(" · ")}. One learner, one calibration – evidence for the method comes from all participants in the study.</p>
          </Panel>
        )}

        <Panel title="Per-epoch visual features: DGD vs the fixed-angle rule" right={
          <div className="flex items-center gap-2">
            <select className="rounded-lg border px-2 py-1 text-xs" value={epochSec} disabled={running} onChange={(e) => setEpochSec(Number(e.target.value))}>
              <option value={60}>60-s epochs (study)</option><option value={15}>15-s epochs (fast demo)</option>
            </select>
            {!running ? <button onClick={() => { lastTickRef.current = Date.now(); setRows([]); setRunning(true) }} disabled={!camOn} className="flex items-center gap-1 rounded-lg bg-[#D9711C] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"><Play className="h-3.5 w-3.5" />Start</button>
              : <button onClick={() => setRunning(false)} className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white"><Square className="h-3.5 w-3.5" />Stop</button>}
            <button onClick={exportJson} disabled={!rows.length} className="flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs disabled:opacity-50"><Download className="h-3.5 w-3.5" />Export</button>
          </div>}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="text-muted-foreground"><th className="py-1">Epoch end</th><th>Screen</th><th>Desk</th><th>Away</th><th>Pitch</th><th>Yaw SD</th><th>Reading motion</th><th>Phone</th><th>Face</th><th>DGD state</th><th>Fixed rule</th><th>DGD</th></tr></thead>
              <tbody>{rows.slice(-12).reverse().map((r, i) => (
                <tr key={i} className="border-t">
                  <td className="py-1">{r.at}</td><td>{pct(r.f.zoneScreen)}</td><td>{pct(r.f.zoneDesk)}</td><td>{pct(r.f.zoneAway)}</td><td>{r.f.pitchMean.toFixed(0)}°</td><td>{r.f.yawStd.toFixed(1)}°</td>
                  <td>{pct(r.f.readingMotion)}</td><td>{pct(r.f.phoneInFrame)}</td><td>{pct(r.f.validFace)}</td>
                  <td><span className="rounded px-1.5 py-0.5 text-white" style={{ background: STATE_COL[r.f.dgdState] }}>{DGD_LABELS[r.f.dgdState]}</span></td>
                  <td className={r.fixedDistracted ? "font-semibold text-red-700" : "text-green-700"}>{r.fixedDistracted ? "distracted" : "focused"}</td>
                  <td className={r.dgdDistracted ? "font-semibold text-red-700" : r.dgdDistracted === false ? "text-green-700" : "text-muted-foreground"}>{r.dgdDistracted == null ? "no face" : r.dgdDistracted ? "distracted" : "focused"}</td>
                </tr>
              ))}</tbody>
            </table>
            {!rows.length && <p className="py-2 text-sm text-muted-foreground">Start the camera, calibrate, then press Start. Try reading your book, then picking up your phone: the fixed rule calls both "distracted"; DGD separates them.</p>}
          </div>
        </Panel>

        {history.length > 0 && (
          <Panel title="Your calibrations">
            <table className="w-full text-left text-xs">
              <thead><tr className="text-muted-foreground"><th className="py-1">When</th><th>Mode</th><th>Train / test frames</th><th>Personal</th><th>Fixed rule</th><th>Phone recall</th><th>Desk anchor</th></tr></thead>
              <tbody>{[...history].reverse().slice(0, 8).map((h, i) => (
                <tr key={i} className="border-t"><td className="py-1">{new Date(h.createdAt).toLocaleString()}</td><td>{h.quick ? "quick" : "full"}</td><td>{h.nTrain} / {h.nTest}</td><td>{pct(h.accuracyPersonal)}</td><td>{pct(h.accuracyFixed)}</td><td>{pct(h.phoneRecall)}</td><td>{h.deskAnchor.toFixed(0)}°</td></tr>
              ))}</tbody>
            </table>
          </Panel>
        )}
      </WorkbenchShell>
      {calibrating && (
        <ZoneCalibration quick={quick} sessionId={`c3-workbench-${Date.now()}`} studentId={student.id}
          onFrameSink={(s) => { sinkRef.current = s }} onDone={onCalibrated} onCancel={() => setCalibrating(false)} />
      )}
    </AppShell>
  )
}
