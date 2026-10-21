"use client"

// Small SVG/HTML chart primitives for the research dashboard (no chart library needed).

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-[#eadfce] bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-[#2a1840]">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** Horizontal bars with value labels. `highlight` marks the proposed method. */
export function Bars({ items, max = 1, format = (v: number) => v.toFixed(2), highlight }: {
  items: { label: string; value: number }[]; max?: number; format?: (v: number) => string; highlight?: string
}) {
  return (
    <div className="space-y-2">
      {items.map((it) => {
        const w = Math.max(0, Math.min(1, it.value / max)) * 100
        const hi = highlight ? it.label === highlight : false
        return (
          <div key={it.label} className="grid grid-cols-[minmax(0,14rem)_1fr_3.5rem] items-center gap-3 text-sm">
            <span className={`truncate ${hi ? "font-semibold text-[#2a1840]" : "text-muted-foreground"}`} title={it.label}>{it.label}</span>
            <div className="h-3 rounded-full bg-[#f3eee6]">
              <div className={`h-3 rounded-full ${hi ? "bg-[#7b3fa0]" : "bg-[#c9b3dc]"}`} style={{ width: `${w}%` }} />
            </div>
            <span className="text-right font-mono text-xs tabular-nums">{Number.isFinite(it.value) ? format(it.value) : "–"}</span>
          </div>
        )
      })}
    </div>
  )
}

/** Session timeline: hidden focus (simulator truth), forecast risk, and probe ratings. */
export function SessionTrace({ focus, risk, probes, threshold, alertAt }: {
  focus: number[]; risk: number[]; probes: { t: number; rating: number }[]; threshold?: number; alertAt?: number
}) {
  const W = 720, H = 200, P = 28
  const x = (t: number) => P + (t / Math.max(focus.length - 1, 1)) * (W - 2 * P)
  const y = (v: number) => H - P - v * (H - 2 * P)
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Session timeline">
      <rect x={P} y={P} width={W - 2 * P} height={H - 2 * P} fill="#fbf8f3" rx={8} />
      {[0, 0.5, 1].map((g) => <line key={g} x1={P} x2={W - P} y1={y(g)} y2={y(g)} stroke="#eadfce" />)}
      {threshold !== undefined && <line x1={P} x2={W - P} y1={y(threshold)} y2={y(threshold)} stroke="#c0392b" strokeDasharray="4 4" />}
      <path d={path(focus)} fill="none" stroke="#1e8e5a" strokeWidth={2} />
      <path d={path(risk)} fill="none" stroke="#7b3fa0" strokeWidth={2} />
      {probes.map((p) => <circle key={p.t} cx={x(p.t)} cy={y((p.rating - 1) / 4)} r={5} fill="#d9711c" />)}
      {alertAt !== undefined && <line x1={x(alertAt)} x2={x(alertAt)} y1={P} y2={H - P} stroke="#c0392b" strokeWidth={2} />}
      <text x={P} y={H - 8} fontSize={11} fill="#6b7688">minute 0</text>
      <text x={W - P} y={H - 8} fontSize={11} fill="#6b7688" textAnchor="end">minute {focus.length - 1}</text>
    </svg>
  )
}

export function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: i.color }} />{i.label}</span>
      ))}
    </div>
  )
}
