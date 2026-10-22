"use client"

import { useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, Bell, BookOpen, Clock, Loader2, Sparkles } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { useDemo } from "@/hooks/use-demo"
import { cn, mean } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/input"
import { DemoShell, Metric, Panel } from "@/components/demo/shell"
import { FocusGauge } from "@/components/demo/focus-gauge"
import { SessionTimeline } from "@/components/demo/session-timeline"
import { StateRibbon } from "@/components/demo/state-ribbon"
import { AlertCard } from "@/components/demo/alert-card"
import { SourceStatus } from "@/components/demo/source-status"
import { TASK_LABELS } from "@/lib/focus/types"

export default function LiveSessionPage() {
  const { student, isLoading } = useAuth()
  const {
    run,
    cursor,
    alerts,
    threshold,
    playing,
    speed,
    science,
    advance,
    setPlaying,
    jumpTo,
    respond,
    finish,
    restoring,
  } = useDemo()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !student) router.replace("/login")
  }, [student, isLoading, router])

  useEffect(() => {
    if (!isLoading && !restoring && student && !run) router.replace("/demo/session")
  }, [student, isLoading, restoring, run, router])

  useEffect(() => {
    if (!playing) return
    const id = setInterval(advance, 1800 / speed)
    return () => clearInterval(id)
  }, [playing, speed, advance])

  const frame = run?.frames[cursor]
  const recent = useMemo(() => (run ? run.frames.slice(Math.max(0, cursor - 2), cursor + 1).map((f) => f.focusProb * 100) : []), [run, cursor])
  const previous = useMemo(() => (run ? run.frames.slice(Math.max(0, cursor - 5), Math.max(1, cursor - 2)).map((f) => f.focusProb * 100) : []), [run, cursor])
  const current = recent.length ? mean(recent) : 0
  const trend: "up" | "down" | "flat" = recent.length < 2 ? "flat" : current - mean(previous) > 2 ? "up" : mean(previous) - current > 2 ? "down" : "flat"

  const dwell = useMemo(() => {
    if (!run || cursor < 0) return 1
    let d = 1
    for (let i = cursor; i > 0; i--) {
      if (run.frames[i].stateLabel !== run.frames[i - 1].stateLabel) break
      d++
    }
    return d
  }, [run, cursor])

  const interruptions = useMemo(() => {
    if (!run) return 0
    let n = 0
    for (let i = 1; i <= cursor; i++) {
      const a = run.frames[i - 1].stateLabel
      const b = run.frames[i].stateLabel
      if (a !== b && (b.includes("Leaving") || b.includes("Idle"))) n++
    }
    return n
  }, [run, cursor])

  const nextAlert = useMemo(() => {
    if (!run) return null
    const last = alerts[alerts.length - 1]
    const start = Math.max(cursor + 1, last ? last.t + 10 : 3)
    for (let i = start; i < run.frames.length; i++) if (run.frames[i].risk > threshold) return i
    return null
  }, [run, cursor, threshold, alerts])

  if (isLoading || !student || !run || !frame) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Preparing the integrated session…</p>
        </div>
      </div>
    )
  }

  const quietReading = run.mode === "non-screen" && frame.c1.idleRatio >= 0.6 && frame.c1.switchRate < 1.5
  const latest = alerts[alerts.length - 1]
  const ended = cursor >= run.frames.length - 1

  return (
    <DemoShell step={2} wide>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">Step 2 · live</p>
            <Badge tone="plum">{run.mode === "screen" ? "screen" : "paper"} session</Badge>
            {playing && <Badge tone="good">recording</Badge>}
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{TASK_LABELS[run.config.task]}</h1>
          <p className="text-xs text-muted-foreground">
            {run.config.place} · minute {cursor} of {run.frames.length - 1} · learner {run.participantCode}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1.5 text-[11px] text-muted-foreground">
            <Bell className="h-3.5 w-3.5" /> {alerts.length} {alerts.length === 1 ? "alert" : "alerts"}
          </span>
          <Button size="sm" variant="outline" onClick={() => { finish(); router.push("/demo/outcome") }}>
            End session <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[250px_minmax(0,1fr)_350px]">
        {/* Left rail */}
        <div className="grid content-start gap-3">
          <Panel title="Session">
            <div className="flex items-center gap-3">
              <div className="relative flex h-14 w-14 items-center justify-center rounded-full border-4 border-secondary">
                <span className="font-mono text-xs font-semibold">{Math.round((cursor / Math.max(1, run.frames.length - 1)) * 100)}%</span>
              </div>
              <div className="text-xs">
                <p className="flex items-center gap-1.5 font-medium"><Clock className="h-3.5 w-3.5 text-muted-foreground" /> {cursor} min elapsed</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{run.frames.length - 1 - cursor} min remaining</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Metric label="State" value={<span className="text-[11px] leading-tight">{frame.stateLabel.split(" ")[0]}</span>} hint={frame.stateLabel} />
              <Metric label="Focus" value={Math.round(current)} hint="last 3 minutes" />
            </div>
          </Panel>

          <Panel title="Sources" right={<span className="text-[9px] text-muted-foreground">C1·C2·C3</span>}>
            <SourceStatus frame={frame} streams={run.config.streams} science={science} />
          </Panel>

          <Panel title="Now">
            <div className="grid gap-1.5 text-[11px]">
              <div className="flex justify-between"><span className="text-muted-foreground">Focus score</span><span className="font-mono font-semibold">{Math.round(current)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Drop risk</span><span className="font-mono font-semibold">{Math.round(frame.risk * 100)}%</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Your alert level</span><span className="font-mono font-semibold">{Math.round(threshold * 100)}%</span></div>
              {science && (
                <>
                  <div className="flex justify-between border-t border-border pt-1.5"><span className="text-muted-foreground">Behaviour only</span><span className="font-mono font-semibold">{frame.c1FocusProb != null ? Math.round(frame.c1FocusProb * 100) : "—"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Fusion</span><span className="font-mono text-[10px]">{frame.fusion === "feature-level" ? "feature" : "fallback"}</span></div>
                </>
              )}
            </div>
          </Panel>

          {quietReading && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800">
                <BookOpen className="h-3.5 w-3.5" /> Quiet is expected here
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-emerald-800/80">
                In a paper session, low activity is normal. The model combines gaze and reading motion, so it does not
                mistake reading for distraction — the case activity-only models get wrong.
              </p>
            </div>
          )}
        </div>

        {/* Center */}
        <div className="grid content-start gap-3">
          <Panel className="relative overflow-hidden">
            <div className="grid items-center gap-4 sm:grid-cols-[190px_1fr]">
              <div className="mx-auto">
                <FocusGauge value={current} trend={trend} />
              </div>
              <div className="grid gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">5–10 minute forecast</p>
                  <div className="mt-1.5 flex items-end justify-between">
                    <p className="text-sm font-medium">
                      {frame.risk >= threshold
                        ? "An early warning is available"
                        : frame.risk >= threshold - 0.08
                          ? "Worth keeping an eye on"
                          : "No drop signal right now"}
                    </p>
                    <p className="font-mono text-sm font-semibold">{Math.round(frame.risk * 100)}%</p>
                  </div>
                  <div className="relative mt-1.5 h-2.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full transition-all duration-500", frame.risk >= threshold ? "bg-[#b0834a]" : "bg-[#c4b0d6]")}
                      style={{ width: `${Math.min(100, frame.risk * 100)}%` }}
                    />
                    <span className="absolute top-0 h-full w-0.5 bg-foreground/50" style={{ left: `${threshold * 100}%` }} title="your alert level" />
                  </div>
                  <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
                    <span>low</span>
                    <span>alert level {Math.round(threshold * 100)}% · starting level</span>
                    <span>high</span>
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {frame.reasons.length ? `Main signals: ${frame.reasons.slice(0, 2).join(" · ")}` : "The signals are stable — no single factor is pulling focus down."}
                </p>
              </div>
            </div>
          </Panel>

          <Panel title="Session timeline" right={<span className="text-[10px] text-muted-foreground">focus · risk · probes</span>}>
            <SessionTimeline run={run} cursor={cursor} alerts={alerts} threshold={threshold} />
          </Panel>

          <Panel title="Interaction states" right={<span className="text-[10px] text-muted-foreground">unsupervised, label-free</span>}>
            <StateRibbon run={run} cursor={cursor} />
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Metric label="Dwell now" value={`${dwell} min`} />
              <Metric label="Interruptions" value={interruptions} hint="state-based" />
              <Metric label="Screen vs paper" value={run.mode === "screen" ? "screen" : "paper"} hint={run.mode === "screen" ? "typing + gaze" : "quiet allowed"} />
            </div>
          </Panel>
        </div>

        {/* Right rail */}
        <div className="grid content-start gap-3">
          <Panel
            title="Alerts"
            right={
              nextAlert != null ? (
                <button onClick={() => jumpTo(nextAlert)} className="text-[10px] font-medium text-primary hover:underline">
                  next alert →
                </button>
              ) : (
                <span className="text-[10px] text-muted-foreground">watching</span>
              )
            }
          >
            {!latest ? (
              <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-4 text-center">
                <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-primary">
                  <Bell className="h-4 w-4" />
                </span>
                <p className="mt-2 text-xs font-medium">No alerts yet</p>
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                  FocusTrack is watching the trend, not scoring every minute. An alert appears only when the next
                  5–10 minutes look at risk.
                </p>
              </div>
            ) : (
              <div className="thin-scroll grid max-h-[520px] gap-3 overflow-y-auto pr-1">
                {[...alerts].reverse().slice(0, 4).map((a) => (
                  <AlertCard key={a.id} alert={a} science={science} threshold={threshold} onRespond={respond} />
                ))}
              </div>
            )}
          </Panel>

          <Panel title="How this alert was made">
            <div className="grid gap-2 text-[11px]">
              <div className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[#2A6FDB]/10 font-mono text-[9px] text-[#2A6FDB]">C1</span>
                <p className="text-muted-foreground">Interaction state and transitions establish the baseline rhythm.</p>
              </div>
              <div className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[#1E8E5A]/10 font-mono text-[9px] text-[#1E8E5A]">C2</span>
                <p className="text-muted-foreground">Room conditions add a penalty only when they leave your comfort band.</p>
              </div>
              <div className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[#D9711C]/10 font-mono text-[9px] text-[#D9711C]">C3</span>
                <p className="text-muted-foreground">Gaze and phone cues separate attention from mere inactivity.</p>
              </div>
              <div className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/10 font-mono text-[9px] text-primary">C4</span>
                <p className="text-muted-foreground">The fused model forecasts the drop and ranks the factors behind it.</p>
              </div>
            </div>
          </Panel>

          {ended && (
            <Button size="lg" onClick={() => { setPlaying(false); finish(); router.push("/demo/outcome") }}>
              <Sparkles className="h-4 w-4" /> See your session outcomes
            </Button>
          )}
        </div>
      </div>
    </DemoShell>
  )
}
