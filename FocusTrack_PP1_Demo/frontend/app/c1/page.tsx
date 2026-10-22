"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Download, Globe, Monitor, Play, RefreshCw, ShieldCheck, Square, Wifi, WifiOff, Zap } from "lucide-react"
import { AppShell } from "@/components/layout/app-shell"
import { Metric, Panel, Spark, WorkbenchShell, type WorkbenchInfo } from "@/components/workbench/workbench-shell"
import { useAuth } from "@/hooks/use-auth"
import { buffers, pushInput, windowOf, type InputEvent } from "@/lib/focus/buffers"
import { computeC1 } from "@/lib/focus/c1"
import { c1Smooth, c1Vec } from "@/lib/focus/c1-model"
import { C1_BACKEND_URL, saveC1Epoch, type SaveResult } from "@/lib/focus/c1-store"
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
    "Behaviour-only focus estimate that uses study mode and task as context (trained on the simulated study)",
    "Full analysis pipeline on the simulated study: LOPO, paired Wilcoxon, ablations, leave-one-task-out",
  ],
  next: [
    "Gaussian HMM states with BIC selection, replacing k-means",
    "Retrain and evaluate on real probe-labelled sessions after ethics approval and the pilot",
    "Integration: export C1 epochs and the keyboard-activity flag to C3 and C4",
  ],
  analysisTab: "C1 Behaviour",
}
const STATE_COLORS = ["#2A6FDB", "#1E8E5A", "#D9711C", "#9AA3B2"]
const DESKTOP_LAG_MS = 400

type Source = "desktop" | "browser"
type AgentState = "checking" | "online" | "offline"
interface Row { at: string; iso: string; app: string | null; f: C1Features; p: number }

