"use client"

import type { Student } from "./types"

const STUDENTS_KEY = "ft_demo_students_v1"

function uid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return Math.random().toString(36).slice(2)
}

function now() {
  return new Date().toISOString()
}

function profile(
  id: string,
  name: string,
  age: number,
  gender: Student["gender"],
  learningType: Student["learningType"],
  university: string,
  faculty: string,
): Student {
  const t = now()
  return {
    id,
    name,
    age,
    gender,
    learningType,
    university,
    faculty,
    degree: "BSc (Hons)",
    createdAt: t,
    updatedAt: t,
  }
}

function seed(): Student[] {
  return [
    profile("demo-nimali", "Nimali Perera", 22, "female", "non-screen", "University of Colombo", "Arts"),
    profile("demo-kasun", "Kasun Fernando", 23, "male", "screen", "University of Moratuwa", "Computing"),
    profile("demo-ayesha", "Ayesha Silva", 21, "female", "screen", "University of Peradeniya", "Science"),
  ]
}

function load(): Student[] {
  if (typeof window === "undefined") return seed()
  try {
    const raw = window.localStorage.getItem(STUDENTS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Student[]
      if (Array.isArray(parsed) && parsed.length) return parsed
    }
  } catch {
    /* fall through to seed */
  }
  const seeded = seed()
  save(seeded)
  return seeded
}

function save(students: Student[]) {
  try {
    window.localStorage.setItem(STUDENTS_KEY, JSON.stringify(students))
  } catch {
    /* storage unavailable */
  }
}

export const studentStore = {
  list(): Student[] {
    return load()
  },
  get(id: string): Student | null {
    return load().find((s) => s.id === id) ?? null
  },
  create(input: Omit<Student, "id" | "createdAt" | "updatedAt">): Student {
    const t = now()
    const s: Student = { ...input, id: uid(), createdAt: t, updatedAt: t }
    const all = load()
    all.push(s)
    save(all)
    return s
  },
  /** Accept a profile exported from the PP1 app (same field names). */
  importJson(text: string): Student {
    const raw = JSON.parse(text) as Partial<Student>
    if (!raw || typeof raw.name !== "string" || !raw.name.trim()) throw new Error("The profile needs at least a name.")
    const age = Number(raw.age)
    const gender = raw.gender === "male" ? "male" : "female"
    const t = now()
    const s: Student = {
      id: uid(),
      name: raw.name.trim(),
      age: Number.isFinite(age) && age > 0 ? age : 21,
      gender,
      university: raw.university ?? null,
      faculty: raw.faculty ?? null,
      degree: raw.degree ?? null,
      learningType: raw.learningType === "non-screen" ? "non-screen" : raw.learningType === "screen" ? "screen" : null,
      createdAt: t,
      updatedAt: t,
    }
    const all = load()
    all.push(s)
    save(all)
    return s
  },
}
