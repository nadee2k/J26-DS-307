import { Activity } from "lucide-react"

export function TerminalHeader() {
  return (
    <header className="flex items-center justify-between border-b border-border pb-3">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/30">
          <Activity className="h-4 w-4 text-primary" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-base font-semibold tracking-tight text-foreground">
            FocusTrack Data Collector{" "}
            <span className="font-mono text-primary">v1.0</span>
          </h1>
          <p className="text-[11px] text-muted-foreground">
            Multimodal Data Collection Terminal
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2.5 rounded-md border border-border bg-card px-3 py-1.5">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </span>
        <span className="text-xs font-medium text-muted-foreground">
          System Status:{" "}
          <span className="font-semibold text-emerald-400">Ready</span>
        </span>
      </div>
    </header>
  )
}
