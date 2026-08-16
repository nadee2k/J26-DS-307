"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Save, User } from "lucide-react"
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
import { AppShell } from "@/components/layout/app-shell"
import { useAuth } from "@/hooks/use-auth"
import { students } from "@/lib/api"
import { GENDER_OPTIONS, LEARNING_TYPE_OPTIONS } from "@/lib/constants"

export default function ProfilePage() {
  const { student, setStudent, isLoading } = useAuth()
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
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
    if (!isLoading && !student) {
      router.push("/login")
    }
  }, [student, isLoading, router])

  useEffect(() => {
    if (student) {
      setForm({
        name: student.name || "",
        age: String(student.age || ""),
        gender: student.gender || "",
        university: student.university || "",
        faculty: student.faculty || "",
        degree: student.degree || "",
        learningType: student.learningType || "",
      })
    }
  }, [student])

  const handleSave = async () => {
    if (!student) return
    if (!form.name || !form.age || !form.gender) {
      setError("Name, age, and gender are required")
      return
    }
    setSaving(true)
    setError("")
    setSaved(false)
    try {
      const updated = await students.update(student.id, {
        name: form.name,
        age: parseInt(form.age),
        gender: form.gender as "female" | "male",
        university: form.university || null,
        faculty: form.faculty || null,
        degree: form.degree || null,
        learningType: form.learningType as "screen" | "non-screen" || null,
      })
      setStudent(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError("Failed to update profile")
    } finally {
      setSaving(false)
    }
  }

  if (isLoading || !student) return null

  return (
    <AppShell studentName={student.name}>
      <div className="mx-auto max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Student Profile</h1>
          <p className="text-sm text-muted-foreground">Manage your personal information</p>
        </div>

        <Card className="border-border bg-card p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/30">
              <User className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">{student.name}</p>
              <p className="text-xs text-muted-foreground">ID: {student.id.slice(0, 8)}...</p>
            </div>
          </div>

          {error && (
            <div className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400 ring-1 ring-inset ring-red-500/20">
              {error}
            </div>
          )}
          {saved && (
            <div className="mb-4 rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400 ring-1 ring-inset ring-emerald-500/20">
              Profile saved successfully
            </div>
          )}

          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label className="text-xs">Name *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="h-9"
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Age *</Label>
                <Input
                  type="number"
                  value={form.age}
                  onChange={(e) => setForm({ ...form, age: e.target.value })}
                  min={0}
                  className="h-9"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label className="text-xs">Gender *</Label>
                <Select value={form.gender} onValueChange={(v) => setForm({ ...form, gender: v })}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {GENDER_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Learning Type</Label>
                <Select value={form.learningType} onValueChange={(v) => setForm({ ...form, learningType: v })}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {LEARNING_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
            <div className="grid grid-cols-2 gap-4">
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
              onClick={handleSave}
              disabled={saving}
              className="mt-2 flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? "Saving..." : "Save Profile"}
            </button>
          </div>
        </Card>
      </div>
    </AppShell>
  )
}
