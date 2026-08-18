"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { LayoutDashboard, User, Play, History, Keyboard, Eye } from "lucide-react"
import { Card } from "@/components/ui/card"
import { AppShell } from "@/components/layout/app-shell"
import { SwayFlower } from "@/components/features/decor/sway-flower"
import { Esp32ConnectPanel } from "@/components/features/telemetry/esp32-connect-panel"
import { useAuth } from "@/hooks/use-auth"
import { sessions } from "@/lib/api"
import { formatSriLankaDate, formatSriLankaTime } from "@/lib/utils"
import { useBehavior } from "@/hooks/use-behavior"
import type { StudySession } from "@/types"
import Link from "next/link"

export default function DashboardPage() {
  const { student, isLoading } = useAuth()
  const { collecting: behaviorCollecting, lastSnapshot } = useBehavior()
  const router = useRouter()
  const [recentSessions, setRecentSessions] = useState<StudySession[]>([])
  const [stats, setStats] = useState({ total: 0, completed: 0, running: 0 })

  useEffect(() => {
    if (!isLoading && !student) {
      router.push("/login")
    }
  }, [student, isLoading, router])

  useEffect(() => {
    if (student) {
      sessions.list(1, 5, student.id).then((res) => {
        setRecentSessions(res.items)
        setStats({
          total: res.total,
          completed: res.items.filter((s) => s.status === "completed").length,
          running: res.items.filter((s) => s.status === "running").length,
        })
      }).catch(() => {})
    }
  }, [student])

  if (isLoading || !student) return null

  return (
    <AppShell studentName={student.name}>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-[#8b6bb0]">Focus Track</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">Welcome, {student.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Collect study-session data for the research project.</p>
          </div>
          <SwayFlower />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-[#eadfce] bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#efe6f4]">
                <Play className="h-5 w-5 text-[#7b3fa0]" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-xs text-muted-foreground">Total Sessions</p>
              </div>
            </div>
          </Card>
          <Card className="border-[#eadfce] bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e4d4f0]">
                <History className="h-5 w-5 text-[#6b4c9a]" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.completed}</p>
                <p className="text-xs text-muted-foreground">Completed</p>
              </div>
            </div>
          </Card>
          <Card className="border-[#eadfce] bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f3eee6]">
                <LayoutDashboard className="h-5 w-5 text-[#8b6bb0]" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.running}</p>
                <p className="text-xs text-muted-foreground">Running Now</p>
              </div>
            </div>
          </Card>
          <Card className="border-[#eadfce] bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#c4b0d6]/40">
                <User className="h-5 w-5 text-[#3d2a5c]" />
              </div>
              <div>
                <p className="text-lg font-bold truncate">{student.university || "N/A"}</p>
                <p className="text-xs text-muted-foreground">University</p>
              </div>
            </div>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-[#eadfce] bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider">Quick Actions</h2>
            <div className="grid gap-2">
              <Link
                href="/sessions"
                className="flex items-center gap-3 rounded-md border border-border bg-background/40 px-4 py-3 transition-colors hover:bg-secondary"
              >
                <Play className="h-4 w-4 text-[#7b3fa0]" />
                <div>
                  <p className="text-sm font-medium">Start New Session</p>
                  <p className="text-xs text-muted-foreground">Create a study session and collect data</p>
                </div>
              </Link>
              <Link
                href="/profile"
                className="flex items-center gap-3 rounded-md border border-border bg-background/40 px-4 py-3 transition-colors hover:bg-secondary"
              >
                <User className="h-4 w-4 text-primary" />
                <div>
                  <p className="text-sm font-medium">Edit Profile</p>
                  <p className="text-xs text-muted-foreground">Update your student information</p>
                </div>
              </Link>
              <Link
                href="/sessions/history"
                className="flex items-center gap-3 rounded-md border border-border bg-background/40 px-4 py-3 transition-colors hover:bg-secondary"
              >
                <History className="h-4 w-4 text-amber-400" />
                <div>
                  <p className="text-sm font-medium">View Session History</p>
                  <p className="text-xs text-muted-foreground">Browse all your past study sessions</p>
                </div>
              </Link>
            </div>
          </Card>

          <Card className="border-[#eadfce] bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider">Data Sources</h2>
            <div className="grid gap-2">
              <Esp32ConnectPanel />
              <div className="rounded-xl border border-[#d9d4cc] bg-[#e8e8e8] px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Keyboard className="h-4 w-4 text-[#7b3fa0]" />
                    <span className="text-sm font-medium">Behavior Logger</span>
                  </div>
                  <span className={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold ring-1 ring-inset ${
                    behaviorCollecting
                      ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20"
                      : "bg-red-500/10 text-red-400 ring-red-500/20"
                  }`}>
                    {behaviorCollecting ? "ACTIVE" : "INACTIVE"}
                  </span>
                </div>
                {behaviorCollecting && lastSnapshot && (
                  <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                    keys {lastSnapshot.keyboardCount} · mouse {Math.round(lastSnapshot.mouseMovement)}px ·
                    clicks {lastSnapshot.mouseClicks} · idle {lastSnapshot.idleTime}s
                  </p>
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Starts only if you allow it when beginning a study session.
                </p>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-[#d9d4cc] bg-[#e8e8e8] px-4 py-3">
                <div className="flex items-center gap-3">
                  <Eye className="h-4 w-4 text-[#7b3fa0]" />
                  <span className="text-sm font-medium">Vision Logger</span>
                </div>
                <span className="rounded-sm bg-red-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-red-400 ring-1 ring-inset ring-red-500/20">
                  INACTIVE
                </span>
              </div>
            </div>
          </Card>
        </div>

        {recentSessions.length > 0 && (
          <Card className="border-[#eadfce] bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider">Recent Sessions</h2>
            <div className="grid gap-2">
              {recentSessions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded-md border border-border bg-background/40 px-4 py-2"
                >
                  <div>
                    <p className="text-sm font-medium">{s.taskType}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatSriLankaDate(s.createdAt)} {formatSriLankaTime(s.createdAt)}
                    </p>
                  </div>
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
              ))}
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  )
}
