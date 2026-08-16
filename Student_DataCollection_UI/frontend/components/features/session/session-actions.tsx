"use client"

import { useState } from "react"
import { Play, Square, Pause } from "lucide-react"
import type { SessionState } from "@/types"

export function SessionActions({ onStart }: { onStart?: () => void }) {
  const [state, setState] = useState<SessionState>("idle")

  const isActive = state === "running" || state === "paused"

  const handleStart = () => {
    setState("running")
    onStart?.()
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <button
        type="button"
        onClick={handleStart}
        disabled={isActive}
        className="flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:bg-emerald-600/30 disabled:text-white/50"
      >
        <Play className="h-4 w-4 fill-current" aria-hidden="true" />
        START STUDY SESSION
      </button>

      {isActive && (
        <button
          type="button"
          onClick={() => setState((s) => (s === "running" ? "paused" : "running"))}
          className="flex items-center justify-center gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-5 py-2.5 text-sm font-semibold text-amber-300 shadow-sm transition-colors hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {state === "paused" ? (
            <>
              <Play className="h-4 w-4 fill-current" aria-hidden="true" />
              RESUME SESSION
            </>
          ) : (
            <>
              <Pause className="h-4 w-4 fill-current" aria-hidden="true" />
              PAUSE SESSION
            </>
          )}
        </button>
      )}

      <button
        type="button"
        onClick={() => setState("idle")}
        disabled={!isActive}
        className="flex items-center justify-center gap-2 rounded-md border px-5 py-2.5 text-sm font-semibold shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:border-red-500/40 disabled:bg-transparent disabled:text-red-400/60 disabled:shadow-none enabled:border-red-500 enabled:bg-red-600 enabled:text-white enabled:hover:bg-red-500"
      >
        <Square className="h-4 w-4 fill-current" aria-hidden="true" />
        STOP &amp; SAVE SESSION
      </button>
    </div>
  )
}
