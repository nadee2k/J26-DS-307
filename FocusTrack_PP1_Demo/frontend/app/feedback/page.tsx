"use client"

// Prototype feedback for PP1: the standard 10-item System Usability Scale (Brooke, 1996) plus open questions,
// per component workbench. Responses are stored like any other record (demo store or Supabase) and summarised
// here so the team can report real user feedback on the prototype.

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Download } from "lucide-react"
import { AppShell } from "@/components/layout/app-shell"
import { Metric, Panel } from "@/components/workbench/workbench-shell"
import { useAuth } from "@/hooks/use-auth"
import { getSupabase } from "@/lib/supabase"

const SUS = [
  "I think that I would like to use this system frequently.",
  "I found the system unnecessarily complex.",
  "I thought the system was easy to use.",
  "I think that I would need the support of a technical person to be able to use this system.",
  "I found the various functions in this system were well integrated.",
  "I thought there was too much inconsistency in this system.",
  "I would imagine that most people would learn to use this system very quickly.",
  "I found the system very cumbersome to use.",
  "I felt very confident using the system.",
  "I needed to learn a lot of things before I could get going with this system.",
]
const PARTS = ["Shared data collection", "C1 Behaviour", "C2 Environment", "C3 Vision", "C4 Temporal & XAI"] as const
type Part = (typeof PARTS)[number]
interface Response { id?: string; part: Part; role: string; sus: number[]; liked: string; change: string; privacy: string; created_at?: string }

/** SUS score 0–100: odd items (positive) contribute score − 1, even items (negative) 5 − score; sum × 2.5. */
const susScore = (a: number[]) => a.reduce((s, v, i) => s + (i % 2 === 0 ? v - 1 : 5 - v), 0) * 2.5

