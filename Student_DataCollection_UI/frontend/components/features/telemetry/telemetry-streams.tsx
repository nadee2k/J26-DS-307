import { Radio } from "lucide-react"
import { Card } from "@/components/ui/card"
import { DEFAULT_TELEMETRY_STREAMS } from "@/lib/constants"

export function TelemetryStreams() {
  return (
    <Card className="flex flex-col gap-2.5 border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Radio className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
          Telemetry Streams
        </h2>
      </div>

      <div className="grid gap-2">
        {DEFAULT_TELEMETRY_STREAMS.map((stream) => (
          <div
            key={stream.label}
            className="flex items-center justify-between rounded-md border border-border bg-background/40 px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
              </span>
              <span className="font-mono text-[11px] text-foreground">
                {stream.label}
              </span>
            </div>
            <span className="rounded-sm bg-red-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-red-400 ring-1 ring-inset ring-red-500/20">
              {stream.state}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}
