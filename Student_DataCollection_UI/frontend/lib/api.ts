import type {
  Student,
  StudySession,
  ConcentrationLog,
  EnvironmentLog,
  BehaviorLog,
  VisionLog,
  TelemetryStream,
  PaginatedResponse,
  TelemetryStreamState,
} from "@/types"
import { getSupabase } from "@/lib/supabase"

const ACTIVE_THRESHOLD_SECONDS = 5

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

function iso(value: string | null | undefined): string | null {
  if (!value) return null
  return value
}

function mapStudent(row: Record<string, unknown>): Student {
  return {
    id: String(row.id),
    name: String(row.name),
    age: Number(row.age),
    gender: row.gender as Student["gender"],
    university: (row.university as string | null) ?? null,
    faculty: (row.faculty as string | null) ?? null,
    degree: (row.degree as string | null) ?? null,
    learningType: (row.learning_type as Student["learningType"]) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function mapSession(row: Record<string, unknown>): StudySession {
  return {
    id: String(row.id),
    studentId: String(row.student_id),
    taskType: row.task_type as StudySession["taskType"],
    location: (row.location as StudySession["location"]) ?? null,
    expectedDuration: (row.expected_duration as number | null) ?? null,
    status: row.status as StudySession["status"],
    startedAt: iso(row.started_at as string | null),
    pausedAt: iso(row.paused_at as string | null),
    endedAt: iso(row.ended_at as string | null),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function mapEnvironment(row: Record<string, unknown>): EnvironmentLog {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    temperature: (row.temperature as number | null) ?? null,
    humidity: (row.humidity as number | null) ?? null,
    light: (row.light as number | null) ?? null,
    noise: (row.noise as number | null) ?? null,
    motion: (row.motion as boolean | null) ?? null,
    accX: (row.acc_x as number | null) ?? null,
    accY: (row.acc_y as number | null) ?? null,
    accZ: (row.acc_z as number | null) ?? null,
    gyroX: (row.gyro_x as number | null) ?? null,
    gyroY: (row.gyro_y as number | null) ?? null,
    gyroZ: (row.gyro_z as number | null) ?? null,
    distance: (row.distance as number | null) ?? null,
    radarState: (row.radar_state as string | null) ?? null,
    createdAt: String(row.created_at),
  }
}

function mapBehavior(row: Record<string, unknown>): BehaviorLog {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    keyboardCount: (row.keyboard_count as number | null) ?? 0,
    mouseMovement: (row.mouse_distance as number | null) ?? 0,
    mouseClicks: (row.mouse_clicks as number | null) ?? 0,
    idleTime: (row.idle_time as number | null) ?? 0,
    activeApplication: (row.active_application as string | null) ?? null,
    createdAt: String(row.created_at),
  }
}

function mapVision(row: Record<string, unknown>): VisionLog {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    faceDetected: (row.face_detected as boolean | null) ?? null,
    eyeGaze: (row.eye_gaze as string | null) ?? null,
    headDirection: (row.head_direction as string | null) ?? null,
    phoneDetected: (row.phone_detected as boolean | null) ?? null,
    createdAt: String(row.created_at),
  }
}

function mapConcentration(row: Record<string, unknown>): ConcentrationLog {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    level: row.level as ConcentrationLog["level"],
    environment: row.environment as ConcentrationLog["environment"],
    notes: (row.notes as string | null) ?? null,
    recordedAt: String(row.recorded_at),
  }
}

function mapTelemetry(row: Record<string, unknown>): TelemetryStream {
  return {
    id: String(row.id),
    label: String(row.label),
    state: row.state as TelemetryStreamState,
  }
}

async function paginate<T>(
  table: string,
  map: (row: Record<string, unknown>) => T,
  page: number,
  pageSize: number,
  apply?: (query: ReturnType<ReturnType<typeof getSupabase>["from"]>) => ReturnType<ReturnType<typeof getSupabase>["from"]>,
): Promise<PaginatedResponse<T>> {
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  let query = getSupabase().from(table).select("*", { count: "exact" })
  if (apply) query = apply(query)
  const { data, error, count } = await query.range(from, to)
  throwIfError(error)
  const total = count ?? 0
  return {
    items: ((data ?? []) as Record<string, unknown>[]).map(map),
    total,
    page,
    pageSize,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  }
}