export default function FeedbackPage() {
  const { student, isLoading } = useAuth()
  const router = useRouter()
  const [part, setPart] = useState<Part>("C1 Behaviour")
  const [role, setRole] = useState("Undergraduate student")
  const [answers, setAnswers] = useState<number[]>(Array(10).fill(0))
  const [liked, setLiked] = useState("")
  const [change, setChange] = useState("")
  const [privacy, setPrivacy] = useState("")
  const [rows, setRows] = useState<Response[]>([])
  const [saved, setSaved] = useState("")

  useEffect(() => { if (!isLoading && !student) router.push("/login") }, [student, isLoading, router])
  const load = async () => {
    const { data } = await getSupabase().from("prototype_feedback").select("*").order("created_at", { ascending: true })
    setRows(((data ?? []) as Record<string, unknown>[]).map((r) => ({ id: String(r.id), part: r.part as Part, role: String(r.role ?? ""), sus: r.sus as number[], liked: String(r.liked ?? ""), change: String(r.change ?? ""), privacy: String(r.privacy ?? ""), created_at: String(r.created_at) })))
  }
  useEffect(() => { load() }, [])

  const complete = answers.every((v) => v >= 1)
  const submit = async () => {
    if (!complete) return
    const { error } = await getSupabase().from("prototype_feedback").insert({ part, role, sus: answers, liked, change, privacy })
    if (error) { setSaved(`Could not save: ${error.message}`); return }
    setAnswers(Array(10).fill(0)); setLiked(""); setChange(""); setPrivacy("")
    setSaved("Thank you – response saved."); load()
  }
  const summary = useMemo(() => PARTS.map((p) => {
    const r = rows.filter((x) => x.part === p)
    const scores = r.map((x) => susScore(x.sus))
    return { part: p, n: r.length, mean: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null }
  }), [rows])
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ instrument: "System Usability Scale (Brooke, 1996) + open questions", responses: rows.map((r) => ({ ...r, susScore: susScore(r.sus) })) }, null, 2)], { type: "application/json" })
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "focustrack_prototype_feedback.json"; a.click()
  }

  if (isLoading || !student) return null
  return (
    <AppShell studentName={student.name}>
      <div className="flex flex-col gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8b6bb0]">PP1 · user feedback</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Prototype feedback</h1>
          <p className="mt-1 text-sm text-muted-foreground">Ask a tester to try one workbench for a few minutes, then fill this in together. System Usability Scale (10 items, 1 = strongly disagree … 5 = strongly agree) plus three open questions.</p>
        </div>

        <Panel title="New response">
          <div className="flex flex-wrap gap-3">
            <label className="grid gap-1 text-xs">Part tested
              <select className="rounded-lg border px-2 py-1.5 text-sm" value={part} onChange={(e) => setPart(e.target.value as Part)}>{PARTS.map((p) => <option key={p}>{p}</option>)}</select></label>
            <label className="grid gap-1 text-xs">Tester
              <select className="rounded-lg border px-2 py-1.5 text-sm" value={role} onChange={(e) => setRole(e.target.value)}>
                {["Undergraduate student", "Postgraduate student", "Lecturer / supervisor", "Other"].map((r) => <option key={r}>{r}</option>)}
              </select></label>
          </div>
          <div className="mt-3 grid gap-1.5">
            {SUS.map((q, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-1 odd:bg-[#f6f3ee]">
                <span className="text-sm">{i + 1}. {q}</span>
                <div className="flex gap-1">{[1, 2, 3, 4, 5].map((v) => (
                  <button key={v} type="button" onClick={() => setAnswers((a) => a.map((x, j) => (j === i ? v : x)))}
                    className={`h-7 w-7 rounded-md text-xs font-semibold ${answers[i] === v ? "bg-[#7b3fa0] text-white" : "border"}`}>{v}</button>
                ))}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            <textarea className="h-20 rounded-lg border p-2 text-sm" placeholder="What did you find useful?" value={liked} onChange={(e) => setLiked(e.target.value)} />
            <textarea className="h-20 rounded-lg border p-2 text-sm" placeholder="What should we change?" value={change} onChange={(e) => setChange(e.target.value)} />
            <textarea className="h-20 rounded-lg border p-2 text-sm" placeholder="Any privacy or comfort concerns?" value={privacy} onChange={(e) => setPrivacy(e.target.value)} />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button onClick={submit} disabled={!complete} className="rounded-xl bg-[#7b3fa0] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Save response</button>
            <span className="text-xs text-muted-foreground">{complete ? `SUS score for this response: ${susScore(answers).toFixed(1)}` : "Answer all 10 items"}</span>
            {saved && <span className="text-xs">{saved}</span>}
          </div>
        </Panel>

        <Panel title="Summary" right={<button onClick={exportJson} disabled={!rows.length} className="flex items-center gap-1 rounded-lg border px-2 py-1 text-xs disabled:opacity-50"><Download className="h-3.5 w-3.5" />Export</button>}>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {summary.map((s) => <Metric key={s.part} label={s.part} value={s.mean == null ? "–" : s.mean.toFixed(1)} hint={`${s.n} response${s.n === 1 ? "" : "s"} · SUS 0–100 (68 ≈ average)`} />)}
          </div>
          <div className="mt-3 grid gap-2">
            {rows.slice().reverse().slice(0, 12).map((r) => (
              <div key={r.id} className="rounded-lg border p-2 text-xs">
                <b>{r.part}</b> · {r.role} · SUS {susScore(r.sus).toFixed(1)}
                {r.liked && <p><span className="text-muted-foreground">Useful:</span> {r.liked}</p>}
                {r.change && <p><span className="text-muted-foreground">Change:</span> {r.change}</p>}
                {r.privacy && <p><span className="text-muted-foreground">Privacy:</span> {r.privacy}</p>}
              </div>
            ))}
            {!rows.length && <p className="text-sm text-muted-foreground">No responses yet.</p>}
          </div>
        </Panel>
      </div>
    </AppShell>
  )
}
