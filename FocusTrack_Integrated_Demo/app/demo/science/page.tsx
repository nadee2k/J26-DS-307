"use client"

import { useRouter } from "next/navigation"
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, FlaskConical, ShieldCheck } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { EVIDENCE, HEADLINE, INTEGRATION, LIMITS, OBJECTIVES } from "@/lib/demo/evidence"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/input"
import { DemoShell, Panel } from "@/components/demo/shell"

export default function SciencePage() {
  const { student } = useAuth()
  const router = useRouter()

  return (
    <DemoShell step={4}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">The evidence</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Why this is more than a focus timer</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            FocusTrack is four research components finally working as one loop. This page is the honest version: what
            the study shows, what the demo proves, and what is still open.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push("/demo/outcome")}>
            <ArrowLeft className="h-4 w-4" /> Back to outcomes
          </Button>
          {student && (
            <Button onClick={() => router.push("/demo/session")}>
              Try the demo <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <Panel title="The integration">
        <div className="grid gap-3 md:grid-cols-4">
          {INTEGRATION.map((c) => (
            <div key={c.n} className="relative rounded-2xl border border-border bg-white p-4">
              <div className="flex items-center justify-between">
                <span className="rounded-lg px-2 py-0.5 font-mono text-[10px] font-semibold" style={{ background: `${c.color}16`, color: c.color }}>
                  {c.short}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">C{c.n}</span>
              </div>
              <p className="mt-2 text-sm font-semibold">{c.name}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{c.what}</p>
              <p className="mt-2 border-t border-border pt-2 text-[10px] leading-relaxed text-muted-foreground">{c.why}</p>
              {c.n < 4 && <ArrowRight className="absolute -right-2.5 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-border md:block" />}
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-xl bg-secondary/50 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">The integrated loop:</span> login → start session → live alerts
          → session outcomes → feedback → a better personal model. Each stage consumes the stage before it; nothing is
          a mock-up.
        </div>
      </Panel>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {EVIDENCE.map((e) => (
          <div key={e.label} className="rounded-2xl border border-border bg-card p-4">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{e.label}</p>
            <p className="mt-1 font-mono text-xl font-semibold leading-none">{e.value}</p>
            <p className="mt-1 text-[9px] text-muted-foreground">{e.meta}</p>
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{e.note}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Panel title="Objectives, made visible">
          <div className="grid gap-1.5">
            {OBJECTIVES.map((o) => (
              <div key={o.id} className="flex gap-3 rounded-xl border border-border bg-white px-3 py-2">
                <span className="w-8 shrink-0 font-mono text-[10px] font-semibold text-primary">{o.id}</span>
                <div>
                  <p className="text-[11px] font-medium">{o.name}</p>
                  <p className="text-[10px] text-muted-foreground">{o.demo}</p>
                </div>
                <CheckCircle2 className="ml-auto mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="What the numbers mean">
          <div className="grid gap-2 text-[11px] leading-relaxed text-muted-foreground">
            <p>
              <span className="font-semibold text-foreground">Baseline vs proposed.</span> The conventional baseline
              aggregates raw activity counts. The proposed representation adds interaction states, transitions and context.
              The gain is modest overall ({HEADLINE.macroF1Proposed.toFixed(3)} vs {HEADLINE.macroF1Baseline.toFixed(3)})
              but concentrates where it matters.
            </p>
            <p>
              <span className="font-semibold text-foreground">The paper-session result.</span> On non-screen study the
              proposed model reaches {HEADLINE.nonScreenProposed.toFixed(3)} against {HEADLINE.nonScreenBaseline.toFixed(3)}.
              This is the core argument: a quiet reader is not a distracted user.
            </p>
            <p>
              <span className="font-semibold text-foreground">Unseen tasks.</span> Under a cross-context holdout the
              gap widens to {HEADLINE.crossContextProposed.toFixed(3)} vs {HEADLINE.crossContextBaseline.toFixed(3)} —
              the representation travels better when the context changes.
            </p>
            <p>
              <span className="font-semibold text-foreground">States.</span> The four interaction states are well
              separated on the real pilot (silhouette {HEADLINE.silhouette.toFixed(3)}), so transitions between them
              carry real information rather than noise.
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge>Real pilot: {HEADLINE.realSessions} sessions · {HEADLINE.realWindows} windows</Badge>
              <Badge>Simulated study: {HEADLINE.simulatedSessions} sessions</Badge>
              <Badge tone="plum">participant-level splits</Badge>
            </div>
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="What integration changes">
          <div className="grid gap-2">
            {[
              ["Before (PP1)", "Four standalone workbenches. Each component proved its own part; integration was future work."],
              ["After (this demo)", "One learner, one session, one loop. C1–C3 features feed C4 live, and the learner sees the result."],
              ["Why it matters", "The research contribution is the representation and the decision, not four disconnected models."],
            ].map(([t, b]) => (
              <div key={t} className="rounded-xl border border-border bg-white p-3">
                <p className="text-[11px] font-semibold">{t}</p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{b}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Honest limitations" right={<AlertTriangle className="h-4 w-4 text-[#b0834a]" />}>
          <ul className="grid gap-2">
            {LIMITS.map((l) => (
              <li key={l} className="flex gap-2 text-[11px] leading-relaxed text-muted-foreground">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#b0834a]" />
                {l}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-[#2a1840] px-5 py-4 text-[#f6f1e8]">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-[#e4d4f0]">
          <ShieldCheck className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">What the demo does not claim</p>
          <p className="text-[11px] text-[#c4b0d6]">
            The integrated model has not been validated end-to-end on real participants. The demo shows the product
            the research is building toward — with the evidence that each part works, and the gaps named openly.
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[10px]">
          <FlaskConical className="h-3 w-3" /> Research demo
        </span>
      </div>
    </DemoShell>
  )
}
