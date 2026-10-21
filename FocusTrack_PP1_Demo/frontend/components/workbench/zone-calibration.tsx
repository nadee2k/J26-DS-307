"use client"

// Component 3 calibration (≈ 2 minutes; quick mode ≈ 1 minute):
//   Part A – zone training (≈ 65 s): 9 screen dots, the learner's book and keyboard (desk), prompted looks away.
//   Part B – scripted check (held out, never used for training): screen, reading, phone pick-up, looking around.
// Part B gives known-truth labels to test the personal zone model against the fixed-angle rule, the phone
// detector's recall and the reading-motion detector. Prompts are spoken because the learner is not always
// looking at the screen.

import { useEffect, useRef, useState } from "react"
import type { FrameFeatures } from "@/lib/focus/buffers"
import { readingMotionScore } from "@/lib/focus/c3"
import type { CalibrationResult, Zone } from "@/lib/focus/types"
import { fixedZone } from "@/lib/focus/vision-math"
import { fitZoneModel, predictZone, zoneFeatures } from "@/lib/focus/zone-model"

interface Step { key: string; part: "A" | "B"; zone: Zone | null; prompt: string; sec: number; quickSec: number; dot?: [number, number]; reading?: boolean; phone?: boolean }

const DOTS: [number, number][] = [[0.1, 0.12], [0.5, 0.12], [0.9, 0.12], [0.1, 0.5], [0.5, 0.5], [0.9, 0.5], [0.1, 0.88], [0.5, 0.88], [0.9, 0.88]]
const QUICK_DOTS = [0, 2, 4, 6, 8]
function steps(quick: boolean): Step[] {
  const dots = (quick ? QUICK_DOTS : DOTS.map((_, i) => i)).map((i, k) => ({ key: `dot${i}`, part: "A" as const, zone: 0 as Zone, prompt: k === 0 ? "Look at the orange dot. It will move – follow it with your eyes." : "", sec: 3, quickSec: 2, dot: DOTS[i] }))
  return [
    ...dots,
    { key: "book", part: "A", zone: 1, prompt: "Now look down at your book or notes and read a few lines, as you normally would.", sec: 12, quickSec: 6, reading: true },
    { key: "keyboard", part: "A", zone: 1, prompt: "Look at your keyboard.", sec: 8, quickSec: 4 },
    { key: "left", part: "A", zone: 2, prompt: "Look away to your left.", sec: 5, quickSec: 3 },
    { key: "right", part: "A", zone: 2, prompt: "Look away to your right.", sec: 5, quickSec: 3 },
    { key: "up", part: "A", zone: 2, prompt: "Look up at the ceiling.", sec: 5, quickSec: 3 },
    { key: "t-screen", part: "B", zone: 0, prompt: "Check part. Look at the middle of the screen.", sec: 10, quickSec: 5 },
    { key: "t-read", part: "B", zone: 1, prompt: "Read your book again.", sec: 15, quickSec: 8, reading: true },
    { key: "t-phone", part: "B", zone: null, prompt: "Pick up your phone and use it as you usually would, holding it where it feels natural.", sec: 12, quickSec: 7, phone: true },
    { key: "t-away", part: "B", zone: 2, prompt: "Put the phone away and look around the room.", sec: 8, quickSec: 4 },
  ]
}

function say(text: string) {
  try { if (!text || !("speechSynthesis" in window)) return; window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 1.05; window.speechSynthesis.speak(u) } catch { /* no speech */ }
}
function beep() {
  try { const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.value = 880; g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.15) } catch { /* no audio */ }
}

