"use client"

import { useState } from "react"
import { Gauge } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CONCENTRATION_LEVELS, ENVIRONMENT_OPTIONS } from "@/lib/constants"
import type { ConcentrationLevel } from "@/types"

export function ConcentrationSlider() {
  const [value, setValue] = useState<ConcentrationLevel>(3)

  return (
    <Card className="flex min-h-0 flex-col gap-3 border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Gauge className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
          Ground Truth
        </h2>
      </div>

      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">Concentration Level</span>
        <span className="font-mono text-2xl font-bold leading-none text-primary">
          {value}
          <span className="ml-1 text-sm font-normal text-muted-foreground">/5</span>
        </span>
      </div>
      <p className="text-sm font-medium text-foreground">{CONCENTRATION_LEVELS[value]}</p>

      <div className="grid gap-2 pt-1">
        <Slider
          value={[value]}
          onValueChange={(v) => setValue((Array.isArray(v) ? v[0] : v) as ConcentrationLevel)}
          min={1}
          max={5}
          step={1}
          aria-label="Self-reported concentration level"
        />
        <div className="flex items-center justify-between px-0.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setValue(n as ConcentrationLevel)}
              aria-label={`Set concentration to ${n}`}
              aria-pressed={value === n}
              className={`flex h-6 w-6 items-center justify-center rounded-md font-mono text-xs font-semibold transition-colors ${
                value === n
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between text-[11px] font-medium">
          <span className="text-red-400">1 · Distracted</span>
          <span className="text-primary">5 · Deep Focus</span>
        </div>
      </div>

      <div className="mt-auto grid gap-1.5 border-t border-border pt-3">
        <Label htmlFor="location" className="text-xs">
          Environment / Location
        </Label>
        <Select>
          <SelectTrigger id="location" className="h-9">
            <SelectValue placeholder="Select location" />
          </SelectTrigger>
          <SelectContent>
            {ENVIRONMENT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </Card>
  )
}
