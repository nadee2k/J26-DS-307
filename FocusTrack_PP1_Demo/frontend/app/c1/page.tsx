"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Activity, AlertTriangle, CheckCircle2, Download, EyeOff, Globe, Monitor, PauseCircle, Play, RefreshCw, ShieldCheck, Square, Wifi, WifiOff, Zap } from "lucide-react"
import { AppShell } from "@/components/layout/app-shell"
import { Metric, Panel, Spark, WorkbenchShell, type WorkbenchInfo } from "@/components/workbench/workbench-shell"
import { useAuth } from "@/hooks/use-auth"
import { buffers, pushInput, windowOf, type InputEvent } from "@/lib/focus/buffers"
import { computeC1 } from "@/lib/focus/c1"
import { friendlyGlance, friendlyOutcome } from "@/lib/focus/c1-friendly"
import { c1Smooth, c1Vec } from "@/lib/focus/c1-model"
import { C1_BACKEND_URL, saveC1Epoch, type SaveResult } from "@/lib/focus/c1-store"
import { c1ModelSnapshot, compareModelsForEpoch, contributionText, evaluateC1OnSimulatedStudy, scoreContributions, verifyC1Scores, type HoldoutResult, type ScoreCheck } from "@/lib/focus/c1-verify"
import { AGENT_URL, c1Agent, type AgentHealth, type AgentEventsResponse } from "@/lib/focus/desktop"
import { getModels, scoreLin, stateModel, type Models } from "@/lib/focus/models"
import { TASK_LABELS, tasksFor, type C1Features, type LiveTask, type StudyMode } from "@/lib/focus/types"

const INFO: WorkbenchInfo = {
  n: 1, title: "Context-Aware Learner Interaction-State Modelling", owner: "Kumari M.A.D.N.", id: "IT23211032",
  question: "Does a state-and-transition representation, read in the context of the task, beat simple activity counts?",
  done: [
    "Privacy-preserving logger: key timing and a Backspace flag only (never which key), mouse, scroll, app switching",
    "System-wide desktop agent: the same metadata from any application, not only this browser tab",
    "Per-epoch features: typing rate, typing-rhythm variability, corrections, idle time, mouse speed, app switching",
    "Interaction states (k-means prototype) with dwell time and state changes",
    "Behaviour-only focus estimate loaded from the research export (browser fallback), with study mode as context",
    "Model check: stored scores reproduced from the loaded weights, feature contributions, baseline/C4 comparison, simulated-study holdout",
    "Full analysis pipeline on the simulated study: LOPO, paired Wilcoxon, ablations, leave-one-task-out",
  ],
  next: [
    "Ship the full HMM state/transition/context model to the live app (backend scoring or ONNX), replacing the deployable subset",
    "Retrain and evaluate on real probe-labelled sessions after ethics approval and the pilot",
    "Integration: export C1 epochs and the keyboard-activity flag to C3 and C4",
  ],
  analysisTab: "C1 Behaviour",
}
const STATE_COLORS = ["#2A6FDB", "#1E8E5A", "#D9711C", "#9AA3B2"]
const DESKTOP_LAG_MS = 400

type Source = "desktop" | "browser"
type AgentState = "checking" | "online" | "offline"
type View = "simple" | "technical"
interface Row { at: string; iso: string; app: string | null; f: C1Features; p: number }

const TONE = {
  good: { box: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", icon: CheckCircle2 },
  mixed: { box: "bg-amber-50 text-amber-700", dot: "bg-amber-500", icon: AlertTriangle },
  low: { box: "bg-rose-50 text-rose-700", dot: "bg-rose-500", icon: PauseCircle },
  neutral: { box: "bg-slate-100 text-slate-600", dot: "bg-slate-400", icon: Activity },
} as const

const saveTargetLabel = (target?: SaveResult["target"]) =>
  target === "backend" ? "the backend" : target === "demo" ? "the in-browser demo store" : target === "supabase" ? "Supabase" : "storage"

const pct = (value: number) => Number.isFinite(value) ? `${(value * 100).toFixed(0)}%` : "—"
const num = (value: number) => Number.isFinite(value) ? value.toFixed(2) : "—"

function FriendlyStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#f6f3ee] px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  )
}

