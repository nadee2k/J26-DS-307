"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Bell, Pause, Play, RotateCcw, SkipForward } from "lucide-react"
import { AppShell } from "@/components/layout/app-shell"
import { Metric, Panel, WorkbenchShell, type WorkbenchInfo } from "@/components/workbench/workbench-shell"
import { useAuth } from "@/hooks/use-auth"
import { generateStudy } from "@/lib/sim/generate"
import type { Epoch, SimSession } from "@/lib/sim/types"
import { reasonText, scoreEpoch, toFeat, updateThreshold, zOf, type PolicyState } from "@/lib/focus/c4"
import { getModels, type Models } from "@/lib/focus/models"
import type { C1Features, C2Features, C3Features, C4Output } from "@/lib/focus/types"

const INFO: WorkbenchInfo = {
  n: 4, title: "Temporal Attention Analysis, XAI and Decision Optimisation", owner: "Ayyash M.R.Y.", id: "IT23203662",
  question: "Can a focus drop be forecast 5–10 minutes ahead and turned into a useful, explained alert without alert fatigue?",
  done: [
    "Forecast of a focus drop (next probe z ≤ −1) 5–10 minutes ahead from fused epoch features, with H1/H2 ablations",
    "Feature-level fusion with a decision-level fallback when a stream is missing",
    "Personal alert policy prototype: threshold, hourly budget and minimum gap; 'Helpful / Not now' feedback moves the threshold",
    "Explanations: top contributing factors in plain language plus a counterfactual over changeable factors",
    "Phase-1 / phase-2 switch: in phase 1 alerts are logged but never shown",
  ],
  next: [
    "Integration: score the live C1–C3 epochs from a real session instead of a replay",
    "Compare persistence, ARIMA, logistic, XGBoost and LSTM; calibrate risks (Platt / isotonic)",
    "Bayesian optimisation of the personal threshold from a pooled prior; SHAP / LIME cross-checks",
    "Phase-2 within-subject study (fixed vs personal policy) after phase-1 data collection",
  ],
  analysisTab: "C4 Temporal & XAI",
}

interface Step { t: number; out: C4Output; reasons: string[]; response: "helpful" | "not-now" | null }

const asC1 = (e: Epoch): C1Features => ({ typingRate: e.typingRate, interKeyVar: e.interKeyVar, backspaceRatio: e.backspaceRatio, idleRatio: e.idleRatio, mouseSpeed: e.mouseSpeed, switchRate: e.switchRate, scrollRate: 0, keyboardActive: e.keyboardActive, state: 0, stateLabel: "", dwell: 1, changes: 0, awayShare: 0 })
const outside = (v: number, b: [number, number]) => (v < b[0] ? b[0] - v : v > b[1] ? v - b[1] : 0)
// comfort ranges: the population band from the simulated study (a replayed learner has no earlier sessions)
const asC2 = (e: Epoch, band: { noise: [number, number]; temp: [number, number] }): C2Features => ({ temp: e.temp, humidity: e.humidity, light: e.light, noise: e.noise, motion: e.motion, noiseSd: null, tempSlope: null, readings: 60, missingRatio: 0, outliersRemoved: 0, comfortNoise: outside(e.noise, band.noise), comfortTemp: outside(e.temp, band.temp), calibrated: true })
const asC3 = (e: Epoch): C3Features => ({ pitchMean: e.pitchMean, yawStd: e.yawStd, zoneScreen: e.zoneScreen, zoneDesk: e.zoneDesk, zoneAway: e.zoneAway, readingMotion: e.readingMotion, phoneInFrame: e.phoneInFrame, validFace: e.validFace, glare: e.glare, lowLight: 0, dgdState: "screen", dgdShares: { screen: 0, reading: 0, typing: 0, phone: 0, away: 0, unclear: 0, "no-face": 0 }, frames: 180, personalModel: true })

