"use client"

import { Eye, Keyboard, Thermometer } from "lucide-react"
import type { Frame } from "@/lib/demo/types"
import { cn } from "@/lib/utils"

function Row({
  icon: Icon,
  label,
  active,
  color,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  active: boolean
  color: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("rounded-xl border p-2.5", active ? "border-border bg-white" : "border-dashed border-border bg-muted/40 opacity-70")}>
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg" style={{ background: `${color}18`, color }}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="text-[11px] font-semibold">{label}</span>
        <span className={cn("ml-auto flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide", active ? "text-emerald-700" : "text-muted-foreground")}>
          <i className={cn("h-1.5 w-1.5 rounded-full", active ? "animate-pulse bg-emerald-500" : "bg-muted-foreground/40")} />
          {active ? "active" : "off"}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">{children}</div>
    </div>
  )
}

export function SourceStatus({ frame, streams, science }: { frame: Frame | undefined; streams: { c2: boolean; c3: boolean }; science: boolean }) {
  const f = frame
  return (
    <div className="grid gap-2">
      <Row icon={Keyboard} label="C1 Behaviour" active color="#2A6FDB">
        <span>{f ? `${Math.round(f.c1.typingRate)} keys/min` : "—"}</span>
        <span>{f ? `${f.c1.switchRate.toFixed(1)} switches/min` : "—"}</span>
        <span>{f ? `${Math.round(f.c1.idleRatio * 100)}% idle` : "—"}</span>
        {science && f && <span className="font-mono">IKV {f.c1.interKeyVar.toFixed(2)}</span>}
      </Row>
      <Row icon={Thermometer} label="C2 Environment" active={streams.c2} color="#1E8E5A">
        {streams.c2 && f ? (
          <>
            <span>{Math.round(f.env.noise)} dB</span>
            <span>{f.env.temp.toFixed(1)} °C</span>
            <span>{Math.round(f.env.light)} lux</span>
          </>
        ) : (
          <span>Stream unavailable — fusion falls back gracefully.</span>
        )}
      </Row>
      <Row icon={Eye} label="C3 Vision" active={streams.c3} color="#D9711C">
        {streams.c3 && f ? (
          <>
            <span>{f.vision.zoneScreen >= f.vision.zoneDesk && f.vision.zoneScreen >= f.vision.zoneAway ? "looking at screen" : f.vision.zoneDesk >= f.vision.zoneAway ? "looking at desk" : "looking away"}</span>
            <span>phone {Math.round(f.vision.phoneInFrame * 100)}%</span>
            <span>face {Math.round(f.vision.validFace * 100)}%</span>
            {science && <span className="font-mono">read {f.vision.readingMotion.toFixed(2)}</span>}
          </>
        ) : (
          <span>Stream unavailable — behaviour + environment still score.</span>
        )}
      </Row>
    </div>
  )
}
