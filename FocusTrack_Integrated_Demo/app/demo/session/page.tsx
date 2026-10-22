"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  BookOpen,
  CheckCircle2,
  Code2,
  Eye,
  FileText,
  Keyboard,
  Loader2,
  MapPin,
  Pencil,
  Play,
  ShieldCheck,
  Thermometer,
  Video,
} from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { useDemo } from "@/hooks/use-demo"
import type { Place, SessionConfig } from "@/lib/demo/types"
import type { LiveTask } from "@/lib/focus/types"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Segmented, Toggle } from "@/components/ui/segmented"
import { DemoShell, Panel } from "@/components/demo/shell"

const TASKS: { value: LiveTask; label: string; mode: "screen" | "non-screen"; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "coding", label: "Coding", mode: "screen", icon: Code2 },
  { value: "writing", label: "Writing on laptop", mode: "screen", icon: FileText },
  { value: "assignment", label: "Assignment work", mode: "screen", icon: Pencil },
  { value: "zoom", label: "Online lecture", mode: "screen", icon: Video },
  { value: "reading", label: "Reading printed notes", mode: "non-screen", icon: BookOpen },
  { value: "handwriting", label: "Writing by hand", mode: "non-screen", icon: Pencil },
]

const PLACES: { value: Place; label: string }[] = [
  { value: "home", label: "Home" },
  { value: "library", label: "Library" },
  { value: "campus", label: "Campus" },
]

