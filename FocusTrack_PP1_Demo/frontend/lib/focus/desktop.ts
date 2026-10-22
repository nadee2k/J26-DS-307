// Client for the optional FocusTrack C1 desktop agent (hardware/python_bridge/desktop_agent.py).
// The agent runs on 127.0.0.1 and exposes privacy-preserving input metadata from every
// application. When it is not running the C1 page falls back to browser-tab logging.

import type { InputEvent } from "./buffers"

export const AGENT_URL = (process.env.NEXT_PUBLIC_C1_AGENT_URL || "http://127.0.0.1:8765").replace(/\/+$/, "")
const SERVICE = "focustrack-c1-desktop"

export interface AgentInputStatus {
  ok: boolean
  backend: string
  error: string | null
}

export interface AgentWindowStatus {
  ok: boolean
  backend: string
  error: string | null
}

export interface AgentSession {
  startedAt: number
  mode: string | null
  task: string | null
  epochSec: number
}

export interface AgentHealth {
  ok: boolean
  service: string
  version: string
  /** True when the keyboard/mouse listener is actually running. */
  ready: boolean
  platform: string
  input: AgentInputStatus
  window: AgentWindowStatus
  recording: boolean
  activeApp: string | null
  count: number
  session: AgentSession | null
}

export interface AgentStartInput {
  mode: string
  task: string
  epochSec: number
}

export interface AgentStartResponse {
  ok: boolean
  startedAt: number
  cursor: number
  mode: string | null
  task: string | null
  epochSec: number
}

export interface AgentStopResponse {
  ok: boolean
  stoppedAt: number
  count: number
}

export interface AgentEventsResponse {
  ok: boolean
  /** Server wall-clock time in milliseconds, on the same machine as the browser. */
  now: number
  /** Sequence cursor to send back as `since`. */
  cursor: number
  events: InputEvent[]
  more: boolean
  recording: boolean
  activeApp: string | null
}

const KINDS = new Set(["key", "back", "click", "move", "scroll", "leave", "return", "switch"])

/** Validate one raw agent event. Unknown fields (including any key content) are dropped. */
export function sanitizeAgentEvent(raw: unknown): InputEvent | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const t = Number(r.t)
  const kind = String(r.kind ?? "")
  if (!Number.isFinite(t) || t <= 0 || !KINDS.has(kind)) return null
  const event: InputEvent = { t, kind: kind as InputEvent["kind"] }
  if (kind === "move") {
    const dist = Number(r.dist)
    if (!Number.isFinite(dist) || dist <= 0) return null
    event.dist = dist
  }
  if (kind === "switch" && typeof r.app === "string" && r.app.trim()) {
    event.app = r.app.trim().slice(0, 60)
  }
  return event
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 2500): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${AGENT_URL}${path}`, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      headers: init.body ? { "Content-Type": "application/json" } : undefined,
    })
    if (!res.ok) throw new Error(`Desktop agent returned HTTP ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

/** Returns null when the agent is not running or is not the expected service. */
export async function probeAgent(timeoutMs = 1200): Promise<AgentHealth | null> {
  try {
    const health = await request<AgentHealth>("/health", {}, timeoutMs)
    if (!health || !health.ok || health.service !== SERVICE) return null
    if (!health.input || typeof health.input.ok !== "boolean" || !health.window || typeof health.window.ok !== "boolean") return null
    return {
      ...health,
      ready: Boolean(health.ready),
      recording: Boolean(health.recording),
      activeApp: typeof health.activeApp === "string" ? health.activeApp : null,
      session: health.session ?? null,
    }
  } catch {
    return null
  }
}

export const c1Agent = {
  health: (timeoutMs = 1200) => probeAgent(timeoutMs),

  start: (input: AgentStartInput) =>
    request<AgentStartResponse>("/session/start", {
      method: "POST",
      body: JSON.stringify({ mode: input.mode, task: input.task, epochSec: input.epochSec }),
    }),

  stop: () => request<AgentStopResponse>("/session/stop", { method: "POST", body: "{}" }, 1500),

  events: async (since: number, limit = 5000): Promise<AgentEventsResponse> => {
    const raw = await request<AgentEventsResponse>(`/events?since=${Math.max(0, Math.floor(since))}&limit=${limit}`, {}, 2500)
    return {
      ok: Boolean(raw?.ok),
      now: Number(raw?.now) || Date.now(),
      cursor: Number(raw?.cursor) >= 0 ? Number(raw.cursor) : since,
      events: Array.isArray(raw?.events) ? raw.events.map(sanitizeAgentEvent).filter((e): e is InputEvent => e !== null) : [],
      more: Boolean(raw?.more),
      recording: Boolean(raw?.recording),
      activeApp: typeof raw?.activeApp === "string" ? raw.activeApp : null,
    }
  },
}
