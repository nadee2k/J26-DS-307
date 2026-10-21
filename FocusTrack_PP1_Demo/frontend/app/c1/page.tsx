"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Download, Play, Square } from "lucide-react"
import { AppShell } from "@/components/layout/app-shell"
import { Metric, Panel, Spark, WorkbenchShell, type WorkbenchInfo } from "@/components/workbench/workbench-shell"
import { useAuth } from "@/hooks/use-auth"
import { buffers, pushInput, windowOf } from "@/lib/focus/buffers"
import { computeC1 } from "@/lib/focus/c1"
import { toFeat } from "@/lib/focus/c4"
import { c1Vec, getModels, scoreLin, stateModel, type Models } from "@/lib/focus/models"
import { TASK_LABELS, tasksFor, type C1Features, type LiveTask, type StudyMode } from "@/lib/focus/types"

const INFO: WorkbenchInfo = {
  n: 1, title: "Context-Aware Learner Interaction-State Modelling", owner: "Kumari M.A.D.N.", id: "IT23211032",
  question: "Does a state-and-transition representation, read in the context of the task, beat simple activity counts?",
  done: [
    "Privacy-preserving logger: key timing and a Backspace flag only (never which key), mouse, scroll, leaving the app",
    "Per-epoch features: typing rate, typing-rhythm variability, corrections, idle time, mouse speed, app switching",
    "Interaction states (k-means prototype) with dwell time and state changes",
    "Behaviour-only focus estimate that uses study mode and task as context (trained on the simulated study)",
    "Full analysis pipeline on the simulated study: LOPO, paired Wilcoxon, ablations, leave-one-task-out",
  ],
  next: [
    "Desktop logger for apps outside the browser (pynput/psutil agent in hardware/python_bridge)",
    "Gaussian HMM states with BIC selection, replacing k-means",
    "Retrain and evaluate on real probe-labelled sessions after ethics approval and the pilot",
    "Integration: export C1 epochs and the keyboard-activity flag to C3 and C4",
  ],
  analysisTab: "C1 Behaviour",
}
const STATE_COLORS = ["#2A6FDB", "#1E8E5A", "#D9711C", "#9AA3B2"]

interface Row { at: string; f: C1Features; p: number }

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
  const awayRef = useRef(false)
  const lastTickRef = useRef(0)
  const statesRef = useRef<number[]>([])
  const runningRef = useRef(false)

  useEffect(() => { if (!isLoading && !student) router.push("/login") }, [student, isLoading, router])
  useEffect(() => { const t = setTimeout(() => setModels(getModels()), 50); return () => clearTimeout(t) }, [])

  // the logger: timing metadata only
  useEffect(() => {
    if (!running) return
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
  }, [running])

  const tick = useCallback(() => {
    if (!models || !runningRef.current) return
    const now = Date.now(), from = lastTickRef.current
    const events = windowOf(buffers.input, from, now)
    const awayAtStart = (() => { let a = false; for (const e of buffers.input) { if (e.t >= from) break; if (e.kind === "leave") a = true; if (e.kind === "return") a = false } return a })()
    const f = computeC1(events, from, now, awayAtStart, statesRef.current, stateModel(models))
    statesRef.current.push(f.state)
    const p = scoreLin(models.c1, c1Vec(toFeat(f, null, null), mode === "screen"))
    setRows((r) => [...r, { at: new Date(now).toLocaleTimeString(), f, p }])
    setLive({ keys: 0, backs: 0, moves: 0, switches: 0 })
    lastTickRef.current = now
  }, [models, mode])

  useEffect(() => {
    if (!running) return
    const id = setInterval(tick, epochSec * 1000)
    return () => clearInterval(id)
  }, [running, epochSec, tick])

  const start = () => { buffers.input.length = 0; statesRef.current = []; setRows([]); lastTickRef.current = Date.now(); runningRef.current = true; setRunning(true) }
  const stop = () => { runningRef.current = false; setRunning(false) }

  const last = rows[rows.length - 1]
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ component: "C1", note: "Interaction metadata only – no key content", mode, task, epochSec, epochs: rows }, null, 2)], { type: "application/json" })
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "focustrack_c1_epochs.json"; a.click()
  }
  const stateLabels = useMemo(() => models ? stateModel(models).labels : [], [models])

  if (isLoading || !student) return null
  return (
    <AppShell studentName={student.name}>
      <WorkbenchShell info={INFO}>
        <Panel title="Session context and logger" right={<span className="text-[11px] text-muted-foreground">{models ? `Models trained on ${models.trainedOn}` : "Training models on the simulated study…"}</span>}>
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
              <button onClick={start} disabled={!models} className="flex items-center gap-2 rounded-xl bg-[#2A6FDB] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Play className="h-4 w-4" />Start logging</button>
            ) : (
              <button onClick={stop} className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white"><Square className="h-4 w-4" />Stop</button>
            )}
            <button onClick={exportJson} disabled={!rows.length} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm disabled:opacity-50"><Download className="h-4 w-4" />Export epochs</button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <Metric label="Key presses (this epoch)" value={live.keys} />
            <Metric label="Corrections (Backspace/Delete)" value={live.backs} />
            <Metric label="Mouse samples" value={live.moves} />
            <Metric label="Times left the app" value={live.switches} hint="switch tab or window to test" />
          </div>
        </Panel>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Study pad (try the logger here)">
            <textarea className="h-40 w-full rounded-xl border p-3 text-sm" placeholder={running ? "Type, correct mistakes, pause, switch to another tab… Only the timing of key presses is used – this text is never stored or sent." : "Start logging first."} disabled={!running} />
            <p className="mt-2 text-[11px] text-muted-foreground">In the study, the desktop logger records the same metadata system-wide; this browser prototype sees activity in this tab plus leaving it.</p>
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
                  <span className="ml-auto font-semibold text-[#2A6FDB]">Behaviour-only P(focused) = {last.p.toFixed(2)}</span>
                </div>
              </div>
            )}
          </Panel>
        </div>

        <Panel title="Interaction states and behaviour-only focus estimate over time">
          {rows.length ? (
            <>
              <div className="flex h-6 overflow-hidden rounded-md">{rows.map((r, i) => <div key={i} title={`${r.at}: ${r.f.stateLabel}`} style={{ flex: 1, background: STATE_COLORS[r.f.state] }} />)}</div>
              <div className="mt-2 flex flex-wrap gap-3 text-[11px]">{stateLabels.map((l, k) => <span key={k} className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: STATE_COLORS[k] }} />{l}</span>)}</div>
              <p className="mt-3 text-[11px] text-muted-foreground">P(focused) from behaviour alone, with study mode ({mode}) as context</p>
              <Spark values={rows.map((r) => r.p)} max={1} color="#2A6FDB" />
            </>
          ) : <p className="text-sm text-muted-foreground">Start logging to see the state sequence.</p>}
        </Panel>

        <Panel title="Exactly what is stored for the latest epoch (transparency)">
          <pre className="max-h-64 overflow-auto rounded-xl bg-[#1e2433] p-3 text-[11px] text-[#d7e1f5]">{last ? JSON.stringify({ mode, task, epochSec, ...last.f }, (k, v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v), 2) : "–"}</pre>
          <p className="mt-2 text-[11px] text-muted-foreground">No characters, passwords, clipboard or window titles. The model behind P(focused) is a prototype trained on the simulated study, so its output is illustrative until it is retrained on real probe-labelled data.</p>
        </Panel>
      </WorkbenchShell>
    </AppShell>
  )
}