export default function SessionSetupPage() {
  const { student, isLoading } = useAuth()
  const { start, preparing, run } = useDemo()
  const router = useRouter()

  const [task, setTask] = useState<LiveTask>("coding")
  const [place, setPlace] = useState<Place>("library")
  const [minutes, setMinutes] = useState(50)
  const [c2, setC2] = useState(true)
  const [c3, setC3] = useState(true)
  const [consent, setConsent] = useState(true)
  const fromHistory = useRef(false)

  useEffect(() => {
    if (!isLoading && !student) router.replace("/login")
  }, [student, isLoading, router])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get("task") as LiveTask | null
    const p = params.get("place") as Place | null
    if (t && TASKS.some((x) => x.value === t)) setTask(t)
    if (p && PLACES.some((x) => x.value === p)) setPlace(p)
    if (t || p) fromHistory.current = true
  }, [])

  useEffect(() => {
    if (fromHistory.current) return
    if (student?.learningType === "non-screen") setTask("reading")
  }, [student?.learningType])

  const mode = TASKS.find((t) => t.value === task)?.mode ?? "screen"

  const config: SessionConfig = useMemo(
    () => ({ task, place, minutes, streams: { c2, c3 } }),
    [task, place, minutes, c2, c3],
  )

  const begin = async () => {
    await start(config)
    router.push("/demo/live")
  }

  if (isLoading || !student) return null

  return (
    <DemoShell step={1}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">Step 1 · start</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Set up a focus session</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Welcome back, {student.name.split(" ")[0]}. Pick what you are working on; the demo plays a full session in about 90 seconds.
          </p>
        </div>
        <span className="rounded-full border border-border bg-white px-3 py-1.5 text-[10px] text-muted-foreground">
          {mode === "screen" ? "Screen session" : "Paper session"} · {minutes} min planned
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
        <div className="grid gap-4">
          <Panel title="What are you working on?">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {TASKS.map((t) => {
                const Icon = t.icon
                const active = task === t.value
                return (
                  <button
                    key={t.value}
                    onClick={() => setTask(t.value)}
                    className={`flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-colors ${
                      active ? "border-primary/40 bg-secondary/60" : "border-border bg-white hover:bg-muted/60"
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${active ? "text-primary" : "text-muted-foreground"}`} />
                    <span className="text-xs font-medium leading-tight">{t.label}</span>
                    <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{t.mode}</span>
                  </button>
                )
              })}
            </div>
          </Panel>

          <div className="grid gap-4 sm:grid-cols-2">
            <Panel title="Where are you studying?">
              <Segmented value={place} onChange={setPlace} options={PLACES} className="w-full" />
              <p className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <MapPin className="h-3 w-3" /> The environment model uses simulated sensor data for this place.
              </p>
            </Panel>

            <Panel title="Planned duration">
              <div className="flex gap-2">
                {[25, 50].map((m) => (
                  <button
                    key={m}
                    onClick={() => setMinutes(m)}
                    className={`flex-1 rounded-xl border px-3 py-2 text-left ${
                      minutes === m ? "border-primary/40 bg-secondary/60" : "border-border bg-white"
                    }`}
                  >
                    <span className="block font-mono text-lg font-semibold">{m}</span>
                    <span className="block text-[10px] text-muted-foreground">minutes</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">
                On screen, one minute of the session = about 1.8 seconds.
              </p>
            </Panel>
          </div>

          <Panel title="Data sources" right={<span className="text-[10px] text-muted-foreground">all three are integrated in this demo</span>}>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-border bg-white p-3">
                <div className="flex items-center gap-2">
                  <Keyboard className="h-4 w-4 text-[#2A6FDB]" />
                  <span className="text-xs font-semibold">Behaviour</span>
                  <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-emerald-600" />
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">C1 · typing rhythm, idle, app switching</p>
              </div>
              <div className={`rounded-xl border p-3 ${c2 ? "border-border bg-white" : "border-dashed border-border bg-muted/40"}`}>
                <div className="flex items-center gap-2">
                  <Thermometer className="h-4 w-4 text-[#1E8E5A]" />
                  <span className="text-xs font-semibold">Environment</span>
                  <CheckCircle2 className={`ml-auto h-3.5 w-3.5 ${c2 ? "text-emerald-600" : "text-muted-foreground/40"}`} />
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">C2 · noise, temperature, light, motion</p>
              </div>
              <div className={`rounded-xl border p-3 ${c3 ? "border-border bg-white" : "border-dashed border-border bg-muted/40"}`}>
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-[#D9711C]" />
                  <span className="text-xs font-semibold">Vision</span>
                  <CheckCircle2 className={`ml-auto h-3.5 w-3.5 ${c3 ? "text-emerald-600" : "text-muted-foreground/40"}`} />
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">C3 · gaze zone, phone, reading motion</p>
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Toggle checked={c2} onChange={setC2} label="Use the environment stream" hint="Turn off to show the decision-level fallback." />
              <Toggle checked={c3} onChange={setC3} label="Use the vision stream" hint="Turn off to show how the model degrades safely." />
            </div>
          </Panel>
        </div>

        <div className="grid content-start gap-4">
          <Card className="overflow-hidden">
            <div className="bg-[#2a1840] px-5 py-4 text-[#f6f1e8]">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#c4b0d6]">Ready to begin</p>
              <p className="mt-1 text-lg font-semibold">
                {TASKS.find((t) => t.value === task)?.label}
              </p>
              <p className="text-xs text-[#c4b0d6]">
                {PLACES.find((p) => p.value === place)?.label} · {minutes} minutes
              </p>
            </div>
            <div className="grid gap-3 p-5">
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  ["C1", "on"],
                  ["C2", c2 ? "on" : "off"],
                  ["C3", c3 ? "on" : "off"],
                ].map(([label, state]) => (
                  <div key={label} className="rounded-xl bg-muted px-2 py-2">
                    <p className="font-mono text-xs font-semibold">{label}</p>
                    <p className={`text-[10px] ${state === "on" ? "text-emerald-700" : "text-muted-foreground"}`}>{state}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-border bg-muted/40 p-3">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold">
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Privacy by design
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                  Only derived features are recorded: key timing and a Backspace flag, never key content. Vision sends
                  gaze zone and phone presence, never frames. No video leaves this browser.
                </p>
              </div>

              <Toggle
                checked={consent}
                onChange={setConsent}
                label="I consent to this simulated session"
                hint="For the demo, no real participant data is collected."
              />

              <Button size="lg" onClick={begin} disabled={!consent || preparing} className="w-full">
                {preparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {preparing ? "Preparing the session…" : "Start focus session"}
              </Button>

              <p className="text-center text-[10px] text-muted-foreground">
                {run ? "A previous run is in progress. Starting again replaces it." : "The session can be paused, scrubbed and restarted at any time."}
              </p>
            </div>
          </Card>

          <Panel title="What you will see">
            <ol className="grid gap-2 text-[11px] text-muted-foreground">
              {[
                "A live focus score and a 5–10 minute drop forecast.",
                "Alerts with a reason and one thing to try — accept or dismiss them.",
                "Session outcomes: states, interruptions and what helped.",
                "A short feedback loop that tunes your own alert level.",
              ].map((t, i) => (
                <li key={t} className="flex gap-2">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-secondary text-[9px] font-semibold text-primary">{i + 1}</span>
                  {t}
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </DemoShell>
  )
}
