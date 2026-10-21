"use client"

// Common frame for the four component workbenches. The components are deliberately NOT integrated at PP1:
// each owner demonstrates their own part here; integration (C1–C3 epochs feeding C4 live) is the next stage.

import Link from "next/link"
import { CheckCircle2, Circle, FlaskConical } from "lucide-react"
import type { ReactNode } from "react"

export interface WorkbenchInfo {
  n: 1 | 2 | 3 | 4
  title: string
  owner: string
  id: string
  question: string
  done: string[]
  next: string[]
  analysisTab: string
}

const COLORS: Record<number, string> = { 1: "#2A6FDB", 2: "#1E8E5A", 3: "#D9711C", 4: "#7D3CB0" }

export function WorkbenchShell({ info, children }: { info: WorkbenchInfo; children: ReactNode }) {
  const col = COLORS[info.n]
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: col }}>Component {info.n} workbench</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{info.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{info.owner} · {info.id} · {info.question}</p>
        </div>
        <Link href={`/research?tab=${encodeURIComponent(info.analysisTab)}`} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold" style={{ borderColor: col, color: col }}>
          <FlaskConical className="h-4 w-4" /> Analysis on the simulated study
        </Link>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border bg-white p-4" style={{ borderColor: `${col}55` }}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: col }}>Built for PP1 (≈ 50%)</p>
          <ul className="grid gap-1.5 text-sm">{info.done.map((d) => <li key={d} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: col }} />{d}</li>)}</ul>
        </div>
        <div className="rounded-2xl border border-dashed bg-white/60 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Next (remaining ≈ 50%)</p>
          <ul className="grid gap-1.5 text-sm text-muted-foreground">{info.next.map((d) => <li key={d} className="flex gap-2"><Circle className="mt-0.5 h-4 w-4 shrink-0" />{d}</li>)}</ul>
        </div>
      </div>
      {children}
    </div>
  )
}

export function Panel({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#e3ddd2] bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  )
}

export function Metric({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl bg-[#f6f3ee] px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="font-mono text-lg font-semibold">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** Tiny dependency-free line/bar sparkline. */
export function Spark({ values, max, min = 0, color = "#1B2F6E", height = 48, bars = false, labels }: { values: (number | null)[]; max?: number; min?: number; color?: string; height?: number; bars?: boolean; labels?: string[] }) {
  const w = 300, n = Math.max(values.length, 2)
  const vals = values.map((v) => (v == null ? null : v))
  const hi = max ?? Math.max(1e-6, ...vals.filter((v): v is number => v != null))
  const X = (i: number) => (i / (n - 1)) * (w - 4) + 2
  const Y = (v: number) => height - 2 - ((v - min) / Math.max(1e-6, hi - min)) * (height - 4)
  if (bars) {
    const bw = Math.max(2, (w - 4) / n - 2)
    return (
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        {vals.map((v, i) => v == null ? null : <rect key={i} x={2 + i * ((w - 4) / n)} y={Y(v)} width={bw} height={height - 2 - Y(v)} fill={color} rx={1}><title>{labels?.[i] ?? v.toFixed(2)}</title></rect>)}
      </svg>
    )
  }
  let d = ""
  vals.forEach((v, i) => { if (v == null) return; d += `${d ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)} ` })
  return <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}><path d={d} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" /></svg>
}
