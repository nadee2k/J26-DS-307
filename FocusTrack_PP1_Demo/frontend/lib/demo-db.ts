// Demo mode: a tiny in-browser stand-in for the Supabase client, used when no Supabase keys are configured
// (or NEXT_PUBLIC_DEMO_MODE=1). It supports only the query subset lib/api.ts uses and keeps data in localStorage,
// so the whole app can be demonstrated offline. Nothing here is real participant data.

type Row = Record<string, unknown>
type Result = { data: unknown; error: { message: string } | null; count?: number | null }

const KEY = "focustrack_demo_db_v1"
const TABLES = ["students", "study_sessions", "concentration_logs", "environment_logs", "behavior_logs", "vision_logs", "c1_epochs", "telemetry_streams"]
const MAX_LOG_ROWS = 4000

function load(): Record<string, Row[]> {
  if (typeof window === "undefined") return Object.fromEntries(TABLES.map((t) => [t, []]))
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* storage unavailable – start empty */ }
  const db: Record<string, Row[]> = Object.fromEntries(TABLES.map((t) => [t, []]))
  db.telemetry_streams = ["ESP32 Sensor Stream", "Behavior Logger", "Vision Logger (Camera)"].map((label) => ({ id: uid(), label, state: "INACTIVE" }))
  return db
}
let DB = load()
// Writes are batched: serialising the whole store on every 1-Hz sensor insert made the page sluggish.
let saveTimer: ReturnType<typeof setTimeout> | null = null
function flush() {
  saveTimer = null
  for (const t of ["environment_logs", "behavior_logs", "vision_logs"]) if ((DB[t]?.length ?? 0) > MAX_LOG_ROWS) DB[t] = DB[t].slice(-MAX_LOG_ROWS)
  try { window.localStorage.setItem(KEY, JSON.stringify(DB)) } catch { /* quota or private mode – keep in memory */ }
}
function save() {
  if (typeof window === "undefined") return
  if (!saveTimer) saveTimer = setTimeout(flush, 1500)
}
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => { if (saveTimer) { clearTimeout(saveTimer); flush() } })
  // keep tabs in sync (e.g. the app open in two tabs during a demo)
  window.addEventListener("storage", (e) => { if (e.key === KEY && !saveTimer) DB = load() })
}
function uid() { return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) }

class Query implements PromiseLike<Result> {
  private filters: [string, unknown][] = []
  private orderBy: { col: string; asc: boolean } | null = null
  private lim: number | null = null
  private rng: [number, number] | null = null
  private wantSingle = false
  private countMode = false
  private headOnly = false
  private op: "select" | "insert" | "update" | "delete" = "select"
  private payload: Row | null = null
  constructor(private table: string) {}

  select(_cols = "*", opts?: { count?: string; head?: boolean }) { if (opts?.count) this.countMode = true; if (opts?.head) this.headOnly = true; return this }
  insert(row: Row) { this.op = "insert"; this.payload = row; return this }
  update(row: Row) { this.op = "update"; this.payload = row; return this }
  delete() { this.op = "delete"; return this }
  eq(col: string, val: unknown) { this.filters.push([col, val]); return this }
  order(col: string, opts?: { ascending?: boolean }) { this.orderBy = { col, asc: opts?.ascending ?? true }; return this }
  limit(n: number) { this.lim = n; return this }
  range(from: number, to: number) { this.rng = [from, to]; return this }
  single() { this.wantSingle = true; return this }

  private run(): Result {
    const now = new Date().toISOString()
    const rows = (DB[this.table] ??= [])
    const match = (r: Row) => this.filters.every(([c, v]) => r[c] === v)
    if (this.op === "insert") {
      const row: Row = { id: uid(), created_at: now, ...(this.table === "concentration_logs" ? { recorded_at: now } : {}), ...(this.table === "students" || this.table === "study_sessions" ? { updated_at: now } : {}), ...this.payload }
      rows.push(row); save()
      return { data: this.wantSingle ? row : [row], error: null }
    }
    if (this.op === "update") {
      const hit = rows.filter(match)
      hit.forEach((r) => Object.assign(r, this.payload, "updated_at" in r ? { updated_at: now } : {}))
      save()
      return { data: this.wantSingle ? hit[0] ?? null : hit, error: hit.length || !this.wantSingle ? null : { message: "Row not found" } }
    }
    if (this.op === "delete") { DB[this.table] = rows.filter((r) => !match(r)); save(); return { data: null, error: null } }
    let out = rows.filter(match)
    const total = out.length
    if (this.orderBy) { const { col, asc } = this.orderBy; out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1)) }
    if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1)
    if (this.lim !== null) out = out.slice(0, this.lim)
    if (this.wantSingle) return { data: out[0] ?? null, error: out[0] ? null : { message: "Row not found" } }
    return { data: this.headOnly ? null : out, error: null, count: this.countMode ? total : null }
  }
  then<T1 = Result, T2 = never>(ok?: ((v: Result) => T1 | PromiseLike<T1>) | null, fail?: ((e: unknown) => T2 | PromiseLike<T2>) | null): PromiseLike<T1 | T2> {
    return Promise.resolve().then(() => this.run()).then(ok, fail)
  }
}

export function createDemoClient() {
  return { from: (table: string) => new Query(table) }
}

export function isDemoMode() {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "1" || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
}

export function resetDemoData() {
  try { window.localStorage.removeItem(KEY) } catch { /* ignore */ }
  DB = load(); flush()
}
