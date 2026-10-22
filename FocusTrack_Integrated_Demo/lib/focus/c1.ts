// Component 1 – interaction features for one epoch, from timing metadata only.
// The logger records when a key was pressed and whether it was Backspace/Delete – never which key or any text.

import type { InputEvent } from "./buffers"
import type { C1Features } from "./types"

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) }

export interface StateModel {
  assign: (raw: number[]) => number
  labels: string[]
}

/** The activity vector used for interaction states (typing, idle, mouse, switching – same as the simulator). */
export const c1Raw = (f: Pick<C1Features, "typingRate" | "idleRatio" | "mouseSpeed" | "switchRate">) =>
  [f.typingRate, f.idleRatio, f.mouseSpeed, f.switchRate]

export function computeC1(events: InputEvent[], from: number, to: number, awayAtStart: boolean, prevStates: number[], states: StateModel | null): C1Features {
  const dur = Math.max(1, (to - from) / 1000)
  const minutes = dur / 60
  const keys = events.filter((e) => e.kind === "key" || e.kind === "back")
  const backs = keys.filter((e) => e.kind === "back").length
  const ikis: number[] = []
  for (let i = 1; i < keys.length; i++) { const d = keys[i].t - keys[i - 1].t; if (d > 0 && d < 2000) ikis.push(d) }
  const activeSeconds = new Set<number>()
  for (const e of events) if (e.kind !== "leave" && e.kind !== "return") activeSeconds.add(Math.floor((e.t - from) / 1000))
  // time the app was hidden or unfocused during the epoch
  let away = awayAtStart, last = from, awayMs = 0
  for (const e of events) {
    if (e.kind === "leave" || e.kind === "return") {
      if (away) awayMs += e.t - last
      away = e.kind === "leave"; last = e.t
    }
  }
  if (away) awayMs += to - last
  // rhythm and corrections are only meaningful with enough key presses; otherwise neutral values (as in the simulator)
  const typed = keys.length >= 5 && ikis.length >= 3
  const f = {
    typingRate: keys.length / minutes,
    interKeyVar: typed ? Math.min(2, sd(ikis) / (mean(ikis) || 1)) : 0.55,
    backspaceRatio: typed ? backs / keys.length : 0.12,
    idleRatio: Math.max(0, 1 - activeSeconds.size / dur),
    mouseSpeed: events.filter((e) => e.kind === "move").reduce((s, e) => s + (e.dist ?? 0), 0) / dur,
    // Browser mode counts leaving this tab; desktop mode counts foreground app changes.
    switchRate: events.filter((e) => e.kind === "leave" || e.kind === "switch").length / minutes,
    scrollRate: events.filter((e) => e.kind === "scroll").length / minutes,
  }
  const state = states ? states.assign(c1Raw(f)) : 0
  const hist = [...prevStates, state]
  let dwell = 1
  for (let i = hist.length - 2; i >= 0 && hist[i] === state; i--) dwell++
  const recent = hist.slice(-6)
  const changes = recent.slice(1).filter((v, i) => v !== recent[i]).length
  return {
    ...f,
    keyboardActive: f.typingRate > 10,
    state,
    stateLabel: states ? states.labels[state] : "–",
    dwell,
    changes,
    awayShare: Math.min(1, awayMs / (to - from)),
  }
}
