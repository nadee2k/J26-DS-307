"use client"

import { Keyboard } from "lucide-react"

export function BehaviorEnablePanel({
  enabled,
  onChange,
  required = false,
}: {
  enabled: boolean
  onChange: (enabled: boolean) => void
  required?: boolean
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-4 transition-colors ${
        enabled
          ? "border-[#c4b0d6] bg-[#efe6f4]"
          : "border-[#d9d4cc] bg-[#e8e8e8]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-white ring-1 ring-[#d9d4cc]">
            <Keyboard className="h-4 w-4 text-[#7b3fa0]" />
          </div>
          <div>
            <p className="text-sm font-semibold">Behavior Logger</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Logs keyboard presses, mouse movement, clicks, and idle time in this tab.
              Enable this to give permission.
            </p>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold ring-1 ring-inset ${
            enabled
              ? "bg-[#efe6f4] text-[#7b3fa0] ring-[#c4b0d6]"
              : "bg-red-500/10 text-red-600 ring-red-200"
          }`}
        >
          {enabled ? "ENABLED" : "OFF"}
        </span>
      </div>
      <button
        type="button"
        onClick={() => onChange(!enabled)}
        className={`mt-4 w-full rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
          enabled
            ? "border border-[#d9d4cc] bg-white text-[#3d2a5c] hover:bg-[#f3eee6]"
            : "bg-[#7b3fa0] text-white hover:bg-[#6b4c9a]"
        }`}
      >
        {enabled ? "Disable behavior logging" : "Enable behavior logging"}
      </button>
    </div>
  )
}
