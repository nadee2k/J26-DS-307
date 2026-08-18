"use client"

import { Thermometer } from "lucide-react"
import { useEsp32 } from "@/hooks/use-esp32"

export function Esp32ConnectPanel({ required = false }: { required?: boolean }) {
  const { supported, connected, connecting, error, lastReading, connect, disconnect } = useEsp32()

  return (
    <div
      className={`rounded-xl border px-4 py-4 transition-colors ${
        connected
          ? "border-[#c4b0d6] bg-[#efe6f4]"
          : "border-[#d9d4cc] bg-[#e8e8e8]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-white ring-1 ring-[#d9d4cc]">
            <Thermometer className="h-4 w-4 text-[#7b3fa0]" />
          </div>
          <div>
            <p className="text-sm font-semibold">ESP32 Sensors</p>
            {required && !connected ? (
              <p className="mt-1 text-[12px] text-muted-foreground">Connect the board before starting</p>
            ) : (
              <p className="mt-1 text-[12px] text-muted-foreground">
                Temperature, humidity, light, noise, motion, gyro, radar
              </p>
            )}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold ring-1 ring-inset ${
            connected
              ? "bg-[#efe6f4] text-[#7b3fa0] ring-[#c4b0d6]"
              : "bg-red-500/10 text-red-600 ring-red-200"
          }`}
        >
          {connected ? "ACTIVE" : "INACTIVE"}
        </span>
      </div>
      {connected && lastReading && (
        <p className="mt-3 font-mono text-[11px] text-muted-foreground">
          {lastReading.temperature ?? "--"}°C · {lastReading.humidity ?? "--"}% · light {lastReading.light ?? "--"}
          {lastReading.gyroX !== undefined && (
            <>
              {" "}
              · gyro {lastReading.gyroX.toFixed(3)}, {lastReading.gyroY?.toFixed(3)}, {lastReading.gyroZ?.toFixed(3)}
            </>
          )}
          {lastReading.accX !== undefined && (
            <>
              {" "}
              · acc {lastReading.accX.toFixed(3)}, {lastReading.accY?.toFixed(3)}, {lastReading.accZ?.toFixed(3)}
            </>
          )}
        </p>
      )}
      <button
        type="button"
        onClick={connected ? disconnect : connect}
        disabled={connecting || !supported}
        className={`mt-4 w-full rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
          connected
            ? "border border-[#d9d4cc] bg-white text-[#3d2a5c] hover:bg-[#f3eee6]"
            : "bg-[#7b3fa0] text-white hover:bg-[#6b4c9a]"
        }`}
      >
        {connecting ? "Connecting..." : connected ? "Disconnect board" : "Connect ESP32 board"}
      </button>
      {!supported && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Open this site in Chrome or Edge on a laptop to connect the board.
        </p>
      )}
      {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}
    </div>
  )
}
