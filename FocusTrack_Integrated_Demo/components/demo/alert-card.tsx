"use client"

import { Bell, Check, HelpCircle, X } from "lucide-react"
import type { RaisedAlert } from "@/lib/demo/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export function AlertCard({
  alert,
  science,
  threshold,
  onRespond,
  compact = false,
}: {
  alert: RaisedAlert
  science: boolean
  threshold: number
  onRespond: (id: string, r: "helpful" | "not-now") => void
  compact?: boolean
}) {
  return (
    <article className="animate-slide-in rounded-2xl border border-amber-200/80 bg-[#fdf8ee] p-4">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
          <Bell className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-snug text-[#6b4a12]">Your focus may dip in the next 5–10 minutes</p>
          <p className="mt-0.5 text-[10px] text-[#8a6a2a]">
            minute {alert.t} · risk {Math.round(alert.risk * 100)}% · your alert level {Math.round(alert.threshold * 100)}%
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8a6a2a]">Why</p>
        <ul className="grid gap-1 text-xs text-[#4f3c17]">
          {[...new Set(alert.reasons)].length ? (
            [...new Set(alert.reasons)].map((r, i) => (
              <li key={`${r}-${i}`} className="flex gap-1.5">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#b0834a]" />
                {r}
              </li>
            ))
          ) : (
            <li className="flex gap-1.5"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#b0834a]" />A combination of small signals</li>
          )}
        </ul>

        <div className="rounded-xl bg-white/70 p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8a6a2a]">Try</p>
          <p className="mt-0.5 text-xs leading-relaxed text-[#4f3c17]">
            {alert.counterfactual ?? "No single small change brings the risk below your alert level — a short break may be the better move."}
          </p>
        </div>

        {science && (
          <div className="rounded-xl border border-amber-200/70 bg-white/60 p-2.5">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8a6a2a]">Model detail</p>
            <div className="grid gap-1">
              {alert.contributions.map((c) => (
                <div key={c.feature} className="flex items-center gap-2 text-[10px]">
                  <span className="w-24 shrink-0 truncate text-muted-foreground">{c.feature}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-[#b0834a]"
                      style={{ width: `${Math.min(100, Math.max(6, c.value * 120))}%` }}
                    />
                  </span>
                  <span className="w-8 text-right font-mono text-muted-foreground">{c.value.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[9px] text-muted-foreground">
              {alert.fusion === "feature-level" ? "All three streams fused at feature level" : "Decision-level fallback — one stream is unavailable"} · C1 {alert.streams.c1 ? "on" : "off"} · C2 {alert.streams.c2 ? "on" : "off"} · C3 {alert.streams.c3 ? "on" : "off"}
            </p>
          </div>
        )}

        {!compact && (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {alert.response ? (
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Check className="h-3.5 w-3.5 text-emerald-600" />
                {alert.response === "helpful" ? "Thanks — this raises your sensitivity to early signs." : "Noted — your alert level moved up."}
                <span className="font-mono">now {Math.round(threshold * 100)}%</span>
              </span>
            ) : (
              <>
                <Button size="sm" onClick={() => onRespond(alert.id, "helpful")}>
                  <Check className="h-3.5 w-3.5" /> Helpful
                </Button>
                <Button size="sm" variant="outline" onClick={() => onRespond(alert.id, "not-now")}>
                  <X className="h-3.5 w-3.5" /> Not now
                </Button>
                <span className={cn("text-[10px] text-muted-foreground")}>
                  <HelpCircle className="mr-0.5 inline h-3 w-3" /> You stay in control.
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
