"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Activity, UserPlus, LogIn } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { students } from "@/lib/api"
import { LEARNING_TYPE_OPTIONS } from "@/lib/constants"
import { GenderClipartPicker } from "@/components/features/student/gender-clipart-picker"
import { useAuth } from "@/hooks/use-auth"
import type { Student } from "@/types"

export default function LoginPage() {
  const router = useRouter()
  const { setStudent } = useAuth()
  const [mode, setMode] = useState<"login" | "register">("login")
  const [existingStudents, setExistingStudents] = useState<Student[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const [form, setForm] = useState({
    name: "",
    age: "",
    gender: "",
    university: "",
    faculty: "",
    degree: "",
    learningType: "",
  })

  useEffect(() => {
    students.list(1, 100).then((res) => setExistingStudents(res.items)).catch(() => {})
  }, [])

  const handleLogin = async () => {
    if (!selectedId) {
      setError("Please select a student")
      return
    }
    setLoading(true)
    setError("")
    try {
      const student = await students.get(selectedId)
      setStudent(student)
      router.push("/dashboard")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load student")
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async () => {
    if (!form.name || !form.age || !form.gender) {
      setError("Name, age, and gender are required")
      return
    }
    setLoading(true)
    setError("")
    try {
      const student = await students.create({
        name: form.name,
        age: parseInt(form.age),
        gender: form.gender as "female" | "male",
        university: form.university || null,
        faculty: form.faculty || null,
        degree: form.degree || null,
        learningType: form.learningType as "screen" | "non-screen" || null,
      })
      setStudent(student)
      router.push("/dashboard")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create student")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md border-[#eadfce] bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#efe6f4] ring-1 ring-[#eadfce]">
            <Activity className="h-5 w-5 text-[#7b3fa0]" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Focus Track</h1>
            <p className="text-xs text-muted-foreground">Student research collector</p>
          </div>
        </div>

        <div className="mb-4 flex gap-2">
          <button
            onClick={() => { setMode("login"); setError("") }}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              mode === "login"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            <LogIn className="mr-1.5 inline h-3.5 w-3.5" />
            Login
          </button>
          <button
            onClick={() => { setMode("register"); setError("") }}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              mode === "register"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            <UserPlus className="mr-1.5 inline h-3.5 w-3.5" />
            Register
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400 ring-1 ring-inset ring-red-500/20">
            {error}
          </div>
        )}

        {mode === "login" ? (
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label className="text-xs">Select Student</Label>
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Choose a student profile" />
                </SelectTrigger>
                <SelectContent>
                  {existingStudents.length === 0 ? (
                    <SelectItem value="none" disabled>No students registered</SelectItem>
                  ) : (
                    existingStudents.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} · {s.gender === "female" ? "Female" : "Male"} (Age {s.age})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <button
              onClick={handleLogin}
              disabled={loading || !selectedId}
              className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Loading..." : "Start Session"}
            </button>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">Name *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Jane Doe"
                  className="h-9"
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Age *</Label>
                <Input
                  type="number"
                  value={form.age}
                  onChange={(e) => setForm({ ...form, age: e.target.value })}
                  placeholder="21"
                  min={0}
                  className="h-9"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Gender *</Label>
              <GenderClipartPicker
                value={form.gender}
                onChange={(gender) => setForm({ ...form, gender })}
              />
            </div>
            <div className="grid gap-1.5">
                <Label className="text-xs">Learning Type</Label>
                <Select value={form.learningType} onValueChange={(v) => setForm({ ...form, learningType: v })}>
                  <SelectTrigger className="h-9">
                    <span className="flex flex-1 text-left">
                      {LEARNING_TYPE_OPTIONS.find((o) => o.value === form.learningType)?.label || "Select"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {LEARNING_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">University</Label>
              <Input
                value={form.university}
                onChange={(e) => setForm({ ...form, university: e.target.value })}
                placeholder="University of Colombo"
                className="h-9"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">Faculty</Label>
                <Input
                  value={form.faculty}
                  onChange={(e) => setForm({ ...form, faculty: e.target.value })}
                  placeholder="Faculty of Science"
                  className="h-9"
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Degree</Label>
                <Input
                  value={form.degree}
                  onChange={(e) => setForm({ ...form, degree: e.target.value })}
                  placeholder="BSc Computer Science"
                  className="h-9"
                />
              </div>
            </div>
            <button
              onClick={handleRegister}
              disabled={loading}
              className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Creating..." : "Register & Start"}
            </button>
          </div>
        )}
      </Card>
    </main>
  )
}