export default function C1Workbench() {
  const { student, isLoading } = useAuth()
  const router = useRouter()
  const [models, setModels] = useState<Models | null>(null)
  const [mode, setMode] = useState<StudyMode>("screen")
  const [task, setTask] = useState<LiveTask>("coding")
  const [epochSec, setEpochSec] = useState(15)
  const [running, setRunning] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [live, setLive] = useState({ keys: 0, backs: 0, moves: 0, switches: 0 })
  const [source, setSource] = useState<Source>("browser")
  const [agentState, setAgentState] = useState<AgentState>("checking")
  const [agentHealth, setAgentHealth] = useState<AgentHealth | null>(null)
  const [activeApp, setActiveApp] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [persist, setPersist] = useState(true)
  const [saveState, setSaveState] = useState<SaveResult | null>(null)
  const [view, setView] = useState<View>("simple")
  const [verifyResult, setVerifyResult] = useState<ScoreCheck | null>(null)
  const [holdout, setHoldout] = useState<HoldoutResult | null>(null)
  const [checkBusy, setCheckBusy] = useState(false)
  const [checkError, setCheckError] = useState("")
  const awayRef = useRef(false)
  const lastTickRef = useRef(0)
  const statesRef = useRef<number[]>([])
  const historyRef = useRef<C1Features[]>([])
  const runningRef = useRef(false)
  const sourceRef = useRef<Source>("browser")
  const cursorRef = useRef(0)
  const activeAppRef = useRef<string | null>(null)
  const persistRef = useRef(true)
  const pullRef = useRef<Promise<AgentEventsResponse | null> | null>(null)

  useEffect(() => { if (!isLoading && !student) router.push("/login") }, [student, isLoading, router])
  useEffect(() => { const t = setTimeout(() => setModels(getModels()), 50); return () => clearTimeout(t) }, [])
  useEffect(() => { persistRef.current = persist }, [persist])

  // Detect the optional desktop agent once on load. C1 still works in browser-only mode.
  const checkAgent = useCallback(async (selectDesktop: boolean) => {
    setAgentState("checking")
    const health = await c1Agent.health()
    setAgentHealth(health)
    setAgentState(health ? "online" : "offline")
    if (health && !health.ready) setError(health.input.error || "The desktop agent is running, but global input capture is unavailable.")
    if (selectDesktop && !runningRef.current && health?.ready) {
      sourceRef.current = "desktop"
      setSource("desktop")
      setActiveApp(health.activeApp)
      activeAppRef.current = health.activeApp
    }
    return health
  }, [])

  useEffect(() => { void checkAgent(true) }, [checkAgent])

  // the browser logger: timing metadata only
  useEffect(() => {
    if (!running || source !== "browser") return
    let lx: number | null = null, ly: number | null = null
    const onKey = (e: KeyboardEvent) => {
      const back = e.key === "Backspace" || e.key === "Delete"
      pushInput({ t: Date.now(), kind: back ? "back" : "key" }) // e.key itself is never stored
      setLive((l) => ({ ...l, keys: l.keys + 1, backs: l.backs + (back ? 1 : 0) }))
    }
    const onMove = (e: MouseEvent) => {
      if (lx !== null && ly !== null) pushInput({ t: Date.now(), kind: "move", dist: Math.hypot(e.clientX - lx, e.clientY - ly) })
      lx = e.clientX; ly = e.clientY
      setLive((l) => ({ ...l, moves: l.moves + 1 }))
    }
    const onClick = () => pushInput({ t: Date.now(), kind: "click" })
    const onScroll = () => pushInput({ t: Date.now(), kind: "scroll" })
    const leave = () => { if (!awayRef.current) { awayRef.current = true; pushInput({ t: Date.now(), kind: "leave" }); setLive((l) => ({ ...l, switches: l.switches + 1 })) } }
    const back = () => { if (awayRef.current) { awayRef.current = false; pushInput({ t: Date.now(), kind: "return" }) } }
    const onVis = () => (document.hidden ? leave() : back())
    window.addEventListener("keydown", onKey); window.addEventListener("mousemove", onMove); window.addEventListener("mousedown", onClick)
    window.addEventListener("wheel", onScroll, { passive: true }); window.addEventListener("blur", leave); window.addEventListener("focus", back)
    document.addEventListener("visibilitychange", onVis)
    return () => {
      window.removeEventListener("keydown", onKey); window.removeEventListener("mousemove", onMove); window.removeEventListener("mousedown", onClick)
      window.removeEventListener("wheel", onScroll); window.removeEventListener("blur", leave); window.removeEventListener("focus", back)
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [running, source])

  /** Pull every new event from the desktop agent exactly once, even if polling and a tick overlap. */
  const pullDesktop = useCallback(async (): Promise<AgentEventsResponse | null> => {
    if (sourceRef.current !== "desktop" || !runningRef.current) return null
    if (pullRef.current) return pullRef.current
    const job = (async () => {
      let last: AgentEventsResponse | null = null
      const fresh: InputEvent[] = []
      for (let guard = 0; guard < 8; guard++) {
        const res = await c1Agent.events(cursorRef.current)
        last = res
        cursorRef.current = Math.max(cursorRef.current, res.cursor)
        fresh.push(...res.events)
        if (!res.more) break
      }
      for (const event of fresh) pushInput(event)
      if (last) {
        setAgentState("online")
        setError("")
        setActiveApp(last.activeApp)
        activeAppRef.current = last.activeApp
        if (fresh.length) {
          const keys = fresh.filter((e) => e.kind === "key").length
          const backs = fresh.filter((e) => e.kind === "back").length
          const moves = fresh.filter((e) => e.kind === "move").length
          const switches = fresh.filter((e) => e.kind === "switch").length
          setLive((l) => ({ keys: l.keys + keys, backs: l.backs + backs, moves: l.moves + moves, switches: l.switches + switches }))
        }
      }
      return last
    })()
    pullRef.current = job
    try { return await job } finally { pullRef.current = null }
  }, [])

  const pullSafely = useCallback(async () => {
    try {
      return await pullDesktop()
    } catch (e) {
      setAgentState("offline")
      setError(`Lost contact with the desktop agent (${e instanceof Error ? e.message : String(e)}). Check that it is still running; the events already collected are kept.`)
      return null
    }
  }, [pullDesktop])

  const tick = useCallback(async (force = false) => {
    if (!models || !runningRef.current) return
    const src = sourceRef.current
    let pulled: AgentEventsResponse | null = null
    if (src === "desktop") {
      pulled = await pullSafely()
      if (!pulled) return
    }
    const now = Date.now()
    // Leave a short margin so events that were generated during this pull are not split
    // across epoch boundaries. They stay in the buffer for the next epoch.
    const to = src === "desktop" ? Math.min(now, pulled!.now) - DESKTOP_LAG_MS : now
    // After a pause or a lost agent connection, do not turn a long gap into one giant epoch.
    const gap = to - lastTickRef.current
    const from = gap > epochSec * 2000 ? to - epochSec * 1000 : lastTickRef.current
    if (to <= from) return
    if (!force && to - from < 1000) return
    const events = windowOf(buffers.input, from, to)
    const awayAtStart = (() => { let a = false; for (const e of buffers.input) { if (e.t >= from) break; if (e.kind === "leave") a = true; if (e.kind === "return") a = false } return a })()
    const f = computeC1(events, from, to, awayAtStart, statesRef.current, stateModel(models))
    statesRef.current.push(f.state)
    historyRef.current.push(f)
    const p = scoreLin(models.c1, c1Vec(c1Smooth(historyRef.current), mode === "screen"))
    const row: Row = { at: new Date(to).toLocaleTimeString(), iso: new Date(to).toISOString(), app: activeAppRef.current, f, p }
    setRows((r) => [...r, row])
    setLive({ keys: 0, backs: 0, moves: 0, switches: 0 })
    lastTickRef.current = to

    if (persistRef.current && student) {
      void saveC1Epoch({
        studentId: student.id,
        recordedAt: row.iso,
        studyMode: mode,
        taskType: task,
        epochSeconds: epochSec,
        source: src,
        activeApplication: row.app,
        features: f,
        focusProb: p,
      }).then(setSaveState)
    }
  }, [models, mode, task, epochSec, student, pullSafely])

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => { void tick() }, epochSec * 1000)
    return () => clearInterval(id)
  }, [running, epochSec, tick])

  // Poll the agent once per second so the live counters move even between epochs.
  useEffect(() => {
    if (!running || source !== "desktop") return
    const id = setInterval(() => { void pullSafely() }, 1000)
    return () => clearInterval(id)
  }, [running, source, pullSafely])

  const changeSource = (next: Source) => {
    if (runningRef.current) return
    sourceRef.current = next
    setSource(next)
    setError("")
    if (next === "desktop") void checkAgent(true)
  }

  const retryAgent = () => {
    setError("")
    void checkAgent(true).then((health) => {
      if (!health) setError(`No desktop agent found at ${AGENT_URL}. Start it with: python hardware/python_bridge/desktop_agent.py`)
    })
  }

  const start = async () => {
    if (!models) return
    setError("")
    setSaveState(null)
    setVerifyResult(null)
    setCheckError("")
    const src = sourceRef.current
    let startAt = Date.now()
    let initialApp: string | null = null
    if (src === "desktop") {
      const health = await c1Agent.health()
      setAgentHealth(health)
      setAgentState(health ? "online" : "offline")
      if (!health?.ready) {
        setError(health?.input.error ?? "The desktop agent is not ready. Start it, then press Retry.")
        return
      }
      try {
        const res = await c1Agent.start({ mode, task, epochSec })
        startAt = Number(res.startedAt) || Date.now()
        cursorRef.current = Number(res.cursor) || 0
        initialApp = health.activeApp
      } catch (e) {
        setAgentState("offline")
        setError(`Could not start the desktop session: ${e instanceof Error ? e.message : String(e)}`)
        return
      }
    } else {
      cursorRef.current = 0
    }
    buffers.input.length = 0
    statesRef.current = []
    historyRef.current = []
    awayRef.current = false
    setRows([])
    setLive({ keys: 0, backs: 0, moves: 0, switches: 0 })
    setActiveApp(initialApp)
    activeAppRef.current = initialApp
    lastTickRef.current = startAt
    runningRef.current = true
    setRunning(true)
  }

  const stop = async () => {
    if (sourceRef.current === "desktop") {
      try { await pullDesktop() } catch { /* keep stopping */ }
      try { await c1Agent.stop() } catch { /* agent may already be gone */ }
    }
    runningRef.current = false
    setRunning(false)
  }

  useEffect(() => () => {
    runningRef.current = false
    if (sourceRef.current === "desktop") void c1Agent.stop().catch(() => {})
  }, [])

  const last = rows[rows.length - 1]
  const outcome = useMemo(() => friendlyOutcome({
    features: last?.f ?? null,
    probability: last?.p ?? null,
    recentProbabilities: rows.slice(-6).map((r) => r.p),
    mode,
    activeApp,
    running,
  }), [last, rows, mode, activeApp, running])
  const glance = useMemo(() => friendlyGlance(last?.f ?? null, activeApp), [last, activeApp])
  const comparison = useMemo(() => models && rows.length ? compareModelsForEpoch(rows, models, mode, epochSec) : null, [models, rows, mode, epochSec])
  const topContributions = useMemo(() => models && rows.length ? scoreContributions(rows, models.c1, mode === "screen").contributions.slice(0, 5) : [], [models, rows, mode])
  const tone = TONE[outcome.tone]
  const ToneIcon = tone.icon
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({
      component: "C1",
      note: "Interaction metadata only – no key content, text, window titles or mouse coordinates",
      source, studentId: student?.id ?? null, mode, task, epochSec, epochs: rows,
      modelCheck: models ? c1ModelSnapshot(models) : null,
    }, null, 2)], { type: "application/json" })
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "focustrack_c1_epochs.json"; a.click()
  }
  const checkStoredScores = () => {
    if (!models || !rows.length) return
    setCheckError("")
    setVerifyResult(verifyC1Scores(rows, models.c1, mode === "screen"))
  }
  const runHoldoutCheck = () => {
    setCheckBusy(true)
    setCheckError("")
    // Let the button paint before the (synchronous) simulated-study evaluation starts.
    setTimeout(() => {
      try {
        setHoldout(evaluateC1OnSimulatedStudy())
      } catch (e) {
        setCheckError(`Held-out check failed: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        setCheckBusy(false)
      }
    }, 20)
  }
  const stateLabels = useMemo(() => models ? stateModel(models).labels : [], [models])
  const agentReady = agentState === "online" && Boolean(agentHealth?.ready)

  if (isLoading || !student) return null
  return (
    <AppShell studentName={student.name}>
      <WorkbenchShell
        info={INFO}
        compact={view === "simple"}
        title={view === "simple" ? "How is your work going?" : undefined}
        tagline={view === "simple" ? "A plain-language look at your focus. No scores to interpret, and your text is never read." : undefined}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {view === "simple"
              ? "Plain-language view for the demo. Switch to Technical to see features, interaction states and the model output."
              : "Feature values, interaction states and the behaviour-only model output."}
          </p>
          <div className="inline-flex rounded-xl border border-[#e3ddd2] bg-white p-1">
            <button type="button" onClick={() => setView("simple")} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${view === "simple" ? "bg-[#2A6FDB] text-white" : "text-muted-foreground hover:bg-[#f6f3ee]"}`}>Simple view</button>
            <button type="button" onClick={() => setView("technical")} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${view === "technical" ? "bg-[#2A6FDB] text-white" : "text-muted-foreground hover:bg-[#f6f3ee]"}`}>Technical view</button>
          </div>
        </div>
        <Panel title={view === "simple" ? "Set up the demo" : "Session context and logger"} right={<span className="text-[11px] text-muted-foreground">{view === "simple" ? "Prototype · illustrative only" : models ? `C1 model: ${models.c1Source === "export" ? "research export" : "browser fallback"} · ${models.c1TrainedOn}` : "Training models on the simulated study…"}</span>}>
          <div className="mb-3 grid gap-2 md:grid-cols-2">
            <button type="button" onClick={() => changeSource("desktop")} disabled={running}
              className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-60 ${source === "desktop" ? "border-[#2A6FDB] bg-[#eef3fd]" : "border-[#e3ddd2] bg-white hover:bg-[#faf8f4]"}`}>
              <Monitor className="mt-0.5 h-5 w-5 shrink-0" style={{ color: source === "desktop" ? "#2A6FDB" : "#6b7280" }} />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {view === "simple" ? "Whole computer" : "Desktop agent (all apps)"}
                  {agentState === "checking" ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">checking…</span>
                    : agentReady ? <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"><Wifi className="h-3 w-3" />connected</span>
                    : agentState === "online" ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">input unavailable</span>
                    : <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600"><WifiOff className="h-3 w-3" />not running</span>}
                </span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{view === "simple"
                  ? "Sees the work you do in any app — VS Code, a PDF, a browser or Zoom."
                  : "Records typing, mouse and app-switch metadata in VS Code, a PDF reader, Zoom — any application."}</span>
              </span>
            </button>
            <button type="button" onClick={() => changeSource("browser")} disabled={running}
              className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-60 ${source === "browser" ? "border-[#2A6FDB] bg-[#eef3fd]" : "border-[#e3ddd2] bg-white hover:bg-[#faf8f4]"}`}>
              <Globe className="mt-0.5 h-5 w-5 shrink-0" style={{ color: source === "browser" ? "#2A6FDB" : "#6b7280" }} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{view === "simple" ? "This browser tab only" : "This browser tab"}</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{view === "simple"
                  ? "No setup needed. Only activity while this tab is in front is seen."
                  : "Works without Python. Only activity while this tab is focused is seen."}</span>
              </span>
            </button>
          </div>

          {source === "desktop" && (
            <div className={`mb-3 rounded-xl px-3 py-2 text-xs ${agentReady ? "bg-[#eef7f1] text-[#1E6B45]" : "bg-[#fdf6e8] text-[#8a5a12]"}`}>
              {agentState === "checking" ? (
                <span className="flex items-center gap-2"><RefreshCw className="h-3.5 w-3.5 animate-spin" />Looking for the demo helper…</span>
              ) : agentReady ? (
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" />Connected</span>
                  <span>Working in: <b>{activeApp ?? agentHealth?.activeApp ?? "an app"}</b></span>
                  {view === "technical" && <span className="opacity-80">· {agentHealth?.input.backend}</span>}
                  {agentHealth?.window.ok === false && <span className="text-[#8a5a12]">{view === "simple" ? "App switching is not available." : "App-switch tracking: unavailable"}</span>}
                </span>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span>{agentState === "online" && agentHealth
                    ? `The demo helper is running, but ${view === "simple" ? "it cannot see keyboard activity yet." : agentHealth.input.error ?? "input capture is unavailable."}`
                    : view === "simple" ? "The demo helper is not running. Ask the demo operator to start it." : `Desktop agent not detected at ${AGENT_URL}.`}</span>
                  {view === "technical" ? (
                    <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-[10px]">python hardware/python_bridge/desktop_agent.py</code>
                  ) : (
                    <details className="text-[11px]"><summary className="cursor-pointer underline">Setup details</summary><code className="mt-1 block rounded bg-white/70 px-1.5 py-0.5 font-mono text-[10px]">python hardware/python_bridge/desktop_agent.py</code></details>
                  )}
                  <button type="button" onClick={retryAgent} className="flex items-center gap-1 rounded-lg border border-current/30 px-2 py-1 font-semibold"><RefreshCw className="h-3 w-3" />Retry</button>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-xs">{view === "simple" ? "Where is the work?" : "Study mode"}
              <select className="rounded-lg border px-2 py-1.5 text-sm" value={mode} disabled={running} onChange={(e) => { const m = e.target.value as StudyMode; setMode(m); setTask(tasksFor(m)[0]); setVerifyResult(null) }}>
                <option value="screen">{view === "simple" ? "On the screen" : "Screen"}</option>
                <option value="non-screen">{view === "simple" ? "On paper" : "Non-screen"}</option>
              </select></label>
            <label className="grid gap-1 text-xs">Task
              <select className="rounded-lg border px-2 py-1.5 text-sm" value={task} disabled={running} onChange={(e) => setTask(e.target.value as LiveTask)}>
                {tasksFor(mode).map((t) => <option key={t} value={t}>{TASK_LABELS[t]}</option>)}
              </select></label>
            <label className="grid gap-1 text-xs">{view === "simple" ? "How often to check" : "Epoch length"}
              <select className="rounded-lg border px-2 py-1.5 text-sm" value={epochSec} disabled={running} onChange={(e) => setEpochSec(Number(e.target.value))}>
                <option value={60}>{view === "simple" ? "Every minute" : "60 s (study setting)"}</option>
                <option value={15}>{view === "simple" ? "Quick update" : "15 s (fast demo)"}</option>
              </select></label>
            {!running ? (
              <button onClick={() => void start()} disabled={!models || (source === "desktop" && !agentReady)} className="flex items-center gap-2 rounded-xl bg-[#2A6FDB] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Play className="h-4 w-4" />{view === "simple" ? "Start" : "Start logging"}</button>
            ) : (
              <button onClick={() => void stop()} className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white"><Square className="h-4 w-4" />Stop</button>
            )}
            <button onClick={() => void tick(true)} disabled={!running} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm disabled:opacity-50"><Zap className="h-4 w-4" />{view === "simple" ? "Check now" : "Read epoch now"}</button>
            <button onClick={exportJson} disabled={!rows.length} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm disabled:opacity-50"><Download className="h-4 w-4" />{view === "simple" ? "Download my data" : "Export epochs"}</button>
          </div>
          {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{view === "simple" ? "Something went wrong. Check that the demo helper is running, then try again." : error}</p>}
          {view === "technical" ? (
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
              <Metric label="Active application" value={<span className="text-sm">{activeApp ?? "–"}</span>} hint={source === "desktop" ? "system-wide" : "this tab"} />
              <Metric label="Key presses (this epoch)" value={live.keys} />
              <Metric label="Corrections (Backspace/Delete)" value={live.backs} />
              <Metric label="Mouse samples" value={live.moves} />
              <Metric label={source === "desktop" ? "App switches (this epoch)" : "Times left the app"} value={live.switches} hint={source === "desktop" ? "foreground application changes" : "switch tab or window to test"} />
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
              {glance.map((item) => <FriendlyStat key={item.label} label={item.label} value={item.value} />)}
            </div>
          )}
          <label className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
            <input type="checkbox" checked={persist} onChange={(e) => setPersist(e.target.checked)} className="h-3.5 w-3.5" />
            {view === "simple" ? "Keep this session for analysis" : `Save each numeric epoch to ${C1_BACKEND_URL ? "the backend (fallback: app database)" : "the app database (Supabase, or the browser demo store)"}`}
          </label>
        </Panel>

        {view === "technical" ? (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title={source === "desktop" ? "Try the system-wide logger" : "Study pad (try the logger here)"}>
                <textarea className="h-40 w-full rounded-xl border p-3 text-sm" placeholder={running
                  ? source === "desktop"
                    ? "Use any application now — VS Code, a PDF reader, Zoom. This pad is only a demo target: the agent sees the whole desktop. Type, correct mistakes, switch apps…"
                    : "Type, correct mistakes, pause, switch to another tab… Only the timing of key presses is used – this text is never stored or sent."
                  : "Start logging first."} disabled={!running} />
                <p className="mt-2 text-[11px] text-muted-foreground">{source === "desktop"
                  ? "The desktop agent records timing metadata system-wide. It never reads key characters, text, clipboard, window titles or mouse coordinates."
                  : "This browser prototype sees activity in this tab plus leaving it. Choose Desktop agent (all apps) above to cover other applications."}</p>
              </Panel>
              <Panel title="Latest epoch">
                {!last ? <p className="text-sm text-muted-foreground">{running ? `First epoch in ${epochSec} s…` : "No epochs yet."}</p> : (
                  <div className="grid gap-2">
                    <div className="grid grid-cols-3 gap-2">
                      <Metric label="Typing rate" value={`${last.f.typingRate.toFixed(0)}/min`} />
                      <Metric label="Rhythm variability (CV)" value={last.f.keyboardActive ? last.f.interKeyVar.toFixed(2) : "–"} hint={last.f.keyboardActive ? undefined : "too little typing"} />
                      <Metric label="Corrections" value={last.f.keyboardActive ? `${(last.f.backspaceRatio * 100).toFixed(0)}%` : "–"} />
                      <Metric label="Idle time" value={`${(last.f.idleRatio * 100).toFixed(0)}%`} />
                      <Metric label="Mouse speed" value={`${last.f.mouseSpeed.toFixed(0)} px/s`} />
                      <Metric label="App switching" value={`${last.f.switchRate.toFixed(1)}/min`} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[#eef3fd] px-3 py-2 text-sm">
                      <span className="font-semibold">State:</span> {last.f.stateLabel} · dwell {last.f.dwell} · changes (last 5) {last.f.changes}
                      <span className="text-muted-foreground">· app {last.app ?? "–"}</span>
                      <span className="ml-auto font-semibold text-[#2A6FDB]" title={models?.c1Source === "export" ? `Research export · ${models.c1TrainedOn}` : "Browser-trained fallback"}>{models?.c1Source === "export" ? "Research model · " : ""}Behaviour-only P(focused) = {last.p.toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </Panel>
            </div>

            <Panel title="Check the output with the trained model" right={<span className="text-[11px] text-muted-foreground">technical check</span>}>
              <p className="text-xs text-muted-foreground">These checks use the exact same C1 weights that produced the live score. The standalone script can repeat the score check on an exported file.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={checkStoredScores} disabled={!models || !rows.length} className="rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-50">Check stored scores</button>
                <button type="button" onClick={runHoldoutCheck} disabled={checkBusy} className="rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-50">{checkBusy ? "Running…" : "Run held-out check"}</button>
                {!rows.length && <span className="self-center text-[11px] text-muted-foreground">Run the demo first.</span>}
              </div>
              {checkError && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{checkError}</p>}

              {verifyResult && (
                <div className={`mt-3 rounded-xl p-3 text-sm ${verifyResult.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
                  {verifyResult.ok
                    ? `All ${verifyResult.count} stored scores match the trained model (largest difference ${verifyResult.maxDiff.toExponential(2)}).`
                    : `${verifyResult.mismatches.length} of ${verifyResult.count} scores do not match the trained model (largest difference ${verifyResult.maxDiff.toFixed(4)}).`}
                  {!verifyResult.ok && (
                    <ul className="mt-1 text-xs">
                      {verifyResult.mismatches.slice(0, 5).map((m) => <li key={m.index}>Epoch {m.index + 1}: stored {m.stored.toFixed(4)}, recomputed {m.expected.toFixed(4)}</li>)}
                    </ul>
                  )}
                </div>
              )}

              {comparison && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Same epoch, three models</p>
                  <table className="mt-2 w-full text-xs">
                    <thead><tr className="text-left text-muted-foreground"><th className="py-1">Model</th><th className="py-1">P(focused)</th><th className="py-1">Difference from C1</th></tr></thead>
                    <tbody>
                      {[
                        { label: "Simple activity counts (baseline)", value: comparison.baseline },
                        { label: "C1 trained model (live)", value: comparison.c1 },
                        { label: "C4 fusion (C1 stream only)", value: comparison.c4 },
                      ].map((row) => (
                        <tr key={row.label} className="border-t border-[#f3eee6]">
                          <td className="py-1.5">{row.label}</td>
                          <td className="py-1.5 font-mono">{row.value.toFixed(3)}</td>
                          <td className="py-1.5 font-mono text-muted-foreground">{row.label.startsWith("C1") ? "—" : `${row.value - comparison.c1 >= 0 ? "+" : ""}${(row.value - comparison.c1).toFixed(3)}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-1 text-[11px] text-muted-foreground">C4 is run with no environment or vision streams, so this is its C1-only fallback. Its own C1 check: {comparison.c4C1 != null ? comparison.c4C1.toFixed(3) : "—"}.</p>
                </div>
              )}

              {topContributions.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">What moved the latest score</p>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <div className="rounded-xl bg-[#eef7f1] p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#1E6B45]">Pushing up</p>
                      <ul className="mt-1.5 grid gap-1 text-sm">
                        {topContributions.filter((c) => c.direction === "helps").slice(0, 3).map((c) => (
                          <li key={c.feature} className="flex justify-between gap-3"><span>{contributionText(c)}</span><span className="font-mono text-xs text-muted-foreground">+{c.contribution.toFixed(2)}</span></li>
                        ))}
                        {!topContributions.some((c) => c.direction === "helps") && <li className="text-muted-foreground">Nothing notable.</li>}
                      </ul>
                    </div>
                    <div className="rounded-xl bg-[#fdf2f2] p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-700">Pulling down</p>
                      <ul className="mt-1.5 grid gap-1 text-sm">
                        {topContributions.filter((c) => c.direction === "hurts").slice(0, 3).map((c) => (
                          <li key={c.feature} className="flex justify-between gap-3"><span>{contributionText(c)}</span><span className="font-mono text-xs text-muted-foreground">{c.contribution.toFixed(2)}</span></li>
                        ))}
                        {!topContributions.some((c) => c.direction === "hurts") && <li className="text-muted-foreground">Nothing notable.</li>}
                      </ul>
                    </div>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">Contributions are on the logit scale: positive values raise P(focused), negative values lower it.</p>
                </div>
              )}

              {holdout && (
                <div className="mt-4 rounded-xl bg-[#f6f3ee] p-3">
                  <p className="text-sm font-semibold">Held-out check on the {holdout.trainedOn}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                    <Metric label="Accuracy" value={pct(holdout.accuracy)} />
                    <Metric label="Macro-F1" value={num(holdout.macroF1)} />
                    <Metric label="ROC-AUC" value={num(holdout.auc)} />
                    <Metric label="Majority baseline" value={pct(holdout.baselineAccuracy)} />
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">{holdout.participants} participants · {holdout.rows} probe-labelled rows · 5 participant-grouped folds. Simulated data, not real-world accuracy.</p>
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer font-semibold">Per-fold results</summary>
                    <table className="mt-2 w-full text-left text-xs">
                      <thead><tr className="text-muted-foreground"><th className="py-1">Fold</th><th>Participants</th><th>Rows</th><th>Accuracy</th><th>Macro-F1</th><th>AUC</th><th>Majority</th></tr></thead>
                      <tbody>
                        {holdout.folds.map((f) => (
                          <tr key={f.fold} className="border-t border-[#e9e2d7]">
                            <td className="py-1">{f.fold + 1}</td><td>{f.participants}</td><td>{f.rows}</td>
                            <td>{pct(f.accuracy)}</td><td>{num(f.macroF1)}</td><td>{num(f.auc)}</td><td>{pct(f.baselineAccuracy)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </div>
              )}
            </Panel>

            <Panel title="Interaction states and behaviour-only focus estimate over time">
              {rows.length ? (
                <>
                  <div className="flex h-6 overflow-hidden rounded-md">{rows.map((r, i) => <div key={i} title={`${r.at}: ${r.f.stateLabel}${r.app ? ` · ${r.app}` : ""}`} style={{ flex: 1, background: STATE_COLORS[r.f.state] }} />)}</div>
                  <div className="mt-2 flex flex-wrap gap-3 text-[11px]">{stateLabels.map((l, k) => <span key={k} className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: STATE_COLORS[k] }} />{l}</span>)}</div>
                  <p className="mt-3 text-[11px] text-muted-foreground">P(focused) from behaviour alone, with study mode ({mode}) as context</p>
                  <Spark values={rows.map((r) => r.p)} max={1} color="#2A6FDB" />
                </>
              ) : <p className="text-sm text-muted-foreground">Start logging to see the state sequence.</p>}
            </Panel>

            <Panel title="Exactly what is stored for the latest epoch (transparency)">
              <pre className="max-h-64 overflow-auto rounded-xl bg-[#1e2433] p-3 text-[11px] text-[#d7e1f5]">{last ? JSON.stringify({ source, mode, task, epochSec, activeApp: last.app, ...last.f }, (k, v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v), 2) : "–"}</pre>
              <p className="mt-2 text-[11px] text-muted-foreground">No characters, passwords, clipboard, window titles or mouse coordinates. The score comes from {models?.c1Source === "export" ? "the exported research model" : "a browser-trained fallback"}, trained on the simulated study; it is illustrative until it is retrained on real probe-labelled data. In desktop mode an app switch is any foreground application change, so the behaviour-only score is indicative rather than calibrated.</p>
              {saveState && (
                <p className={`mt-1 text-[11px] ${saveState.ok ? "text-[#1E6B45]" : "text-red-700"}`}>
                  {saveState.ok ? `Saved to ${saveTargetLabel(saveState.target)}.` : `Epoch not saved: ${saveState.error}`}
                  {saveState.ok && saveState.error ? ` ${saveState.error}` : ""}
                </p>
              )}
            </Panel>
          </>
        ) : (
          <>
            <Panel title={running ? "Your focus right now" : last ? "Your last check" : "Your focus"} right={<span className="text-[11px] text-muted-foreground">Prototype check</span>}>
              <div className="flex items-start gap-4">
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${tone.box}`}><ToneIcon className="h-6 w-6" /></span>
                <div className="min-w-0">
                  <h3 className="text-xl font-bold">{outcome.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{outcome.summary}</p>
                  <p className="mt-2 flex items-center gap-1.5 text-sm font-medium"><span className={`h-2 w-2 rounded-full ${tone.dot}`} />{outcome.trendText}</p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl bg-[#f6f3ee] p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">What we noticed</p>
                  <ul className="mt-2 grid gap-1.5 text-sm">
                    {outcome.notices.map((notice) => <li key={notice} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#2A6FDB]" />{notice}</li>)}
                  </ul>
                </div>
                <div className="rounded-xl bg-[#eef3fd] p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#2A6FDB]">What might help</p>
                  <p className="mt-2 text-sm">{outcome.suggestion}</p>
                </div>
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">A prototype clue from how you work — not a diagnosis. It never reads your text.</p>
            </Panel>

            <Panel title="Recent pattern">
              {rows.length ? (
                <>
                  <div className="flex h-8 overflow-hidden rounded-lg">{rows.map((r, i) => <div key={i} title={r.f.stateLabel} style={{ flex: 1, background: STATE_COLORS[r.f.state] }} />)}</div>
                  <div className="mt-2 flex flex-wrap gap-3 text-[11px]">{stateLabels.map((l, k) => <span key={k} className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: STATE_COLORS[k] }} />{l}</span>)}</div>
                  <p className="mt-3 text-sm text-muted-foreground">Each block is one update. The colours show the kind of work you were doing — not a score.</p>
                </>
              ) : <p className="text-sm text-muted-foreground">The pattern will appear after the first update. Press “Check now” if you do not want to wait.</p>}
            </Panel>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Try it here">
                <textarea className="h-40 w-full rounded-xl border p-3 text-sm" placeholder={running
                  ? "Type here, correct a mistake, pause, or switch to another app. We only record timing — never the words."
                  : "Press Start first."} disabled={!running} />
                <p className="mt-2 text-[11px] text-muted-foreground">This box is optional. In whole-computer mode the demo helper sees any app you use.</p>
              </Panel>
              <Panel title="How this works">
                <ul className="grid gap-2 text-sm">
                  <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#1E8E5A]" /><span>It only uses when you type, whether you pressed Backspace, how the mouse moves, and when you switch apps.</span></li>
                  <li className="flex gap-2"><EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-[#1E8E5A]" /><span>It never reads what you type, your passwords, clipboard, window titles or mouse coordinates.</span></li>
                  <li className="flex gap-2"><Activity className="mt-0.5 h-4 w-4 shrink-0 text-[#2A6FDB]" /><span>This is a prototype clue, not a diagnosis. The model is trained on simulated data until real study sessions are collected.</span></li>
                </ul>
                {saveState && <p className={`mt-3 text-xs ${saveState.ok ? "text-[#1E6B45]" : "text-red-700"}`}>{saveState.ok ? "This session is being saved for analysis." : "This update could not be saved."}</p>}
              </Panel>
            </div>
          </>
        )}
      </WorkbenchShell>
    </AppShell>
  )
}
