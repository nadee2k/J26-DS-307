"use client"

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react"
import { clamp } from "@/lib/utils"

export function FocusGauge({ value, trend }: { value: number; trend: "up" | "down" | "flat" }) {
  const R = 62
  const C = 2 * Math.PI * R
  const pct = clamp(value, 0, 100) / 100
  const color = value >= 65 ? "#5b3f86" : value >= 45 ? "#8b6bb0" : "#b0834a"

  return (
    <div className="relative flex h-[188px] w-[188px] items-center justify-center">
      <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="80" cy="80" r={R} fill="none" stroke="#efe6f4" strokeWidth="13" />
        <circle
          cx="80"
          cy="80"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="13"
          strokeLinecap="round"
          strokeDasharray={`${C * pct} ${C}`}
          style={{ transition: "stroke-dasharray 600ms ease, stroke 400ms ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-4xl font-semibold leading-none tabular-nums" style={{ color }}>
          {Math.round(value)}
        </span>
        <span className="mt-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">focus score</span>
        <span className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
          {trend === "up" && <ArrowUpRight className="h-3 w-3 text-emerald-600" />}
          {trend === "down" && <ArrowDownRight className="h-3 w-3 text-amber-600" />}
          {trend === "flat" && <Minus className="h-3 w-3" />}
          {trend === "up" ? "improving" : trend === "down" ? "slipping" : "steady"}
        </span>
      </div>
    </div>
  )
}