const saveTargetLabel = (target?: SaveResult["target"]) =>
  target === "backend" ? "the backend" : target === "demo" ? "the in-browser demo store" : target === "supabase" ? "Supabase" : "storage"

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
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({
      component: "C1",
      note: "Interaction metadata only – no key content, text, window titles or mouse coordinates",
      source, studentId: student?.id ?? null, mode, task, epochSec, epochs: rows,
    }, null, 2)], { type: "application/json" })
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "focustrack_c1_epochs.json"; a.click()
  }
  const stateLabels = useMemo(() => models ? stateModel(models).labels : [], [models])
  const agentReady = agentState === "online" && Boolean(agentHealth?.ready)

  if (isLoading || !student) return null
  return (
    <AppShell studentName={student.name}>
      <WorkbenchShell info={INFO}>
        <Panel title="Session context and logger" right={<span className="text-[11px] text-muted-foreground">{models ? `Models trained on ${models.trainedOn}` : "Training models on the simulated study…"}</span>}>
          <div className="mb-3 grid gap-2 md:grid-cols-2">
            <button type="button" onClick={() => changeSource("desktop")} disabled={running}
              className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-60 ${source === "desktop" ? "border-[#2A6FDB] bg-[#eef3fd]" : "border-[#e3ddd2] bg-white hover:bg-[#faf8f4]"}`}>
              <Monitor className="mt-0.5 h-5 w-5 shrink-0" style={{ color: source === "desktop" ? "#2A6FDB" : "#6b7280" }} />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  Desktop agent (all apps)
                  {agentState === "checking" ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">checking…</span>
                    : agentReady ? <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"><Wifi className="h-3 w-3" />connected</span>
                    : agentState === "online" ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">input unavailable</span>
                    : <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600"><WifiOff className="h-3 w-3" />not running</span>}
                </span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">Records typing, mouse and app-switch metadata in VS Code, a PDF reader, Zoom — any application.</span>
              </span>
            </button>
            <button type="button" onClick={() => changeSource("browser")} disabled={running}
              className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-60 ${source === "browser" ? "border-[#2A6FDB] bg-[#eef3fd]" : "border-[#e3ddd2] bg-white hover:bg-[#faf8f4]"}`}>
              <Globe className="mt-0.5 h-5 w-5 shrink-0" style={{ color: source === "browser" ? "#2A6FDB" : "#6b7280" }} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">This browser tab</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">Works without Python. Only activity while this tab is focused is seen.</span>
              </span>
            </button>
          </div>

          {source === "desktop" && (
            <div className={`mb-3 rounded-xl px-3 py-2 text-xs ${agentReady ? "bg-[#eef7f1] text-[#1E6B45]" : "bg-[#fdf6e8] text-[#8a5a12]"}`}>
              {agentState === "checking" ? (
                <span className="flex items-center gap-2"><RefreshCw className="h-3.5 w-3.5 animate-spin" />Looking for the local desktop agent at {AGENT_URL}…</span>
              ) : agentReady ? (
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" />Connected · {agentHealth?.input.backend}</span>
                  <span>Active app: <b>{activeApp ?? agentHealth?.activeApp ?? "–"}</b></span>
                  {agentHealth?.window.ok === false && <span className="text-[#8a5a12]">App-switch tracking: unavailable</span>}
                </span>
              ) : (
                <span className="flex flex-wrap items-center gap-2">
                  <span>{agentState === "online" && agentHealth ? `Agent connected, but ${agentHealth.input.error ?? "input capture is unavailable."}` : `Desktop agent not detected at ${AGENT_URL}.`}</span>
                  <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-[10px]">python hardware/python_bridge/desktop_agent.py</code>
                  <button type="button" onClick={retryAgent} className="flex items-center gap-1 rounded-lg border border-current/30 px-2 py-1 font-semibold"><RefreshCw className="h-3 w-3" />Retry</button>
                </span>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-xs">Study mode
              <select className="rounded-lg border px-2 py-1.5 text-sm" value={mode} disabled={running} onChange={(e) => { const m = e.target.value as StudyMode; setMode(m); setTask(tasksFor(m)[0]) }}>
                <option value="screen">Screen</option><option value="non-screen">Non-screen</option>
              </select></label>
            <label className="grid gap-1 text-xs">Task
              <select className="rounded-lg border px-2 py-1.5 text-sm" value={task} disabled={running} onChange={(e) => setTask(e.target.value as LiveTask)}>
                {tasksFor(mode).map((t) => <option key={t} value={t}>{TASK_LABELS[t]}</option>)}
              </select></label>
            <label className="grid gap-1 text-xs">Epoch length
              <select className="rounded-lg border px-2 py-1.5 text-sm" value={epochSec} disabled={running} onChange={(e) => setEpochSec(Number(e.target.value))}>
                <option value={60}>60 s (study setting)</option><option value={15}>15 s (fast demo)</option>
              </select></label>
            {!running ? (
              <button onClick={() => void start()} disabled={!models || (source === "desktop" && !agentReady)} className="flex items-center gap-2 rounded-xl bg-[#2A6FDB] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Play className="h-4 w-4" />Start logging</button>
            ) : (
              <button onClick={() => void stop()} className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white"><Square className="h-4 w-4" />Stop</button>
            )}
            <button onClick={() => void tick(true)} disabled={!running} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm disabled:opacity-50"><Zap className="h-4 w-4" />Read epoch now</button>
            <button onClick={exportJson} disabled={!rows.length} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm disabled:opacity-50"><Download className="h-4 w-4" />Export epochs</button>
          </div>
          {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
            <Metric label="Active application" value={<span className="text-sm">{activeApp ?? "–"}</span>} hint={source === "desktop" ? "system-wide" : "this tab"} />
            <Metric label="Key presses (this epoch)" value={live.keys} />
            <Metric label="Corrections (Backspace/Delete)" value={live.backs} />
            <Metric label="Mouse samples" value={live.moves} />
            <Metric label={source === "desktop" ? "App switches (this epoch)" : "Times left the app"} value={live.switches} hint={source === "desktop" ? "foreground application changes" : "switch tab or window to test"} />
          </div>
          <label className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
            <input type="checkbox" checked={persist} onChange={(e) => setPersist(e.target.checked)} className="h-3.5 w-3.5" />
            Save each numeric epoch to {C1_BACKEND_URL ? "the backend (fallback: app database)" : "the app database (Supabase, or the browser demo store)"}
          </label>
        </Panel>

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
                  <span className="ml-auto font-semibold text-[#2A6FDB]">Behaviour-only P(focused) = {last.p.toFixed(2)}</span>
                </div>
              </div>
            )}
          </Panel>
        </div>

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
          <p className="mt-2 text-[11px] text-muted-foreground">No characters, passwords, clipboard, window titles or mouse coordinates. The model behind P(focused) is a prototype trained on the simulated study, so its output is illustrative until it is retrained on real probe-labelled data. In desktop mode an app switch is any foreground application change, so the behaviour-only score is indicative rather than calibrated.</p>
          {saveState && (
            <p className={`mt-1 text-[11px] ${saveState.ok ? "text-[#1E6B45]" : "text-red-700"}`}>
              {saveState.ok ? `Saved to ${saveTargetLabel(saveState.target)}.` : `Epoch not saved: ${saveState.error}`}
              {saveState.ok && saveState.error ? ` ${saveState.error}` : ""}
            </p>
          )}
        </Panel>
      </WorkbenchShell>
    </AppShell>
  )
}