async function latestStatus(table: string, sessionId: string) {
  const supabase = getSupabase()
  const [{ data, error }, { count, error: countError }] = await Promise.all([
    supabase
      .from(table)
      .select("created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId),
  ])
  throwIfError(error)
  throwIfError(countError)

  const lastSeen = data?.[0]?.created_at ? String(data[0].created_at) : null
  const total = count ?? 0
  if (!lastSeen) {
    return { active: false, lastSeen: null, count: 0 }
  }

  const diff = (Date.now() - new Date(lastSeen).getTime()) / 1000
  return {
    active: diff < ACTIVE_THRESHOLD_SECONDS,
    lastSeen,
    count: total,
  }
}

async function updateSession(
  id: string,
  values: Record<string, unknown>,
): Promise<StudySession> {
  const { data, error } = await getSupabase()
    .from("study_sessions")
    .update(values)
    .eq("id", id)
    .select()
    .single()
  throwIfError(error)
  return mapSession(data as Record<string, unknown>)
}

export const students = {
  list: (page = 1, pageSize = 20) =>
    paginate("students", mapStudent, page, pageSize, (q) =>
      q.order("created_at", { ascending: false }),
    ),
  get: async (id: string) => {
    const { data, error } = await getSupabase().from("students").select("*").eq("id", id).single()
    throwIfError(error)
    return mapStudent(data as Record<string, unknown>)
  },
  create: async (data: Omit<Student, "id" | "createdAt" | "updatedAt">) => {
    const { data: row, error } = await getSupabase()
      .from("students")
      .insert({
        name: data.name,
        age: data.age,
        gender: data.gender,
        university: data.university ?? null,
        faculty: data.faculty ?? null,
        degree: data.degree ?? null,
        learning_type: data.learningType ?? null,
      })
      .select()
      .single()
    throwIfError(error)
    return mapStudent(row as Record<string, unknown>)
  },
  update: async (id: string, data: Partial<Student>) => {
    const row: Record<string, unknown> = {}
    if (data.name !== undefined) row.name = data.name
    if (data.age !== undefined) row.age = data.age
    if (data.gender !== undefined) row.gender = data.gender
    if (data.university !== undefined) row.university = data.university
    if (data.faculty !== undefined) row.faculty = data.faculty
    if (data.degree !== undefined) row.degree = data.degree
    if (data.learningType !== undefined) row.learning_type = data.learningType

    const { data: updated, error } = await getSupabase()
      .from("students")
      .update(row)
      .eq("id", id)
      .select()
      .single()
    throwIfError(error)
    return mapStudent(updated as Record<string, unknown>)
  },
  delete: async (id: string) => {
    const { error } = await getSupabase().from("students").delete().eq("id", id)
    throwIfError(error)
  },
}

export const sessions = {
  list: (page = 1, pageSize = 20, studentId?: string) =>
    paginate("study_sessions", mapSession, page, pageSize, (q) => {
      const filtered = studentId ? q.eq("student_id", studentId) : q
      return filtered.order("created_at", { ascending: false })
    }),
  get: async (id: string) => {
    const { data, error } = await getSupabase().from("study_sessions").select("*").eq("id", id).single()
    throwIfError(error)
    return mapSession(data as Record<string, unknown>)
  },
  create: async (data: Omit<StudySession, "id" | "createdAt" | "updatedAt">) => {
    const { data: row, error } = await getSupabase()
      .from("study_sessions")
      .insert({
        student_id: data.studentId,
        task_type: data.taskType,
        location: data.location ?? null,
        expected_duration: data.expectedDuration ?? null,
        status: data.status ?? "idle",
        started_at: data.startedAt ?? null,
        paused_at: data.pausedAt ?? null,
        ended_at: data.endedAt ?? null,
      })
      .select()
      .single()
    throwIfError(error)
    return mapSession(row as Record<string, unknown>)
  },
  update: (
    id: string,
    data: Partial<Pick<StudySession, "taskType" | "location" | "expectedDuration">>,
  ) => {
    const row: Record<string, unknown> = {}
    if (data.taskType !== undefined) row.task_type = data.taskType
    if (data.location !== undefined) row.location = data.location
    if (data.expectedDuration !== undefined) row.expected_duration = data.expectedDuration
    return updateSession(id, row)
  },
  start: (id: string) =>
    updateSession(id, {
      status: "running",
      started_at: new Date().toISOString(),
    }),
  pause: (id: string) =>
    updateSession(id, {
      status: "paused",
      paused_at: new Date().toISOString(),
    }),
  resume: (id: string) =>
    updateSession(id, {
      status: "running",
      paused_at: null,
    }),
  stop: (id: string) =>
    updateSession(id, {
      status: "completed",
      ended_at: new Date().toISOString(),
    }),
}

export const concentrationLogs = {
  list: (page = 1, pageSize = 20) =>
    paginate("concentration_logs", mapConcentration, page, pageSize, (q) =>
      q.order("recorded_at", { ascending: false }),
    ),
  getBySession: async (sessionId: string) => {
    const { data, error } = await getSupabase()
      .from("concentration_logs")
      .select("*")
      .eq("session_id", sessionId)
      .order("recorded_at", { ascending: false })
    throwIfError(error)
    return ((data ?? []) as Record<string, unknown>[]).map(mapConcentration)
  },
  create: async (data: Omit<ConcentrationLog, "id" | "recordedAt">) => {
    const { data: row, error } = await getSupabase()
      .from("concentration_logs")
      .insert({
        session_id: data.sessionId,
        level: data.level,
        environment: data.environment,
        notes: data.notes ?? null,
      })
      .select()
      .single()
    throwIfError(error)
    return mapConcentration(row as Record<string, unknown>)
  },
}

async function listLogs<T>(
  table: string,
  map: (row: Record<string, unknown>) => T,
  page: number,
  pageSize: number,
  sessionId?: string,
) {
  return paginate(table, map, page, pageSize, (q) => {
    const filtered = sessionId ? q.eq("session_id", sessionId) : q
    return filtered.order("created_at", { ascending: false })
  })
}

async function getLatestLog<T>(
  table: string,
  map: (row: Record<string, unknown>) => T,
  sessionId?: string,
) {
  let query = getSupabase().from(table).select("*").order("created_at", { ascending: false }).limit(1)
  if (sessionId) query = query.eq("session_id", sessionId)
  const { data, error } = await query
  throwIfError(error)
  const row = data?.[0]
  if (!row) throw new Error("No log found")
  return map(row as Record<string, unknown>)
}

export const environmentLogs = {
  list: (page = 1, pageSize = 100, sessionId?: string) =>
    listLogs("environment_logs", mapEnvironment, page, pageSize, sessionId),
  getLatest: (sessionId?: string) => getLatestLog("environment_logs", mapEnvironment, sessionId),
  create: async (data: Omit<EnvironmentLog, "id" | "createdAt">) => {
    const base = {
      session_id: data.sessionId,
      temperature: data.temperature ?? null,
      humidity: data.humidity ?? null,
      light: data.light ?? null,
      noise: data.noise ?? null,
      motion: data.motion ?? null,
    }
    const withImu = {
      ...base,
      acc_x: data.accX ?? null,
      acc_y: data.accY ?? null,
      acc_z: data.accZ ?? null,
      gyro_x: data.gyroX ?? null,
      gyro_y: data.gyroY ?? null,
      gyro_z: data.gyroZ ?? null,
      distance: data.distance ?? null,
      radar_state: data.radarState ?? null,
    }
    const first = await getSupabase().from("environment_logs").insert(withImu).select().single()
    if (!first.error) return mapEnvironment(first.data as Record<string, unknown>)
    const missingColumn = /column|schema cache|could not find/i.test(first.error.message ?? "")
    if (!missingColumn) throwIfError(first.error)
    const fallback = await getSupabase().from("environment_logs").insert(base).select().single()
    throwIfError(fallback.error)
    return mapEnvironment(fallback.data as Record<string, unknown>)
  },
}

export const behaviorLogs = {
  list: (page = 1, pageSize = 100, sessionId?: string) =>
    listLogs("behavior_logs", mapBehavior, page, pageSize, sessionId),
  getLatest: (sessionId?: string) => getLatestLog("behavior_logs", mapBehavior, sessionId),
  create: async (data: Omit<BehaviorLog, "id" | "createdAt">) => {
    const { data: row, error } = await getSupabase()
      .from("behavior_logs")
      .insert({
        session_id: data.sessionId,
        keyboard_count: data.keyboardCount ?? 0,
        mouse_distance: data.mouseMovement ?? 0,
        mouse_clicks: data.mouseClicks ?? 0,
        idle_time: data.idleTime ?? 0,
        active_application: data.activeApplication ?? null,
      })
      .select()
      .single()
    throwIfError(error)
    return mapBehavior(row as Record<string, unknown>)
  },
}

export const visionLogs = {
  list: (page = 1, pageSize = 100, sessionId?: string) =>
    listLogs("vision_logs", mapVision, page, pageSize, sessionId),
  getLatest: (sessionId?: string) => getLatestLog("vision_logs", mapVision, sessionId),
  create: async (data: Omit<VisionLog, "id" | "createdAt">) => {
    const { data: row, error } = await getSupabase()
      .from("vision_logs")
      .insert({
        session_id: data.sessionId,
        face_detected: data.faceDetected ?? null,
        eye_gaze: data.eyeGaze ?? null,
        head_direction: data.headDirection ?? null,
        phone_detected: data.phoneDetected ?? null,
      })
      .select()
      .single()
    throwIfError(error)
    return mapVision(row as Record<string, unknown>)
  },
}

export const telemetryStreams = {
  list: async () => {
    const { data, error } = await getSupabase().from("telemetry_streams").select("*")
    throwIfError(error)
    return ((data ?? []) as Record<string, unknown>[]).map(mapTelemetry)
  },
  activate: (id: string) => setTelemetryState(id, "ACTIVE"),
  deactivate: (id: string) => setTelemetryState(id, "INACTIVE"),
  standby: (id: string) => setTelemetryState(id, "STANDBY"),
}

async function setTelemetryState(id: string, state: TelemetryStreamState) {
  const { data, error } = await getSupabase()
    .from("telemetry_streams")
    .update({ state })
    .eq("id", id)
    .select()
    .single()
  throwIfError(error)
  return mapTelemetry(data as Record<string, unknown>)
}

export interface DataSourceStatus {
  active: boolean
  lastSeen: string | null
  count: number
}

export interface DataSourcesStatus {
  environment: DataSourceStatus
  behavior: DataSourceStatus
  vision: DataSourceStatus
}

export const dataSources = {
  status: async (sessionId: string): Promise<DataSourcesStatus> => {
    const [environment, behavior, vision] = await Promise.all([
      latestStatus("environment_logs", sessionId),
      latestStatus("behavior_logs", sessionId),
      latestStatus("vision_logs", sessionId),
    ])
    return { environment, behavior, vision }
  },
}
