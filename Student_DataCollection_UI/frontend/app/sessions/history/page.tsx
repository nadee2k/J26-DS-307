"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { History, Clock, MapPin, CheckCircle, Play, Pause, Square, ChevronDown, ChevronUp, Pencil, X, Check } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { AppShell } from "@/components/layout/app-shell"
import { useAuth } from "@/hooks/use-auth"
import { sessions } from "@/lib/api"
import { TASK_OPTIONS, STUDY_LOCATION_OPTIONS } from "@/lib/constants"
import type { StudySession } from "@/types"

export default function HistoryPage() {
  const { student, isLoading } = useAuth()
  const router = useRouter()
  const [allSessions, setAllSessions] = useState<StudySession[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 10

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTaskType, setEditTaskType] = useState("")
  const [editLocation, setEditLocation] = useState("")
  const [editDuration, setEditDuration] = useState("")

  useEffect(() => {
    if (!isLoading && !student) {
      router.push("/login")
    }
  }, [student, isLoading, router])

  useEffect(() => {
    if (student) {
      setLoading(true)
      sessions.list(page, pageSize, student.id).then((res) => {
        setAllSessions(res.items)
        setTotal(res.total)
        setLoading(false)
      }).catch(() => setLoading(false))
    }
  }, [student, page])

  const refreshSessions = () => {
    if (student) {
      sessions.list(page, pageSize, student.id).then((res) => {
        setAllSessions(res.items)
        setTotal(res.total)
      }).catch(() => {})
    }
  }

  const formatDuration = (start: string | null, end: string | null) => {
    if (!start) return "-"
    const s = new Date(start).getTime()
    const e = end ? new Date(end).getTime() : Date.now()
    const diff = Math.floor((e - s) / 1000)
    const h = Math.floor(diff / 3600)
    const m = Math.floor((diff % 3600) / 60)
    const sec = diff % 60
    if (h > 0) return `${h}h ${m}m`
    if (m > 0) return `${m}m ${sec}s`
    return `${sec}s`
  }

  const getTaskLabel = (value: string) => TASK_OPTIONS.find((o) => o.value === value)?.label || value
  const getLocationLabel = (value: string | null) => STUDY_LOCATION_OPTIONS.find((o) => o.value === value)?.label || value || "N/A"

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id)
    setEditingId(null)
  }

  const startEditing = (s: StudySession) => {
    setEditingId(s.id)
    setEditTaskType(s.taskType)
    setEditLocation(s.location || "")
    setEditDuration(s.expectedDuration ? String(s.expectedDuration) : "")
  }

  const cancelEditing = () => {
    setEditingId(null)
  }

  const saveEditing = async (id: string) => {
    try {
      const updated = await sessions.update(id, {
        taskType: editTaskType as any,
        location: (editLocation as any) || null,
        expectedDuration: editDuration ? parseInt(editDuration) : null,
      })
      setAllSessions((prev) => prev.map((s) => (s.id === id ? updated : s)))
      setEditingId(null)
    } catch {
      console.error("Failed to update session")
    }
  }

  const handlePauseResume = async (s: StudySession) => {
    try {
      const updated = s.status === "running"
        ? await sessions.pause(s.id)
        : await sessions.resume(s.id)
      setAllSessions((prev) => prev.map((sess) => (sess.id === s.id ? updated : sess)))
    } catch {
      console.error("Failed to toggle session")
    }
  }

  const handleStop = async (s: StudySession) => {
    try {
      const updated = await sessions.stop(s.id)
      setAllSessions((prev) => prev.map((sess) => (sess.id === s.id ? updated : sess)))
    } catch {
      console.error("Failed to stop session")
    }
  }

  const isRunning = (s: StudySession) => s.status === "running" || s.status === "paused"

  if (isLoading || !student) return null

  return (
    <AppShell studentName={student.name}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Sessions</h1>
          <p className="text-sm text-muted-foreground">
            {total} total session{total !== 1 ? "s" : ""} recorded
          </p>
        </div>

        {loading ? (
          <Card className="border-border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">Loading sessions...</p>
          </Card>
        ) : allSessions.length === 0 ? (
          <Card className="border-border bg-card p-8 text-center">
            <History className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No sessions yet</p>
            <p className="text-xs text-muted-foreground">Start a study session to begin collecting data</p>
          </Card>
        ) : (
          <div className="grid gap-3">
            {allSessions.map((s) => {
              const expanded = expandedId === s.id
              const editing = editingId === s.id
              const active = isRunning(s)

              return (
                <Card key={s.id} className="border-border bg-card">
                  <div
                    className="flex cursor-pointer items-center gap-3 p-4 hover:bg-secondary/30"
                    onClick={() => toggleExpand(s.id)}
                  >
                    <span className={`inline-flex h-2 w-2 shrink-0 rounded-full ${
                      s.status === "completed" ? "bg-emerald-400" :
                      s.status === "running" ? "bg-amber-400" : "bg-muted-foreground"
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{getTaskLabel(s.taskType)}</span>
                        <span className={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold ring-1 ring-inset ${
                          s.status === "completed"
                            ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20"
                            : s.status === "running"
                            ? "bg-amber-500/10 text-amber-400 ring-amber-500/20"
                            : "bg-secondary text-muted-foreground ring-border"
                        }`}>
                          {s.status.toUpperCase()}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(s.createdAt).toLocaleDateString()} {new Date(s.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {getLocationLabel(s.location)}
                        </span>
                        <span className="flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" />
                          {formatDuration(s.startedAt, s.endedAt)}
                        </span>
                      </div>
                    </div>
                    {expanded ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  </div>

                  {expanded && (
                    <div className="border-t border-border px-4 py-4">
                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                        <div>
                          <p className="text-[10px] font-medium uppercase text-muted-foreground">Task</p>
                          {editing ? (
                            <Select value={editTaskType} onValueChange={setEditTaskType}>
                              <SelectTrigger className="mt-1 h-8 text-xs" onClick={(e) => e.stopPropagation()}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TASK_OPTIONS.map((o) => (
                                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <p className="mt-1 text-sm font-medium">{getTaskLabel(s.taskType)}</p>
                          )}
                        </div>
                        <div>
                          <p className="text-[10px] font-medium uppercase text-muted-foreground">Location</p>
                          {editing ? (
                            <Select value={editLocation} onValueChange={setEditLocation}>
                              <SelectTrigger className="mt-1 h-8 text-xs" onClick={(e) => e.stopPropagation()}>
                                <SelectValue placeholder="None" />
                              </SelectTrigger>
                              <SelectContent>
                                {STUDY_LOCATION_OPTIONS.map((o) => (
                                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <p className="mt-1 text-sm font-medium">{getLocationLabel(s.location)}</p>
                          )}
                        </div>
                        <div>
                          <p className="text-[10px] font-medium uppercase text-muted-foreground">Duration</p>
                          {editing ? (
                            <Input
                              type="number"
                              value={editDuration}
                              onChange={(e) => setEditDuration(e.target.value)}
                              placeholder="min"
                              min={1}
                              className="mt-1 h-8 text-xs"
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <p className="mt-1 text-sm font-medium">
                              {s.expectedDuration ? `${s.expectedDuration} min` : "-"}
                            </p>
                          )}
                        </div>
                        <div>
                          <p className="text-[10px] font-medium uppercase text-muted-foreground">Status</p>
                          <p className="mt-1 text-sm font-medium capitalize">{s.status}</p>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <div>
                          <span className="font-medium">Started:</span>{" "}
                          {s.startedAt ? new Date(s.startedAt).toLocaleTimeString() : "-"}
                        </div>
                        <div>
                          <span className="font-medium">Ended:</span>{" "}
                          {s.endedAt ? new Date(s.endedAt).toLocaleTimeString() : "-"}
                        </div>
                        <div>
                          <span className="font-medium">Created:</span>{" "}
                          {new Date(s.createdAt).toLocaleString()}
                        </div>
                        <div>
                          <span className="font-medium">Session ID:</span>{" "}
                          <span className="font-mono text-[10px]">{s.id.slice(0, 8)}...</span>
                        </div>
                      </div>

                      {active && (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {editing ? (
                            <>
                              <button
                                onClick={(e) => { e.stopPropagation(); saveEditing(s.id) }}
                                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                              >
                                <Check className="h-3 w-3" /> Save Changes
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); cancelEditing() }}
                                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary"
                              >
                                <X className="h-3 w-3" /> Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={(e) => { e.stopPropagation(); startEditing(s) }}
                                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary"
                              >
                                <Pencil className="h-3 w-3" /> Edit
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handlePauseResume(s) }}
                                className="flex items-center gap-1.5 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/20"
                              >
                                {s.status === "running" ? (
                                  <><Pause className="h-3 w-3" /> Pause</>
                                ) : (
                                  <><Play className="h-3 w-3" /> Resume</>
                                )}
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleStop(s) }}
                                className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500"
                              >
                                <Square className="h-3 w-3" /> Stop &amp; Save
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )}

        {total > pageSize && (
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-xs text-muted-foreground">
              Page {page} of {Math.ceil(total / pageSize)}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(Math.ceil(total / pageSize), p + 1))}
              disabled={page >= Math.ceil(total / pageSize)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </AppShell>
  )
}
