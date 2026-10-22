"use client"

import type { DemoRun } from "@/lib/demo/types"

export function stateColor(label: string) {
  if (label.includes("typing")) return "#2A6FDB"
  if (label.includes("Browsing")) return "#7D3CB0"
  if (label.includes("Leaving")) return "#D9711C"
  if (label.includes("Idle")) return "#9AA3B2"
  return "#C4B0D6"
}

export function StateRibbon({ run, cursor }: { run: DemoRun; cursor: number }) {
  const shown = run.frames.slice(0, cursor + 1)
  const groups: { label: string; count: number }[] = []
  for (const f of shown) {
    const last = groups[groups.length - 1]
    if (last && last.label === f.stateLabel) last.count++
    else groups.push({ label: f.stateLabel, count: 1 })
  }
  const total = Math.max(1, shown.length)

  return (
    <div>
      <div className="flex h-7 w-full overflow-hidden rounded-lg bg-muted">
        {groups.map((g, i) => (
          <div
            key={i}
            title={`${g.label} · ${g.count} min`}
            style={{ width: `${(g.count / total) * 100}%`, background: stateColor(g.label) }}
            className="h-full border-r border-white/30 last:border-0 transition-all"
          />
        ))}
        {!shown.length && <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">waiting for the first minute</div>}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        {[...new Set(run.frames.map((f) => f.stateLabel))].map((label) => (
          <span key={label} className="flex items-center gap-1">
            <i className="h-2 w-2 rounded-full" style={{ background: stateColor(label) }} /> {label}
          </span>
        ))}
      </div>
    </div>
  )
}
