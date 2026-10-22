"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, Bell, Check, CheckCircle2, FlaskConical, History, MessageSquareText, RotateCcw } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { useDemo } from "@/hooks/use-demo"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/input"
import { DemoShell, Metric, Panel } from "@/components/demo/shell"
import type { Feedback } from "@/lib/demo/types"

const RATING_LABELS: Record<number, string> = {
  1: "Fully distracted",
  2: "Mostly distracted",
  3: "Partly focused",
  4: "Mostly focused",
  5: "Deep focus",
}

function Scale({ value, onChange, low, high }: { value: number; onChange: (v: number) => void; low: string; high: string }) {
  return (
    <div>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`h-9 flex-1 rounded-lg border text-xs font-semibold transition-colors ${
              value === n ? "border-primary bg-primary text-white" : "border-border bg-white text-muted-foreground hover:border-primary/40"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  )
}

export default function FeedbackPage() {
  const { student, isLoading } = useAuth()
  const { run, alerts, threshold, summary, feedbackDone, submitFeedback, reset, restoring } = useDemo()
  const router = useRouter()

  const [rating, setRating] = useState(3)
  const [accurate, setAccurate] = useState(3)
  const [control, setControl] = useState(4)
  const [wouldUse, setWouldUse] = useState(4)
  const [comment, setComment] = useState("")
  const [consent, setConsent] = useState(true)
  const [alertHelpful, setAlertHelpful] = useState<Record<string, boolean>>({})
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (!isLoading && !student) router.replace("/login")
  }, [student, isLoading, router])

  useEffect(() => {
    if (!isLoading && !restoring && student && !run && !feedbackDone) router.replace("/demo/session")
  }, [student, isLoading, restoring, run, feedbackDone, router])

  useEffect(() => {
    if (alerts.length) {
      const initial: Record<string, boolean> = {}
      for (const a of alerts) {
        if (a.response === "helpful") initial[a.id] = true
        else if (a.response === "not-now") initial[a.id] = false
      }
      setAlertHelpful(initial)
    }
  }, [alerts])

  const answered = useMemo(() => Object.keys(alertHelpful).length, [alertHelpful])

  if (isLoading || !student) return null

  if (feedbackDone || submitted) {
    return (
      <DemoShell step={4}>
        <div className="mx-auto max-w-2xl">
          <div className="animate-rise rounded-3xl border border-border bg-white p-8 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-7 w-7" />
            </span>
            <h1 className="mt-4 text-2xl font-bold tracking-tight">Feedback saved</h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              Thank you. This closes the loop: your responses tune your alert level, and your ratings are the
              labels the next model iteration learns from.
            </p>

            <div className="mx-auto mt-5 grid max-w-md grid-cols-3 gap-2">
              <Metric label="Session rating" value={`${rating}/5`} hint={RATING_LABELS[rating]} />
              <Metric label="Alerts rated" value={`${answered}/${alerts.length}`} />
              <Metric label="Alert level" value={`${Math.round(threshold * 100)}%`} hint="personal" />
            </div>

            <div className="mt-5 rounded-xl bg-secondary/50 px-4 py-3 text-left text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">What happens next.</span> In phase 1 the system learns your
              pattern silently. In phase 2 this feedback becomes a within-subject study: does a personal alert policy
              beat a fixed one? The demo keeps your answers in this browser — nothing is written to the research database.
            </div>

            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Button onClick={() => router.push("/demo/history")}>
                <History className="h-4 w-4" /> See your progress
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  reset()
                  router.push("/demo/session")
                }}
              >
                <RotateCcw className="h-4 w-4" /> Start another session
              </Button>
              <Button variant="ghost" onClick={() => router.push("/demo/science")}>
                <FlaskConical className="h-4 w-4" /> The evidence
              </Button>
            </div>
          </div>
        </div>
      </DemoShell>
    )
  }

  const submit = () => {
    if (!summary) return
    const fb: Feedback = { rating, alertHelpful, accurate, control, wouldUse, comment, consent }
    submitFeedback(fb)
    setSubmitted(true)
  }

  return (
    <DemoShell step={4}>
      <div className="mb-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">Step 4 · feedback</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">How did that feel?</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Two minutes of feedback is part of the research, not a survey afterthought. It tunes your alerts and becomes
          the label for the next model iteration.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="grid gap-3">
          <Panel title="Session rating">
            <p className="mb-2 text-xs text-muted-foreground">
              Overall, how focused were you during this session? This is the same 1–5 scale used in data collection.
            </p>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setRating(n)}
                  className={`flex-1 rounded-xl border px-2 py-3 text-center transition-colors ${
                    rating === n ? "border-primary bg-secondary" : "border-border bg-white hover:border-primary/30"
                  }`}
                >
                  <span className={`block font-mono text-lg font-semibold ${rating === n ? "text-primary" : ""}`}>{n}</span>
                  <span className="mt-0.5 block text-[9px] leading-tight text-muted-foreground">{RATING_LABELS[n]}</span>
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Alerts" right={<Badge>{alerts.length} raised</Badge>}>
            {alerts.length === 0 ? (
              <p className="text-xs text-muted-foreground">No alerts were raised in this session, so there is nothing to rate.</p>
            ) : (
              <div className="grid gap-2">
                {alerts.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-white px-3 py-2">
                    <Bell className="h-3.5 w-3.5 text-[#b0834a]" />
                    <span className="text-[11px] font-medium">Minute {a.t}</span>
                    <span className="text-[10px] text-muted-foreground">risk {Math.round(a.risk * 100)}% · {a.reasons[0] ?? "mixed signals"}</span>
                    <div className="ml-auto flex overflow-hidden rounded-lg border border-border">
                      <button
                        onClick={() => setAlertHelpful((h) => ({ ...h, [a.id]: true }))}
                        className={`px-2.5 py-1 text-[10px] font-semibold ${alertHelpful[a.id] ? "bg-emerald-50 text-emerald-700" : "bg-white text-muted-foreground"}`}
                      >
                        Useful
                      </button>
                      <button
                        onClick={() => setAlertHelpful((h) => ({ ...h, [a.id]: false }))}
                        className={`px-2.5 py-1 text-[10px] font-semibold ${alertHelpful[a.id] === false ? "bg-muted text-foreground" : "bg-white text-muted-foreground"}`}
                      >
                        Not useful
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="The experience">
            <div className="grid gap-4">
              <div>
                <p className="mb-1.5 text-xs">The alerts were accurate.</p>
                <Scale value={accurate} onChange={setAccurate} low="Strongly disagree" high="Strongly agree" />
              </div>
              <div>
                <p className="mb-1.5 text-xs">I felt in control of the system.</p>
                <Scale value={control} onChange={setControl} low="Strongly disagree" high="Strongly agree" />
              </div>
              <div>
                <p className="mb-1.5 text-xs">I would use this while studying.</p>
                <Scale value={wouldUse} onChange={setWouldUse} low="Strongly disagree" high="Strongly agree" />
              </div>
            </div>
          </Panel>

          <Panel title="Anything else?">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              placeholder="What helped, what got in the way, what you would change…"
              className="w-full rounded-xl border border-input bg-white p-3 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            />
          </Panel>
        </div>

        <div className="grid content-start gap-3">
          <Panel title="What your feedback does">
            <div className="grid gap-2.5 text-[11px]">
              <div className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/10 font-mono text-[9px] text-primary">1</span>
                <p className="text-muted-foreground">A “Helpful” alert lowers your alert level; “Not now” raises it. You already moved it to <span className="font-mono font-semibold text-foreground">{Math.round(threshold * 100)}%</span>.</p>
              </div>
              <div className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/10 font-mono text-[9px] text-primary">2</span>
                <p className="text-muted-foreground">Your 1–5 rating is the kind of label the model is trained on. It is noisy, so it is aggregated per session.</p>
              </div>
              <div className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/10 font-mono text-[9px] text-primary">3</span>
                <p className="text-muted-foreground">The next iteration compares a fixed policy with your personal one, within the same learner.</p>
              </div>
            </div>
          </Panel>

          <Panel title="Consent">
            <button
              onClick={() => setConsent(!consent)}
              className="flex w-full items-start gap-2.5 rounded-xl border border-border bg-white p-3 text-left"
            >
              <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${consent ? "border-primary bg-primary text-white" : "border-border"}`}>
                {consent && <Check className="h-3 w-3" />}
              </span>
              <span className="text-[10px] leading-relaxed text-muted-foreground">
                I agree to store this feedback in the demo. It is kept in this browser and is never written to the
                research database.
              </span>
            </button>
          </Panel>

          <Panel title="This session at a glance">
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Focus" value={summary?.avgFocus ?? "—"} />
              <Metric label="Alerts" value={alerts.length} />
              <Metric label="Forecast hits" value={summary ? `${summary.hits}/${alerts.length}` : "—"} />
              <Metric label="Interruptions" value={summary?.interruptions ?? "—"} />
            </div>
          </Panel>

          <Button size="lg" onClick={submit} disabled={!consent}>
            <MessageSquareText className="h-4 w-4" /> Submit feedback <ArrowRight className="h-4 w-4" />
          </Button>
          <p className="text-center text-[10px] text-muted-foreground">
            This completes the loop: sense → forecast → act → reflect.
          </p>
        </div>
      </div>
    </DemoShell>
  )
}
