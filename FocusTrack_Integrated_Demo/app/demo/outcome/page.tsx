"use client"

import { useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  BrainCircuit,
  Eye,
  FlaskConical,
  History,
  Keyboard,
  Thermometer,
  TrendingUp,
} from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { useDemo } from "@/hooks/use-demo"
import { getHistory } from "@/lib/demo/outcome"
import { EVIDENCE, HEADLINE } from "@/lib/demo/evidence"
import { TASK_LABELS } from "@/lib/focus/types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/input"
import { DemoShell, Metric, Panel } from "@/components/demo/shell"
import { SessionTimeline } from "@/components/demo/session-timeline"
import { StateRibbon } from "@/components/demo/state-ribbon"

export default function OutcomePage() {
  const { student, isLoading } = useAuth()
  const { run, alerts, threshold, summary, science, setScience, finish, restoring } = useDemo()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !student) router.replace("/login")
  }, [student, isLoading, router])

  useEffect(() => {
    if (!isLoading && !restoring && student && !run) router.replace("/demo/session")
  }, [student, isLoading, restoring, run, router])

  const previous = useMemo(() => {
    if (!student) return []
    return getHistory(student).filter((r) => r.id !== run?.id)
  }, [student, run])

  if (isLoading || !student || !run || !summary) return null

  const prev = previous[previous.length - 1]
  const delta = prev ? summary.avgFocus - prev.avgFocus : null
  const topState = summary.stateShares[0]
  const phonePct = Math.round(summary.phoneShare * 100)

  const insights = [
    {
      icon: Keyboard,
      color: "#2A6FDB",
      title: "Behaviour",
      body:
        summary.topReasons.length > 0
          ? `The strongest ${summary.topReasons.length > 1 ? "signals were" : "signal was"} ${summary.topReasons.slice(0, 2).join(" and ")}. Most of the session sat in “${topState?.label ?? "a steady state"}”.`
          : `Most of the session sat in “${topState?.label ?? "a steady state"}”, with ${summary.interruptions} state-based interruptions.`,
      tip: run.mode === "screen" ? "Keep one window open during the next session." : "Your quiet stretches were read as work, not distraction.",
    },
    {
      icon: Thermometer,
      color: "#1E8E5A",
      title: "Environment",
      body: `Average noise was ${summary.noise} dB and the room was ${summary.temp} °C. ${
        summary.noise > 45 ? "Noise sat above a comfortable study level for part of the session." : "Conditions stayed inside a comfortable band."
      }`,
      tip: summary.noise > 45 ? "Try a quieter place or headphones for the next session." : "This place worked well — keep it as your default.",
    },
    {
      icon: Eye,
      color: "#D9711C",
      title: "Vision",
      body:
        phonePct > 8
          ? `A phone was in view for about ${phonePct}% of the session, and the forecast picked up the attention shift before the dip.`
          : `A phone was rarely in view (${phonePct}%). Gaze and reading motion separated attention from inactivity.`,
      tip: phonePct > 8 ? "Keeping the phone out of frame is the easiest single change." : "Your visual attention matched your work — keep the setup.",
    },
  ]

  return (
    <DemoShell step={3}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">Step 3 · outcomes</p>
            <Badge tone="plum">{TASK_LABELS[run.config.task]}</Badge>
            <Badge>{run.config.minutes} min</Badge>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Session outcomes</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{summary.hero}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push("/demo/history")}>
            <History className="h-4 w-4" /> Progress
          </Button>
          <Button
            onClick={() => {
              finish()
              router.push("/demo/feedback")
            }}
          >
            Give feedback <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Average focus" value={summary.avgFocus} hint="0–100, fused model" />
        <Metric label="Best window" value={summary.bestWindow} hint="5-minute peak" />
        <Metric label="Interruptions" value={summary.interruptions} hint="state changes" />
        <Metric label="Alerts raised" value={summary.alerts} hint={`${summary.alertsActed} marked helpful`} />
        <Metric label="Forecast hits" value={`${summary.hits}/${alerts.length}`} hint="drop followed within 4–10 min" />
        <Metric
          label="vs last session"
          value={delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta}`}
          hint={prev ? `${prev.avgFocus} previously` : "no earlier run"}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_0.6fr]">
        <Panel title="Focus, risk and the moments that mattered" right={<span className="text-[10px] text-muted-foreground">full session</span>}>
          <SessionTimeline run={run} cursor={run.frames.length - 1} alerts={alerts} threshold={threshold} />
          <div className="mt-3">
            <StateRibbon run={run} cursor={run.frames.length - 1} />
            {run.mode === "non-screen" && (summary.stateShares[0]?.share ?? 0) > 0.8 && (
              <p className="mt-2 rounded-lg bg-emerald-50/60 px-2.5 py-1.5 text-[10px] leading-relaxed text-emerald-800">
                A paper session often looks like a single “Idle / away” interaction state. That is expected — attention
                is estimated from gaze and reading motion, not from activity volume.
              </p>
            )}
          </div>
        </Panel>

        <div className="grid content-start gap-3">
          <Panel title="Where the time went">
            <div className="grid gap-2">
              {summary.stateShares.slice(0, 4).map((s) => (
                <div key={s.label}>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground">{s.label}</span>
                    <span className="font-mono">{Math.round(s.share * 100)}%</span>
                  </div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary/70" style={{ width: `${s.share * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Self-reports in this session">
            {run.probes.length ? (
              <div className="grid gap-1.5">
                {run.probes.map((p) => (
                  <div key={p.t} className="flex items-center justify-between rounded-lg bg-muted/60 px-2.5 py-1.5 text-[11px]">
                    <span className="text-muted-foreground">minute {p.t}</span>
                    <span className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <i key={n} className={`h-1.5 w-3 rounded-full ${n <= p.rating ? (p.drop ? "bg-[#b45454]" : "bg-emerald-500") : "bg-border"}`} />
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No probes were answered in this session.</p>
            )}
          </Panel>
        </div>
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold">What we noticed</h2>
      <div className="grid gap-3 md:grid-cols-3">
        {insights.map((it) => {
          const Icon = it.icon
          return (
            <div key={it.title} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${it.color}16`, color: it.color }}>
                  <Icon className="h-4 w-4" />
                </span>
                <p className="text-xs font-semibold">{it.title}</p>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{it.body}</p>
              <p className="mt-2 rounded-lg bg-muted/60 px-2.5 py-1.5 text-[10px] leading-relaxed">
                <span className="font-semibold">Try: </span>
                {it.tip}
              </p>
            </div>
          )
        })}
      </div>

      <Panel
        className="mt-4"
        title="Why this session means something"
        right={
          <button onClick={() => setScience(!science)} className="flex items-center gap-1 text-[10px] font-medium text-primary hover:underline">
            <FlaskConical className="h-3 w-3" /> {science ? "hide detail" : "show the science"}
          </button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {EVIDENCE.map((e) => (
            <div key={e.label} className="rounded-xl border border-border bg-muted/30 p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{e.label}</p>
              <p className="mt-1 font-mono text-lg font-semibold leading-none">{e.value}</p>
              <p className="mt-1 text-[9px] text-muted-foreground">{e.meta}</p>
              {science && <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">{e.note}</p>}
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-secondary/50 px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <BrainCircuit className="h-3.5 w-3.5 text-primary" />
            What you just saw is the integrated version of the four components: states, environment, vision and forecast.
          </p>
          <Button size="sm" variant="outline" onClick={() => router.push("/demo/science")}>
            <FlaskConical className="h-3.5 w-3.5" /> Full evidence
          </Button>
        </div>
        <p className="mt-2 text-[9px] leading-relaxed text-muted-foreground">
          Evidence from the research study (real pilot n = {HEADLINE.realSessions}; simulated study n = {HEADLINE.simulatedSessions}).
          The live session itself is a simulated learner, scored by the research models — the limitations are on the evidence page.
        </p>
      </Panel>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-white px-4 py-3 text-[11px] text-muted-foreground">
          <TrendingUp className="h-4 w-4 text-emerald-600" /> Compare with your own previous sessions.
        </div>
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-white px-4 py-3 text-[11px] text-muted-foreground">
          <BarChart3 className="h-4 w-4 text-primary" /> Outcomes come from the same model that raised the alerts.
        </div>
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-white px-4 py-3 text-[11px] text-muted-foreground">
          <BookOpen className="h-4 w-4 text-[#D9711C]" /> Paper sessions are judged differently from screen sessions.
        </div>
      </div>
    </DemoShell>
  )
}