export function ZoneCalibration({ quick, onFrameSink, onDone, onCancel, sessionId, studentId }: {
  quick: boolean
  onFrameSink: (sink: ((f: FrameFeatures) => void) | null) => void
  onDone: (r: CalibrationResult) => void
  onCancel: () => void
  sessionId: string
  studentId: string
}) {
  const plan = useRef(steps(quick)).current
  const [idx, setIdx] = useState(-1)
  const [left, setLeft] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const framesRef = useRef<{ step: number; f: FrameFeatures }[]>([])
  const stepRef = useRef(-1)
  const stepStartRef = useRef(0)
  const doneRef = useRef(false)

  useEffect(() => {
    onFrameSink((f) => {
      // ignore the first 0.7 s of each step while the eyes move to the new target
      if (stepRef.current >= 0 && Date.now() - stepStartRef.current > 700) framesRef.current.push({ step: stepRef.current, f })
    })
    return () => onFrameSink(null)
  }, [onFrameSink])

  useEffect(() => {
    if (idx < 0 || idx >= plan.length) return
    const s = plan[idx]
    stepRef.current = idx; stepStartRef.current = Date.now()
    if (s.prompt) say(s.prompt)
    const dur = (quick ? s.quickSec : s.sec) * 1000
    setLeft(Math.ceil(dur / 1000))
    const cd = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000)
    const t = setTimeout(() => { beep(); setIdx((i) => i + 1) }, dur)
    return () => { clearInterval(cd); clearTimeout(t) }
  }, [idx, plan, quick])

  useEffect(() => {
    if (idx !== plan.length || doneRef.current) return
    doneRef.current = true
    stepRef.current = -1
    const all = framesRef.current
    const train = all.filter(({ step, f }) => plan[step].part === "A" && f.face && plan[step].zone !== null)
    const perZoneTrain = [0, 1, 2].map((z) => train.filter(({ step }) => plan[step].zone === z).length)
    if (perZoneTrain.some((n) => n < 5)) { setError(`Not enough face frames to calibrate (screen ${perZoneTrain[0]}, desk ${perZoneTrain[1]}, away ${perZoneTrain[2]}). Check lighting and that your face is in view, then try again.`); return }
    const model = fitZoneModel(train.map(({ step, f }) => ({ x: zoneFeatures(f), zone: plan[step].zone as number })))
    const pitchOf = (keys: string[]) => { const v = all.filter(({ step, f }) => keys.includes(plan[step].key) && f.face).map(({ f }) => f.pitch); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0 }
    const deskAnchor = pitchOf(["book"]), screenPitch = pitchOf(plan.filter((s) => s.dot).map((s) => s.key))
    const test = all.filter(({ step, f }) => plan[step].part === "B" && plan[step].zone !== null && f.face)
    const perZone = ([0, 1, 2] as Zone[]).map((z) => {
      const rows = test.filter(({ step }) => plan[step].zone === z)
      return { zone: z, n: rows.length, personal: rows.length ? rows.filter(({ f }) => predictZone(model, f).zone === z).length / rows.length : 0, fixed: rows.length ? rows.filter(({ f }) => fixedZone(f.pitch, f.yaw) === z).length / rows.length : 0 }
    })
    const nTest = test.length
    const acc = (k: "personal" | "fixed") => (nTest ? perZone.reduce((s, z) => s + z[k] * z.n, 0) / nTest : null)
    const phoneFrames = all.filter(({ step, f }) => plan[step].phone && f.phone !== null)
    const ctx = { deskAnchor, screenPitch }
    const framesOf = (key: string) => all.filter(({ step }) => plan[step].key === key).map(({ f }) => ({ ...f, zone: f.face ? predictZone(model, f).zone : -1 as const }))
    onDone({
      sessionId, studentId, createdAt: new Date().toISOString(), quick, model, deskAnchor, screenPitch,
      nTrain: train.length, nTest,
      accuracyPersonal: acc("personal"), accuracyFixed: acc("fixed"),
      phoneRecall: phoneFrames.length ? phoneFrames.filter(({ f }) => f.phone).length / phoneFrames.length : null,
      phoneFrames: phoneFrames.length,
      readingMotionRead: readingMotionScore(framesOf("t-read"), ctx),
      readingMotionPhone: readingMotionScore(framesOf("t-phone"), ctx),
      perZone,
    })
  }, [idx, plan, onDone, sessionId, studentId, quick])

  const s = idx >= 0 && idx < plan.length ? plan[idx] : null
  const trainSec = plan.filter((p) => p.part === "A").reduce((a, p) => a + (quick ? p.quickSec : p.sec), 0)
  const testSec = plan.filter((p) => p.part === "B").reduce((a, p) => a + (quick ? p.quickSec : p.sec), 0)
  return (
    <div className="fixed inset-0 z-50 bg-[#141820] text-white">
      {s?.dot && <div className="absolute h-8 w-8 animate-pulse rounded-full bg-[#D9711C] shadow-[0_0_24px_#D9711C]" style={{ left: `${s.dot[0] * 100}%`, top: `${s.dot[1] * 100}%`, transform: "translate(-50%,-50%)" }} />}
      <div className="absolute left-1/2 top-1/2 w-full max-w-xl -translate-x-1/2 -translate-y-1/2 px-6 text-center">
        {idx === -1 && (
          <>
            <p className="text-sm uppercase tracking-[0.2em] text-[#F2B27A]">Component 3 · personal gaze calibration</p>
            <h2 className="mt-2 text-2xl font-bold">About {Math.round((trainSec + testSec) / 5) * 5} seconds</h2>
            <p className="mt-3 text-sm text-gray-300">Part A teaches FocusTrack where <b>your</b> screen, desk and "away" are ({trainSec} s). Part B is a short scripted check that is never used for training: it measures how well the model works, including picking up your phone ({testSec} s). Have your book and phone ready. Instructions are spoken.</p>
            <div className="mt-6 flex justify-center gap-3">
              <button onClick={() => setIdx(0)} className="rounded-xl bg-[#D9711C] px-5 py-2.5 font-semibold">Start calibration</button>
              <button onClick={onCancel} className="rounded-xl border border-gray-500 px-5 py-2.5">Cancel</button>
            </div>
          </>
        )}
        {s && !s.dot && (
          <>
            <p className="text-xs uppercase tracking-[0.2em] text-[#F2B27A]">Part {s.part} · step {idx + 1} of {plan.length}</p>
            <p className="mt-3 text-2xl font-semibold">{s.prompt}</p>
            <p className="mt-4 font-mono text-5xl">{left}</p>
          </>
        )}
        {s?.dot && <p className="mt-40 text-sm text-gray-400">Part A · follow the dot ({idx + 1}/{plan.filter((p) => p.dot).length})</p>}
        {idx === plan.length && !error && <p className="text-lg">Fitting your personal zone model…</p>}
        {error && (
          <>
            <p className="text-base text-red-300">{error}</p>
            <button onClick={onCancel} className="mt-4 rounded-xl border border-gray-500 px-5 py-2">Close</button>
          </>
        )}
      </div>
      {s && <button onClick={onCancel} className="absolute bottom-6 left-1/2 -translate-x-1/2 text-xs text-gray-400 underline">Cancel calibration</button>}
    </div>
  )
}
