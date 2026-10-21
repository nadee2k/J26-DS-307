// Persistence used by the component workbenches. Works with Supabase (tables in supabase/schema.sql)
// and with the in-browser demo database. Components are not integrated yet: each stores only its own results.

import { getSupabase } from "@/lib/supabase"
import type { CalibrationResult } from "./types"

const db = () => getSupabase()
function check(error: { message: string } | null) { if (error) throw new Error(error.message) }

// ---------- C2: room conditions before high-focus probes in earlier sessions ----------
/**
 * One value per minute (noise, temperature) from the 5 minutes before each probe whose learner-normalised rating is
 * above the learner's mean (z > 0), across the learner's completed sessions in the shared data-collection app.
 * These minutes define the personal comfort band (earlier sessions only, so no test information leaks in).
 */
export async function goodFocusMinutes(studentId: string, zOf: (r: number, hist: number[]) => number, convert: (noise: number | null, light: number | null) => number | null) {
  const { data: ss, error } = await db().from("study_sessions").select("*").eq("student_id", studentId)
  check(error)
  const sessions = ((ss ?? []) as Record<string, unknown>[]).filter((s) => s.status === "completed")
  const out: { noise: number | null; temp: number | null }[] = []
  const allRatings: number[] = []
  const perSession: { probes: { at: number; rating: number }[]; env: Record<string, unknown>[] }[] = []
  for (const s of sessions) {
    const { data: pr } = await db().from("concentration_logs").select("*").eq("session_id", String(s.id))
    const { data: env } = await db().from("environment_logs").select("*").eq("session_id", String(s.id))
    const probes = ((pr ?? []) as Record<string, unknown>[]).map((r) => ({ at: new Date(String(r.recorded_at ?? r.created_at)).getTime(), rating: Number(r.level) }))
    probes.forEach((p) => allRatings.push(p.rating))
    perSession.push({ probes, env: (env ?? []) as Record<string, unknown>[] })
  }
  for (const s of perSession) for (const p of s.probes) {
    if (zOf(p.rating, allRatings) <= 0) continue
    for (let m = 0; m < 5; m++) {
      const to = p.at - m * 60000, from = to - 60000
      const rows = s.env.filter((r) => { const t = new Date(String(r.created_at)).getTime(); return t >= from && t < to })
      if (!rows.length) continue
      const noise = rows.map((r) => convert(r.noise as number | null, r.light as number | null)).filter((v): v is number => v != null)
      const temp = rows.map((r) => r.temperature as number | null).filter((v): v is number => v != null && v > -40)
      out.push({ noise: noise.length ? noise.reduce((a, b) => a + b, 0) / noise.length : null, temp: temp.length ? temp.reduce((a, b) => a + b, 0) / temp.length : null })
    }
  }
  return { minutes: out, sessions: sessions.length, probes: allRatings.length }
}

// ---------- C3: calibration results ----------
export async function saveCalibration(c: CalibrationResult) {
  const { data, error } = await db().from("calibrations").insert({
    session_id: c.sessionId, student_id: c.studentId, quick: c.quick, model: c.model, desk_anchor: c.deskAnchor, screen_pitch: c.screenPitch,
    n_train: c.nTrain, n_test: c.nTest, accuracy_personal: c.accuracyPersonal, accuracy_fixed: c.accuracyFixed,
    phone_recall: c.phoneRecall, phone_frames: c.phoneFrames, reading_motion_read: c.readingMotionRead, reading_motion_phone: c.readingMotionPhone,
    per_zone: c.perZone,
  }).select().single()
  check(error)
  return { ...c, id: String((data as Record<string, unknown>).id) }
}
const mapCal = (r: Record<string, unknown>): CalibrationResult => ({
  id: String(r.id), sessionId: String(r.session_id ?? ""), studentId: String(r.student_id), createdAt: String(r.created_at), quick: Boolean(r.quick),
  model: r.model as CalibrationResult["model"], deskAnchor: Number(r.desk_anchor), screenPitch: Number(r.screen_pitch),
  nTrain: Number(r.n_train), nTest: Number(r.n_test), accuracyPersonal: r.accuracy_personal as number | null, accuracyFixed: r.accuracy_fixed as number | null,
  phoneRecall: r.phone_recall as number | null, phoneFrames: Number(r.phone_frames ?? 0), readingMotionRead: r.reading_motion_read as number | null,
  readingMotionPhone: r.reading_motion_phone as number | null, perZone: (r.per_zone as CalibrationResult["perZone"]) ?? [],
})
export async function calibrationsByStudent(studentId: string) {
  const { data, error } = await db().from("calibrations").select("*").eq("student_id", studentId).order("created_at", { ascending: true })
  check(error)
  return ((data ?? []) as Record<string, unknown>[]).map(mapCal)
}
