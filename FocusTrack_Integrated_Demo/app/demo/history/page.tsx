"use client"

import { useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, CalendarDays, FlaskConical, Lightbulb, Play, TrendingUp } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { getHistory, nextAction } from "@/lib/demo/outcome"
import { formatDate, mean } from "@/lib/utils"
import { TASK_LABELS } from "@/lib/focus/types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/input"
import { DemoShell, Metric, Panel } from "@/components/demo/shell"

function Trend({ values }: { values: number[] }) {
  const W = 720
  const H = 160
  const L = 30
  const R = 14
  const T = 14
  const B = 24
  const n = Math.max(values.length, 2)
  const X = (i: number) => L + (i / (n - 1)) * (W - L - R)
  const Y = (v: number) => T + (1 - v / 100) * (H - T - B)
  const path = values.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ")

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="#eee7dc" />
          <text x={L - 6} y={Y(v) + 3} fontSize="8" textAnchor="end" fill="#a294b0">{v}</text>
        </g>
      ))}
      <path d={path} fill="none" stroke="#7b3fa0" strokeWidth={2.4} strokeLinejoin="round" />
      {values.map((v, i) => (
        <circle key={i} cx={X(i)} cy={Y(v)} r={4} fill="#fff" stroke="#7b3fa0" strokeWidth={2}>
          <title>{v}</title>
        </circle>
      ))}
    </svg>
  )
}

export default function HistoryPage() {
  const { student, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !student) router.replace("/login")
  }, [student, isLoading, router])

  const history = useMemo(() => (student ? getHistory(student) : []), [student])
  const last = history.slice(-8)
  const avg = mean(history.map((r) => r.avgFocus))
  const best = history.reduce((a, r) => Math.max(a, r.avgFocus), 0)
  const alerts = history.reduce((a, r) => a + r.alerts, 0)
  const hits = history.reduce((a, r) => a + r.hits, 0)
  const action = nextAction(history)

  if (isLoading || !student) return null

  return (
    <DemoShell step={4}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">Progress</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Your focus over time</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The same learner, across sessions. Personalisation is the point: one session is a demo, a pattern is a product.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push("/demo/science")}>
            <FlaskConical className="h-4 w-4" /> Evidence
          </Button>
          <Button onClick={() => router.push("/demo/session")}>
            <Play className="h-4 w-4" /> New session
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Sessions" value={history.length} hint="including sample history" />
        <Metric label="Average focus" value={Math.round(avg)} hint="0–100 fused score" />
        <Metric label="Personal best" value={best} hint="best session average" />
        <Metric label="Alert precision" value={alerts ? `${hits}/${alerts}` : "—"} hint="followed by a reported dip" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_0.6fr]">
        <Panel title="Focus trend" right={<span className="flex items-center gap-1 text-[10px] text-muted-foreground"><TrendingUp className="h-3 w-3" /> last {last.length} sessions</span>}>
          <Trend values={last.map((r) => r.avgFocus)} />
          <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
            {last.map((r) => (
              <span key={r.id} className="w-full truncate text-center">{formatDate(r.createdAt).replace(/ \d{4}$/, "")}</span>
            ))}
          </div>
        </Panel>

        <div className="grid content-start gap-3">
          <Panel title="Next best action">
            <div className="flex gap-2.5">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                <Lightbulb className="h-4 w-4" />
              </span>
              <p className="text-xs leading-relaxed text-muted-foreground">{action}</p>
            </div>
          </Panel>

          <Panel title="What changes with more sessions">
            <ul className="grid gap-2 text-[11px] text-muted-foreground">
              <li className="flex gap-2"><i className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" /> Your alert level adapts to how you respond.</li>
              <li className="flex gap-2"><i className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" /> The comfort band becomes personal, not population-wide.</li>
              <li className="flex gap-2"><i className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" /> The outcome comparison uses your own baseline, not a stranger's.</li>
            </ul>
          </Panel>
        </div>
      </div>

      <Panel className="mt-4" title="Session log" right={<span className="text-[10px] text-muted-foreground">newest last</span>}>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sessions yet. Start one to populate this page.</p>
        ) : (
          <div className="grid gap-1.5">
            {[...history].reverse().map((r) => {
              const sample = r.id.startsWith("seed-")
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-white px-3 py-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <CalendarDays className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{TASK_LABELS[r.config.task]}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatDate(r.createdAt)} · {r.config.place} · {r.mode}
                      {sample && " · sample history"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{r.avgFocus}</span>
                    <span className="text-[9px] text-muted-foreground">focus</span>
                  </div>
                  <div className="hidden items-center gap-1 sm:flex">
                    {r.alerts > 0 ? <Badge tone="care">{r.alerts} alert{r.alerts > 1 ? "s" : ""}</Badge> : <Badge>no alerts</Badge>}
                    {r.feedback && <Badge tone="good">{r.feedback.rating}/5</Badge>}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => router.push(`/demo/session?task=${r.config.task}&place=${r.config.place}`)}>
                    repeat <ArrowRight className="h-3 w-3" />
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </Panel>

      <p className="mt-3 text-[10px] text-muted-foreground">
        The first four entries are deterministic sample history so the page is meaningful on a first visit. Completed
        demo sessions are added after feedback. Nothing here is uploaded.
      </p>
    </DemoShell>
  )
}
