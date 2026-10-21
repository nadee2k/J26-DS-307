"use client"

// Experience-sampling focus probe (shared labelling protocol): while a session is running, a one-tap prompt
// appears at a random time every 8–12 minutes and stores a 1–5 rating that labels the preceding minutes.
// "Fast demo" shortens the interval to 20–40 seconds for presentations.

import { useCallback, useEffect, useRef, useState } from "react"
import { Bell } from "lucide-react"
import { concentrationLogs } from "@/lib/api"
import { CONCENTRATION_LEVELS } from "@/lib/constants"
import type { ConcentrationLevel } from "@/types"

export function FocusProbe({ active, sessionId, environment }: { active: boolean; sessionId: string | null; environment: string }) {
  const [open, setOpen] = useState(false)
  const [fast, setFast] = useState(false)
  const [count, setCount] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    const ms = fast ? (20 + Math.random() * 20) * 1000 : (8 + Math.random() * 4) * 60 * 1000
    timer.current = setTimeout(() => setOpen(true), ms)
  }, [fast])

  useEffect(() => {
    if (active && sessionId) schedule()
    else { if (timer.current) clearTimeout(timer.current); setOpen(false) }
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [active, sessionId, schedule])

  const answer = async (level: ConcentrationLevel | null) => {
    setOpen(false)
    if (level && sessionId) {
      try {
        await concentrationLogs.create({ sessionId, level, environment: (environment || "campus") as never, notes: "probe" })
        setCount((c) => c + 1)
      } catch { console.error("Failed to store probe rating") }
    }
    schedule()
  }

  if (!active) return null
  return (
    <>
      <div className="flex items-center justify-between rounded-2xl border border-[#eadfce] bg-white px-4 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-2"><Bell className="h-3.5 w-3.5 text-[#7b3fa0]" />Focus probes on – random check every {fast ? "20–40 seconds (demo)" : "8–12 minutes"} · {count} answered</span>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={fast} onChange={(e) => setFast(e.target.checked)} />Fast demo</label>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2a1840]/40 p-4" role="dialog" aria-modal="true" aria-labelledby="probe-title">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
            <p id="probe-title" className="text-lg font-semibold text-[#2a1840]">How focused were you over the last few minutes?</p>
            <p className="mt-1 text-sm text-muted-foreground">One tap – then carry on studying.</p>
            <div className="mt-4 grid grid-cols-5 gap-2">
              {([1, 2, 3, 4, 5] as ConcentrationLevel[]).map((l) => (
                <button key={l} onClick={() => answer(l)} className="flex flex-col items-center gap-1 rounded-2xl border border-[#eadfce] p-2 text-xs hover:bg-[#f3eee6]">
                  <span className="text-xl font-bold text-[#7b3fa0]">{l}</span>
                  <span className="text-center leading-tight text-muted-foreground">{CONCENTRATION_LEVELS[l]}</span>
                </button>
              ))}
            </div>
            <button onClick={() => answer(null)} className="mt-4 w-full text-center text-xs text-muted-foreground underline">Skip this one</button>
          </div>
        </div>
      )}
    </>
  )
}
