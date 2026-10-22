"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Activity,
  Bell,
  ChevronRight,
  FlaskConical,
  History,
  LogOut,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Sparkles,
} from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { useDemo } from "@/hooks/use-demo"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const STEPS = [
  { href: "/demo/session", label: "Start" },
  { href: "/demo/live", label: "Live" },
  { href: "/demo/outcome", label: "Outcomes" },
  { href: "/demo/feedback", label: "Feedback" },
]

export function DemoShell({
  step,
  children,
  wide = false,
}: {
  step: 1 | 2 | 3 | 4
  children: React.ReactNode
  wide?: boolean
}) {
  const { student, setStudent } = useAuth()
  const { science, setScience, playing, setPlaying, speed, setSpeed, reset, finish, run, cursor, jumpToNextAlert } = useDemo()
  const router = useRouter()
  const pathname = usePathname()

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border/80 bg-[#fbf8f4]/90 backdrop-blur">
        <div className={cn("mx-auto flex items-center gap-4 px-5 py-3", wide ? "max-w-[1400px]" : "max-w-6xl")}>
          <Link href="/demo/session" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
              <Activity className="h-4.5 w-4.5 text-primary" />
            </span>
            <span className="hidden sm:block">
              <span className="block text-sm font-semibold leading-tight">FocusTrack</span>
              <span className="block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Integrated demo</span>
            </span>
          </Link>

          <nav className="mx-auto hidden items-center gap-1 md:flex">
            {STEPS.map((s, i) => {
              const n = i + 1
              const active = pathname === s.href
              const reached = n <= step
              return (
                <div key={s.href} className="flex items-center gap-1">
                  <Link
                    href={reached ? s.href : "#"}
                    aria-disabled={!reached}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                      active && "bg-secondary text-primary",
                      !active && reached && "text-muted-foreground hover:text-foreground",
                      !reached && "cursor-default text-muted-foreground/45",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded-full text-[9px]",
                        active ? "bg-primary text-white" : reached ? "bg-accent text-primary" : "bg-muted text-muted-foreground/60",
                      )}
                    >
                      {n}
                    </span>
                    {s.label}
                  </Link>
                  {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground/40" />}
                </div>
              )
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setScience(!science)}
              className={cn(
                "hidden items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors sm:flex",
                science ? "border-primary/30 bg-secondary text-primary" : "border-border text-muted-foreground hover:text-foreground",
              )}
              title="Reveal the model detail behind each screen"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              {science ? "Science on" : "Show the science"}
            </button>
            <Link
              href="/demo/history"
              className="hidden items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground lg:flex"
            >
              <History className="h-3.5 w-3.5" /> Progress
            </Link>
            {student && (
              <div className="flex items-center gap-2 rounded-full border border-border bg-white py-1 pl-1 pr-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-primary">
                  {student.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden text-[11px] font-medium sm:block">{student.name.split(" ")[0]}</span>
                <button
                  type="button"
                  onClick={() => {
                    setStudent(null)
                    reset()
                    router.push("/login")
                  }}
                  className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="Switch user"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {step === 2 && run && (
          <div className={cn("mx-auto flex flex-wrap items-center gap-2 px-5 pb-2.5", wide ? "max-w-[1400px]" : "max-w-6xl")}>
            <span className="mr-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <Sparkles className="h-3 w-3" /> Presenter
            </span>
            <Button size="sm" variant={playing ? "secondary" : "primary"} onClick={() => setPlaying(!playing)}>
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {playing ? "Pause" : "Play"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setPlaying(false)
                jumpToNextAlert()
              }}
            >
              <Bell className="h-3.5 w-3.5" /> Next alert
            </Button>
            <Button size="sm" variant="outline" onClick={() => { finish(); router.push("/demo/outcome") }}>
              <SkipForward className="h-3.5 w-3.5" /> Skip to outcome
            </Button>
            <div className="flex overflow-hidden rounded-lg border border-border">
              {[0.5, 1, 3].map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className={cn(
                    "px-2 py-1 text-[10px] font-semibold",
                    speed === s ? "bg-secondary text-primary" : "bg-white text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s}×
                </button>
              ))}
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                reset()
                router.push("/demo/session")
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Restart
            </Button>
            <span className="ml-auto text-[10px] text-muted-foreground">
              minute {cursor} of {run.frames.length - 1}
            </span>
          </div>
        )}
      </header>

      <main className={cn("mx-auto px-5 py-6", wide ? "max-w-[1400px]" : "max-w-6xl")}>{children}</main>

      <footer className="mx-auto max-w-6xl px-5 pb-8 pt-2 text-[10px] text-muted-foreground">
        Simulated learner, scored by the research models on this device. Demo data never enters the research database.
      </footer>
    </div>
  )
}

export function Panel({
  title,
  right,
  children,
  className,
}: {
  title?: string
  right?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(61,42,92,0.04)]", className)}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  )
}

export function Metric({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl bg-[#f7f3ed] px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-lg font-semibold leading-none">{value}</p>
      {hint && <p className="mt-1 text-[10px] leading-tight text-muted-foreground">{hint}</p>}
    </div>
  )
}
