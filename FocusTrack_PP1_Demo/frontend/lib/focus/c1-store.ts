// Persistence for Component 1 epochs. Only numeric feature rows leave the browser/agent;
// the raw key/mouse stream never does.
//
// Preferred destination: the FastAPI backend (set NEXT_PUBLIC_C1_BACKEND_URL, e.g.
// http://localhost:8000). When that is not configured or is unreachable, the same row is
// written through the app's normal Supabase client, which becomes the in-browser demo
// database when no Supabase keys are configured. The C1 demo therefore works offline and
// still stores epochs centrally when the backend is running.

import { isDemoMode } from "@/lib/demo-db"
import { getSupabase } from "@/lib/supabase"
import type { C1Features } from "./types"

export const C1_BACKEND_URL = (process.env.NEXT_PUBLIC_C1_BACKEND_URL || "").replace(/\/+$/, "")

export interface C1EpochRecord {
  studentId?: string | null
  sessionId?: string | null
  recordedAt: string
  studyMode: string
  taskType: string
  epochSeconds: number
  source: "desktop" | "browser"
  activeApplication?: string | null
  features: C1Features
  focusProb: number
}

export type SaveTarget = "backend" | "supabase" | "demo"

export interface SaveResult {
  ok: boolean
  target?: SaveTarget
  error?: string
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function postBackend(record: C1EpochRecord): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2500)
  try {
    const res = await fetch(`${C1_BACKEND_URL}/api/c1/epochs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studentId: record.studentId ?? null,
        sessionId: record.sessionId ?? null,
        recordedAt: record.recordedAt,
        studyMode: record.studyMode,
        taskType: record.taskType,
        epochSeconds: record.epochSeconds,
        source: record.source,
        activeApplication: record.activeApplication ?? null,
        focusProb: record.focusProb,
        ...record.features,
      }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`backend returned HTTP ${res.status}`)
  } finally {
    clearTimeout(timer)
  }
}

async function saveToAppDatabase(record: C1EpochRecord): Promise<SaveResult> {
  const f = record.features
  const { error } = await getSupabase().from("c1_epochs").insert({
    student_id: record.studentId ?? null,
    session_id: record.sessionId ?? null,
    recorded_at: record.recordedAt,
    study_mode: record.studyMode,
    task_type: record.taskType,
    epoch_seconds: record.epochSeconds,
    source: record.source,
    active_application: record.activeApplication ?? null,
    typing_rate: f.typingRate,
    inter_key_var: f.interKeyVar,
    backspace_ratio: f.backspaceRatio,
    idle_ratio: f.idleRatio,
    mouse_speed: f.mouseSpeed,
    switch_rate: f.switchRate,
    scroll_rate: f.scrollRate,
    keyboard_active: f.keyboardActive,
    interaction_state: f.state,
    state_label: f.stateLabel,
    dwell: f.dwell,
    changes: f.changes,
    away_share: f.awayShare,
    focus_prob: record.focusProb,
  })
  if (error) return { ok: false, target: isDemoMode() ? "demo" : "supabase", error: error.message }
  return { ok: true, target: isDemoMode() ? "demo" : "supabase" }
}

export async function saveC1Epoch(record: C1EpochRecord): Promise<SaveResult> {
  if (C1_BACKEND_URL) {
    try {
      await postBackend(record)
      return { ok: true, target: "backend" }
    } catch (error) {
      // Keep the demo running when the optional backend is down: fall back to the app DB.
      const fallback = await saveToAppDatabase(record)
      return fallback.ok
        ? { ...fallback, error: `Backend unavailable (${message(error)}); saved to the ${fallback.target} store instead.` }
        : { ...fallback, error: `${message(error)}; ${fallback.error ?? "fallback store failed"}` }
    }
  }
  return saveToAppDatabase(record)
}
