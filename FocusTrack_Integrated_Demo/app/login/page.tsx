"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Activity, ArrowRight, FlaskConical, Lock, Upload, UserPlus } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { studentStore } from "@/lib/demo/students"
import type { Student } from "@/lib/demo/types"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input, Label, Select } from "@/components/ui/input"

export default function LoginPage() {
  const router = useRouter()
  const { student, setStudent, isLoading } = useAuth()
  const [students, setStudents] = useState<Student[]>([])
  const [mode, setMode] = useState<"login" | "register">("login")
  const [error, setError] = useState("")
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState("")
  const [form, setForm] = useState({
    name: "",
    age: "21",
    gender: "female" as "female" | "male",
    learningType: "screen" as "screen" | "non-screen",
  })

  useEffect(() => {
    setStudents(studentStore.list())
  }, [])

  useEffect(() => {
    if (!isLoading && student) router.replace("/demo/session")
  }, [student, isLoading, router])

  const enter = (s: Student) => {
    setStudent(s)
    router.push("/demo/session")
  }

  const register = () => {
    if (!form.name.trim()) {
      setError("Please add a name.")
      return
    }
    const s = studentStore.create({
      name: form.name.trim(),
      age: Number(form.age) || 21,
      gender: form.gender,
      learningType: form.learningType,
      university: null,
      faculty: null,
      degree: null,
    })
    enter(s)
  }

  const importProfile = () => {
    try {
      const s = studentStore.importJson(importText)
      setStudents(studentStore.list())
      setShowImport(false)
      setImportText("")
      enter(s)
    } catch {
      setError("That does not look like a FocusTrack profile. Paste the exported profile JSON.")
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-5 py-10">
      <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="animate-rise">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
              <Activity className="h-5 w-5 text-primary" />
            </span>
            <div>
              <p className="text-sm font-semibold tracking-tight">FocusTrack</p>
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Integrated experience</p>
            </div>
          </div>

          <h1 className="max-w-xl text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
            One learner.
            <br />
            Three signals.
            <br />
            <span className="text-primary">One calm decision.</span>
          </h1>
          <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground">
            This is FocusTrack after integration: behaviour, environment and vision feed one model that
            warns a learner <em>before</em> focus drops, explains why, and learns from their feedback.
          </p>

          <div className="mt-7 grid max-w-lg gap-2.5">
            {[
              ["Multimodal by design", "Typing rhythm, room conditions and gaze — no video or raw keystrokes stored."],
              ["Early, not after the fact", "A 5–10 minute forecast, not a scoreboard at the end of the session."],
              ["Personal and explainable", "Every alert says why, offers one counterfactual, and moves with your feedback."],
            ].map(([title, body]) => (
              <div key={title} className="flex gap-3 rounded-2xl border border-border bg-white/70 px-4 py-3">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-foreground">{title}.</span> {body}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <span className="rounded-full border border-border px-2.5 py-1">Simulated learner</span>
            <span className="rounded-full border border-border px-2.5 py-1">Runs on this device</span>
            <span className="rounded-full border border-border px-2.5 py-1">No research data is written</span>
          </div>
        </section>

        <Card className="animate-rise p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Sign in to a study profile</h2>
              <p className="text-xs text-muted-foreground">Demo mode · three sample profiles, or import your own.</p>
            </div>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-primary">
              <Lock className="h-4 w-4" />
            </span>
          </div>

          <div className="mb-4 flex gap-1 rounded-xl bg-muted p-1">
            <button
              onClick={() => { setMode("login"); setError("") }}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${mode === "login" ? "bg-white text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              Existing profile
            </button>
            <button
              onClick={() => { setMode("register"); setError("") }}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${mode === "register" ? "bg-white text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              New profile
            </button>
          </div>

          {error && <p className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

          {mode === "login" ? (
            <div className="grid gap-2">
              {students.map((s) => (
                <button
                  key={s.id}
                  onClick={() => enter(s)}
                  className="group flex items-center gap-3 rounded-xl border border-border bg-white px-3 py-3 text-left transition-colors hover:border-primary/30 hover:bg-secondary/40"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-primary">
                    {s.name.slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{s.name}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      Age {s.age} · {s.learningType === "non-screen" ? "paper learner" : "screen learner"} · {s.university ?? "Independent"}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </button>
              ))}

              <div className="mt-2 border-t border-border pt-3">
                {!showImport ? (
                  <button onClick={() => setShowImport(true)} className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground">
                    <Upload className="h-3.5 w-3.5" /> Bring in a profile from the data-collection app
                  </button>
                ) : (
                  <div className="grid gap-2">
                    <Label>Paste the profile JSON</Label>
                    <textarea
                      value={importText}
                      onChange={(e) => setImportText(e.target.value)}
                      rows={4}
                      placeholder='{"name":"...","age":22,"gender":"female","learningType":"screen"}'
                      className="w-full rounded-xl border border-input bg-white p-2.5 font-mono text-[11px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={importProfile}>Import & continue</Button>
                      <Button size="sm" variant="ghost" onClick={() => setShowImport(false)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Your name" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Age</Label>
                  <Input type="number" min={16} max={80} value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Gender</Label>
                  <Select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value as "female" | "male" })}>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                  </Select>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Usual learning type</Label>
                <Select value={form.learningType} onChange={(e) => setForm({ ...form, learningType: e.target.value as "screen" | "non-screen" })}>
                  <option value="screen">Mostly on screen</option>
                  <option value="non-screen">Mostly paper / handwriting</option>
                </Select>
              </div>
              <Button size="lg" onClick={register} className="mt-1">
                <UserPlus className="h-4 w-4" /> Create profile & continue
              </Button>
            </div>
          )}

          <p className="mt-4 flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
            <FlaskConical className="mt-0.5 h-3 w-3 shrink-0" />
            Profiles are stored in this browser. Sessions and feedback stay in a separate demo store, never in the research database.
          </p>
          <button
            type="button"
            onClick={() => {
              try {
                window.localStorage.removeItem("ft_demo_students_v1")
                window.localStorage.removeItem("ft_demo_history_v1")
                window.localStorage.removeItem("ft_demo_student")
                window.sessionStorage.removeItem("ft_demo_active_run_v1")
              } catch {
                /* storage unavailable */
              }
              setStudents(studentStore.list())
              setMode("login")
              setError("")
            }}
            className="mt-2 text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Reset demo data
          </button>
        </Card>
      </div>
    </main>
  )
}