export default function C4Workbench() {
  const { student, isLoading } = useAuth()
  const router = useRouter()
  const [models, setModels] = useState<Models | null>(null)
  // replay learners come from a different seed than the training study, so the models have never seen them
  const replay = useMemo(() => generateStudy(4242, 4, 3), [])
  // start on the session with the most probe-labelled focus drops (the most informative replay)
  const bestSession = useMemo(() => {
    let best = 0, most = -1
    replay.sessions.forEach((s, i) => {
      const all = replay.sessions.filter((x) => x.pid === s.pid).flatMap((x) => x.probes.map((p) => p.rating))
      const drops = s.probes.filter((p) => zOf(p.rating, all) <= -1).length
      if (drops > most) { most = drops; best = i }
    })
    return best
  }, [replay])
  const [sid, setSid] = useState(bestSession)
  const session: SimSession = replay.sessions[sid]
  const [policy, setPolicy] = useState<PolicyState>({ threshold: 0.5, maxPerHour: 3, showAlerts: true, minGapEpochs: 10 })
  const [drop, setDrop] = useState({ c2: false, c3: false })
  const [steps, setSteps] = useState<Step[]>([])
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(700)
  const thRef = useRef(0.5)

  useEffect(() => { if (!isLoading && !student) router.push("/login") }, [student, isLoading, router])
  useEffect(() => { const t = setTimeout(() => setModels(getModels()), 50); return () => clearTimeout(t) }, [])
  const reset = useCallback(() => { setSteps([]); setPlaying(false); thRef.current = policy.threshold }, [policy.threshold])
  useEffect(() => { reset() }, [sid, drop.c2, drop.c3]) // eslint-disable-line react-hooks/exhaustive-deps

  const ratingsBefore = useCallback((t: number) => {
    const prev = replay.sessions.filter((s) => s.pid === session.pid && s.index < session.index).flatMap((s) => s.probes.map((p) => p.rating))
    return [...prev, ...session.probes.filter((p) => p.t <= t).map((p) => p.rating)]
  }, [replay, session])

  const advance = useCallback(() => {
    if (!models) return
    setSteps((prev) => {
      const t = prev.length
      if (t >= session.epochs.length) { setPlaying(false); return prev }
      const e = session.epochs[t]
      const band = models.populationBand
      const c1 = asC1(e), c2 = drop.c2 ? null : asC2(e, band), c3 = drop.c3 ? null : asC3(e)
      const win = session.epochs.slice(Math.max(0, t - 3), t + 1).map((x) => toFeat(asC1(x), drop.c2 ? null : asC2(x, band), drop.c3 ? null : asC3(x)))
      const hist = ratingsBefore(t)
      const lastProbe = [...session.probes].reverse().find((p) => p.t <= t)
      const lastZ = lastProbe ? zOf(lastProbe.rating, hist.slice(0, -1)) : 0
      const lastAlert = [...prev].reverse().find((s) => s.out.alert)
      const out = scoreEpoch({
        models, c1, c2, c3, window: win, screen: session.mode === "screen", minutesOnTask: t, lastZ, epochIndex: t, epochMinutes: 1,
        alertsLastHour: prev.filter((s) => s.out.alert && s.t > t - 60).length, lastAlertIndex: lastAlert ? lastAlert.t : null,
        policy: { ...policy, threshold: thRef.current },
      })
      const reasons = out.contributions.map((c) => reasonText(c, { c2, c3, minutesOnTask: t }))
      return [...prev, { t, out, reasons, response: null }]
    })
  }, [models, session, drop, policy, ratingsBefore])

  useEffect(() => { if (!playing) return; const id = setInterval(advance, speed); return () => clearInterval(id) }, [playing, speed, advance])

  const respond = (i: number, r: "helpful" | "not-now") => {
    thRef.current = updateThreshold(thRef.current, r)
    setSteps((s) => s.map((x, j) => (j === i ? { ...x, response: r } : x)))
  }

  // evaluation of this replay against the probes: an alert is a hit if a probe 5–10 min later is a focus drop
  const allRatings = useMemo(() => replay.sessions.filter((s) => s.pid === session.pid).flatMap((s) => s.probes.map((p) => p.rating)), [replay, session])
  const dropAt = useMemo(() => session.probes.filter((p) => zOf(p.rating, allRatings) <= -1).map((p) => p.t), [session, allRatings])
  const alerts = steps.filter((s) => s.out.alert)
  const hits = alerts.filter((a) => dropAt.some((d) => d - a.t >= 4 && d - a.t <= 10)).length
  const cur = steps[steps.length - 1]
  const lastAlertStep = [...steps].reverse().find((s) => s.out.alert)
  const W = 640, H = 170, X = (t: number) => 30 + (t / Math.max(1, session.epochs.length - 1)) * (W - 40), Y = (v: number) => 10 + (1 - v) * (H - 40)

  if (isLoading || !student) return null
  return (
    <AppShell studentName={student.name}>
      <WorkbenchShell info={INFO}>
        <Panel title="Replay of a simulated session (a learner the models were not trained on)" right={<span className="text-[11px] text-muted-foreground">{models ? `Models: ${models.trainedOn}` : "Training models…"}</span>}>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-xs">Session
              <select className="rounded-lg border px-2 py-1.5 text-sm" value={sid} onChange={(e) => setSid(Number(e.target.value))}>
                {replay.sessions.map((s, i) => <option key={s.id} value={i}>{s.pid.toUpperCase()} · session {s.index + 1} · {s.mode} · {s.task} · {s.room}</option>)}
              </select></label>
            <label className="grid gap-1 text-xs">Speed
              <select className="rounded-lg border px-2 py-1.5 text-sm" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                <option value={1200}>slow</option><option value={700}>normal</option><option value={250}>fast</option>
              </select></label>
            <button onClick={() => setPlaying((p) => !p)} disabled={!models} className="flex items-center gap-2 rounded-xl bg-[#7D3CB0] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{playing ? <><Pause className="h-4 w-4" />Pause</> : <><Play className="h-4 w-4" />Play</>}</button>
            <button onClick={advance} disabled={!models} className="flex items-center gap-1 rounded-xl border px-3 py-2 text-sm"><SkipForward className="h-4 w-4" />Step</button>
            <button onClick={reset} className="flex items-center gap-1 rounded-xl border px-3 py-2 text-sm"><RotateCcw className="h-4 w-4" />Reset</button>
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={drop.c3} onChange={(e) => setDrop((d) => ({ ...d, c3: e.target.checked }))} />Drop the C3 stream</label>
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={drop.c2} onChange={(e) => setDrop((d) => ({ ...d, c2: e.target.checked }))} />Drop the C2 stream</label>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full">
            {[0, 0.5, 1].map((v) => <line key={v} x1={30} x2={W - 10} y1={Y(v)} y2={Y(v)} stroke="#E3E7EF" />)}
            <line x1={30} x2={W - 10} y1={Y(thRef.current)} y2={Y(thRef.current)} stroke="#7D3CB0" strokeDasharray="5 3" />
            <text x={W - 12} y={Y(thRef.current) - 4} fontSize="10" textAnchor="end" fill="#7D3CB0">alert threshold {thRef.current.toFixed(2)}</text>
            <path d={session.epochs.map((e, t) => `${t ? "L" : "M"}${X(t)} ${Y(e.focus)}`).join(" ")} fill="none" stroke="#C9D3EE" strokeWidth={2} />
            <path d={steps.map((s) => `${s.t ? "L" : "M"}${X(s.t)} ${Y(s.out.focusProb)}`).join(" ")} fill="none" stroke="#1B2F6E" strokeWidth={2} />
            <path d={steps.map((s) => `${s.t ? "L" : "M"}${X(s.t)} ${Y(s.out.risk)}`).join(" ")} fill="none" stroke="#C0392B" strokeWidth={2} />
            {session.probes.map((p) => <g key={p.t}><circle cx={X(p.t)} cy={H - 14} r={8} fill={dropAt.includes(p.t) ? "#C0392B" : "#1E8E5A"} /><text x={X(p.t)} y={H - 10} fontSize="10" textAnchor="middle" fill="#fff">{p.rating}</text></g>)}
            {steps.filter((s) => s.out.alert).map((s) => <text key={s.t} x={X(s.t)} y={Y(s.out.risk) - 6} fontSize="13" textAnchor="middle">🔔</text>)}
            {steps.filter((s) => !s.out.alert && s.out.alertSuppressed).map((s) => <circle key={s.t} cx={X(s.t)} cy={Y(s.out.risk)} r={2.5} fill="#C77C0E" />)}
          </svg>
          <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground">
            <span><b className="text-[#1B2F6E]">—</b> focus score (fused, 100 × P(focused))</span><span><b className="text-[#C0392B]">—</b> drop risk (5–10 min ahead)</span>
            <span><b className="text-[#9AA3B2]">—</b> simulator ground truth (hidden in a real study)</span><span>● probe rating (red = focus drop, z ≤ −1)</span><span>🔔 alert · <b className="text-[#C77C0E]">•</b> over threshold but suppressed</span>
          </div>
        </Panel>

        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <Panel title={`Minute ${cur ? cur.t : "–"}`}>
            {cur ? (
              <div className="grid gap-2">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Metric label="Focus score" value={Math.round(cur.out.focusProb * 100)} />
                  <Metric label="Drop risk" value={cur.out.risk.toFixed(2)} hint={`threshold ${cur.out.threshold.toFixed(2)}`} />
                  <Metric label="Fusion" value={cur.out.fusion === "feature-level" ? "feature" : "fallback"} hint={`C2 ${cur.out.streams.c2 ? "on" : "off"} · C3 ${cur.out.streams.c3 ? "on" : "off"}`} />
                  <Metric label="Behaviour only (C1)" value={cur.out.c1FocusProb != null ? Math.round(cur.out.c1FocusProb * 100) : "–"} />
                </div>
                <p className="text-xs"><b>Main factors raising the risk:</b> {cur.reasons.length ? cur.reasons.join(" · ") : "none"}</p>
                {cur.out.alertSuppressed && <p className="text-xs text-[#8A5208]">Risk above the threshold, alert not raised: {cur.out.alertSuppressed}.</p>}
              </div>
            ) : <p className="text-sm text-muted-foreground">Press Play or Step.</p>}
          </Panel>
          <Panel title="Alert (as the learner would see it)" right={
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={policy.showAlerts} onChange={(e) => setPolicy((p) => ({ ...p, showAlerts: e.target.checked }))} />Phase 2: show alerts</label>}>
            {!lastAlertStep ? <p className="text-sm text-muted-foreground">No alert yet.</p> : !policy.showAlerts ? (
              <p className="text-sm text-muted-foreground">Phase 1 (observation): the alert at minute {lastAlertStep.t} was logged but not shown, so the training data are not changed by interventions.</p>
            ) : (
              <div className="rounded-2xl border border-[#7D3CB0]/30 bg-[#F1E8F8] p-4">
                <p className="flex items-center gap-2 font-semibold text-[#7D3CB0]"><Bell className="h-4 w-4" />Your focus may drop in the next 5–10 minutes</p>
                <p className="mt-2 text-xs font-semibold">Why</p>
                <ul className="list-disc pl-5 text-sm">{lastAlertStep.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                <p className="mt-2 text-xs font-semibold">Try</p>
                <p className="text-sm">{lastAlertStep.out.counterfactual ?? "No single small change brings the risk below your alert level – consider a short break."}</p>
                <div className="mt-3 flex gap-2">
                  {lastAlertStep.response ? <span className="text-xs text-muted-foreground">You answered “{lastAlertStep.response === "helpful" ? "Helpful" : "Not now"}” – alert level is now {thRef.current.toFixed(2)}</span> : (
                    <>
                      <button onClick={() => respond(steps.indexOf(lastAlertStep), "helpful")} className="rounded-full bg-[#7D3CB0] px-4 py-1.5 text-sm font-semibold text-white">Helpful</button>
                      <button onClick={() => respond(steps.indexOf(lastAlertStep), "not-now")} className="rounded-full border border-[#7D3CB0] px-4 py-1.5 text-sm font-semibold text-[#7D3CB0]">Not now</button>
                    </>
                  )}
                </div>
              </div>
            )}
          </Panel>
        </div>

        <Panel title="Policy and this replay's outcome">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            <Metric label="Start threshold (pooled prior)" value={policy.threshold.toFixed(2)} />
            <Metric label="Alerts per hour (max)" value={policy.maxPerHour} />
            <Metric label="Minimum gap" value={`${policy.minGapEpochs} min`} />
            <Metric label="Alerts raised" value={alerts.length} />
            <Metric label="Followed by a drop" value={`${hits} of ${alerts.length}`} hint="probe z ≤ −1 within 4–10 min" />
            <Metric label="Probe drops" value={dropAt.length} />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">One replayed session is a demonstration, not evidence. Forecast accuracy and the fixed-vs-personal policy comparison across all simulated learners are in the analysis tab; with real data they are tested on phase-1 data (forecast) and in the phase-2 study (policy).</p>
        </Panel>
      </WorkbenchShell>
    </AppShell>
  )
}
