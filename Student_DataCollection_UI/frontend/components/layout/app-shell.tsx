"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Activity, LayoutDashboard, User, Play, History, LogOut } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { StudentAvatar } from "@/components/features/student/student-avatar"

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/profile", label: "Student Profile", icon: User },
  { href: "/sessions", label: "Study Session", icon: Play },
  { href: "/sessions/history", label: "My Sessions", icon: History },
]

export function AppShell({ children, studentName }: { children: React.ReactNode; studentName?: string }) {
  const pathname = usePathname()
  const { student } = useAuth()
  const name = studentName ?? student?.name

  return (
    <div className="flex h-screen text-foreground">
      <aside className="flex w-64 flex-col bg-[#2a1840] text-[#f6f1e8]">
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
            <Activity className="h-5 w-5 text-[#e4d4f0]" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-white">Focus Track</h1>
            <p className="text-[11px] text-[#c4b0d6]">Student research collector</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-2xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-white/10 text-white shadow-sm ring-1 ring-white/15"
                    : "text-[#c4b0d6] hover:bg-white/10 hover:text-white"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="border-t border-white/10 p-3">
          {name && (
            <div className="mb-2 flex items-center gap-3 rounded-2xl bg-white/10 px-3 py-2.5 ring-1 ring-white/10">
              <StudentAvatar gender={student?.gender} name={name} className="h-11 w-11" />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-[#c4b0d6]">Logged in as</p>
                <p className="truncate text-sm font-semibold text-white">{name}</p>
              </div>
            </div>
          )}
          <Link
            href="/login"
            className="flex items-center gap-2.5 rounded-2xl px-3 py-2.5 text-sm font-medium text-[#c4b0d6] transition-colors hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            Switch User
          </Link>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="mx-auto h-full max-w-6xl px-6 py-8">
          {children}
        </div>
      </main>
    </div>
  )
}
