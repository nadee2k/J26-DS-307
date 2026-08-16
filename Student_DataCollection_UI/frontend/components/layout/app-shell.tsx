"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Activity, LayoutDashboard, User, Play, History, LogOut } from "lucide-react"

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/profile", label: "Student Profile", icon: User },
  { href: "/sessions", label: "Study Session", icon: Play },
  { href: "/sessions/history", label: "My Sessions", icon: History },
]

export function AppShell({ children, studentName }: { children: React.ReactNode; studentName?: string }) {
  const pathname = usePathname()

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="flex w-60 flex-col border-r border-border bg-card">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/30">
            <Activity className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">
              FocusTrack <span className="font-mono text-primary">v1.0</span>
            </h1>
            <p className="text-[10px] text-muted-foreground">Data Collector</p>
          </div>
        </div>

        <nav className="flex-1 gap-1 p-3">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="border-t border-border p-3">
          {studentName && (
            <div className="mb-2 rounded-md bg-secondary/40 px-3 py-2">
              <p className="text-[10px] text-muted-foreground">Logged in as</p>
              <p className="text-xs font-semibold text-foreground truncate">{studentName}</p>
            </div>
          )}
          <Link
            href="/login"
            className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            Switch User
          </Link>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="mx-auto h-full max-w-6xl px-6 py-6">
          {children}
        </div>
      </main>
    </div>
  )
}
