"use client"

import type { DemoRun, RaisedAlert } from "@/lib/demo/types"

const W = 760
const H = 210
const L = 34
const R = 14
const T = 12
const B = 36

function pathFor(values: number[], X: (i: number) => number, Y: (v: number) => number, from: number, to: number) {
  let d = ""
  for (let i = from; i <= to; i++) {
    const v = values[i]
    if (v == null || Number.isNaN(v)) continue
    d += `${d ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)} `
  }
  return d
}

export function SessionTimeline({ run, cursor, alerts, threshold }: { run: DemoRun; cursor: number; alerts: RaisedAlert[]; threshold: number }) {
  const n = run.frames.length
  const X = (i: number) => L + (i / Math.max(1, n - 1)) * (W - L - R)
  const Y = (v: number) => T + (1 - v) * (H - T - B)
  const focus = run.frames.map((f) => f.focusProb)
  const risk = run.frames.map((f) => f.risk)

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Focus and drop-risk over the session">
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="#eee7dc" strokeWidth={1} />
            <text x={L - 6} y={Y(v) + 3} fontSize="8" textAnchor="end" fill="#a294b0">
              {Math.round(v * 100)}
            </text>
          </g>
        ))}

        {/* threshold */}
        <line x1={L} x2={W - R} y1={Y(threshold)} y2={Y(threshold)} stroke="#b0834a" strokeDasharray="4 3" strokeWidth={1} />
        <text x={W - R} y={Y(threshold) - 4} fontSize="8" textAnchor="end" fill="#b0834a">
          alert level {Math.round(threshold * 100)}%
        </text>

        {/* played */}
        <path d={pathFor(focus, X, Y, 0, cursor)} fill="none" stroke="#5b3f86" strokeWidth={2.4} strokeLinejoin="round" />
        <path d={pathFor(risk, X, Y, 0, cursor)} fill="none" stroke="#b0834a" strokeWidth={2} strokeDasharray="5 3" />
        <circle cx={X(cursor)} cy={Y(focus[cursor] ?? 0)} r={3.6} fill="#5b3f86" />
        <circle cx={X(cursor)} cy={Y(risk[cursor] ?? 0)} r={3} fill="#b0834a" />

        {/* probes */}
        {run.probes.filter((p) => p.t <= cursor).map((p) => (
          <g key={p.t}>
            <circle cx={X(p.t)} cy={H - 13} r={7} fill={p.drop ? "#b45454" : "#1E8E5A"} />
            <text x={X(p.t)} y={H - 10} fontSize="8" textAnchor="middle" fill="#fff">
              {p.rating}
            </text>
          </g>
        ))}

        {/* alerts */}
        {alerts.map((a) => (
          <g key={a.id}>
            <circle cx={X(a.t)} cy={Y(a.risk)} r={9} fill="#f3e3c8" stroke="#b0834a" strokeWidth={1.5} />
            <text x={X(a.t)} y={Y(a.risk) + 3.2} fontSize="9" textAnchor="middle">
              !
            </text>
          </g>
        ))}

        {cursor > 0 && (
          <line x1={X(cursor)} x2={X(cursor)} y1={T} y2={H - B} stroke="#7b3fa0" strokeWidth={1} strokeDasharray="2 2" opacity={0.5} />
        )}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><i className="h-0.5 w-4 rounded bg-[#5b3f86]" /> focus score</span>
        <span className="flex items-center gap-1"><i className="h-0.5 w-4 rounded bg-[#b0834a]" /> drop risk, 5–10 min ahead</span>
        <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#b45454]" /> low self-report</span>
        <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#b0834a]" /> alert</span>
      </div>
    </div>
  )
}
