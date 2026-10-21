"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { environmentLogs } from "@/lib/api"
import { isDemoMode } from "@/lib/demo-db"
import { pushEnv } from "@/lib/focus/buffers"
import { loadCalibration, toDb, toLux } from "@/lib/focus/c2"
import {
  isComplete,
  isSeparator,
  parseCsvLine,
  parseLabeledLine,
  type EnvironmentReading,
} from "@/lib/esp32-parse"

type SerialPortLike = {
  open: (options: { baudRate: number }) => Promise<void>
  close: () => Promise<void>
  readable: ReadableStream<Uint8Array> | null
}

type Esp32ContextType = {
  supported: boolean
  connected: boolean
  connecting: boolean
  error: string
  lastReading: EnvironmentReading | null
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  setActiveSessionId: (id: string | null) => void
}

const Esp32Context = createContext<Esp32ContextType>({
  supported: false,
  connected: false,
  connecting: false,
  error: "",
  lastReading: null,
  connect: async () => {},
  disconnect: async () => {},
  setActiveSessionId: () => {},
})

export function Esp32Provider({ children }: { children: ReactNode }) {
  const [supported, setSupported] = useState(false)
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState("")
  const [lastReading, setLastReading] = useState<EnvironmentReading | null>(null)

  const portRef = useRef<SerialPortLike | null>(null)
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const stopRef = useRef(false)
  const simTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setSupported(isDemoMode() || (typeof navigator !== "undefined" && "serial" in navigator))
  }, [])

  const setActiveSessionId = useCallback((id: string | null) => {
    sessionIdRef.current = id
  }, [])

  const sendReading = useCallback(async (reading: EnvironmentReading) => {
    setLastReading({ ...reading })
    // Component 2 buffer: real boards send raw ADC light/sound values, mapped to lux / dB(A) with the sensor calibration
    const cal = loadCalibration()
    pushEnv({
      t: Date.now(),
      temp: reading.temperature ?? null,
      humidity: reading.humidity ?? null,
      light: reading.light == null ? null : reading.raw ? toLux(reading.light, cal) : reading.light,
      noise: reading.noise == null ? null : reading.raw ? toDb(reading.noise, cal) : reading.noise,
      motion: reading.motion ?? null,
      calibrated: !reading.raw || cal.measured,
    })
    const sessionId = sessionIdRef.current
    if (!sessionId) return
    try {
      await environmentLogs.create({
        sessionId,
        temperature: reading.temperature ?? null,
        humidity: reading.humidity ?? null,
        light: reading.light ?? null,
        noise: reading.noise ?? null,
        motion: reading.motion ?? null,
        accX: reading.accX ?? null,
        accY: reading.accY ?? null,
        accZ: reading.accZ ?? null,
        gyroX: reading.gyroX ?? null,
        gyroY: reading.gyroY ?? null,
        gyroZ: reading.gyroZ ?? null,
        distance: reading.distance ?? null,
        radarState: reading.radarState ?? null,
      })
    } catch (err) {
      console.error("Failed to save environment log", err)
    }
  }, [])

  const disconnect = useCallback(async () => {
    stopRef.current = true
    if (simTimerRef.current) { clearInterval(simTimerRef.current); simTimerRef.current = null }
    try {
      await readerRef.current?.cancel()
    } catch {
      /* ignore */
    }
    readerRef.current = null
    try {
      await portRef.current?.close()
    } catch {
      /* ignore */
    }
    portRef.current = null
    setConnected(false)
  }, [])

  const connect = useCallback(async () => {
    // Demo mode: no board attached – stream simulated readings at 1 Hz so the full pipeline can be demonstrated.
    if (isDemoMode()) {
      setError("")
      setConnected(true)
      let temp = 28 + Math.random() * 2, spike = 0
      if (simTimerRef.current) clearInterval(simTimerRef.current)
      simTimerRef.current = setInterval(() => {
        temp += (Math.random() - 0.5) * 0.05
        if (spike === 0 && Math.random() < 0.01) spike = 60 + Math.floor(Math.random() * 180)
        let noise = 46 + (Math.random() - 0.5) * 5 + (spike > 0 ? 14 : 0)
        if (spike > 0) spike--
        if (Math.random() < 0.01) noise += 30 // single-sample glitch – removed by the C2 Hampel filter
        const dhtFailed = Math.random() < 0.02 // failed DHT22 read – stored as missing, never as 0
        void sendReading({ temperature: dhtFailed ? undefined : Math.round(temp * 10) / 10, humidity: dhtFailed ? undefined : Math.round(74 + (Math.random() - 0.5) * 3), light: Math.round(260 + (Math.random() - 0.5) * 30), noise: Math.round(noise), motion: Math.random() < 0.1 })
      }, 1000)
      return
    }
    const serial = (navigator as Navigator & { serial?: { requestPort: () => Promise<SerialPortLike> } }).serial
    if (!serial) {
      setError("Use Chrome or Edge on a laptop. This browser cannot read USB sensors.")
      return
    }

    setConnecting(true)
    setError("")
    try {
      const port = await serial.requestPort()
      await port.open({ baudRate: 115200 })
      portRef.current = port
      stopRef.current = false
      setConnected(true)

      const decoder = new TextDecoder()
      let buffer = ""
      let reading: EnvironmentReading = {}
      const reader = port.readable?.getReader()
      if (!reader) throw new Error("Could not read from ESP32")
      readerRef.current = reader

      void (async () => {
        try {
          while (!stopRef.current) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split(/\r?\n/)
            buffer = lines.pop() ?? ""
            for (const raw of lines) {
              const line = raw.trim()
              if (!line) continue
              if (isSeparator(line)) {
                if (isComplete(reading)) await sendReading(reading)
                reading = {}
                continue
              }
              const csv = parseCsvLine(line)
              if (csv) {
                await sendReading(csv)
                reading = {}
                continue
              }
              parseLabeledLine(line, reading)
            }
          }
        } catch (err) {
          if (!stopRef.current) {
            setError(err instanceof Error ? err.message : "ESP32 disconnected")
            setConnected(false)
          }
        }
      })()
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not connect"
      if (message.toLowerCase().includes("no port selected")) {
        setError("No board selected. Plug in the ESP32, then click Connect again.")
      } else {
        setError("Could not open the board. Close Arduino Serial Monitor and try again.")
      }
      setConnected(false)
    } finally {
      setConnecting(false)
    }
  }, [sendReading])

  return (
    <Esp32Context.Provider
      value={{
        supported,
        connected,
        connecting,
        error,
        lastReading,
        connect,
        disconnect,
        setActiveSessionId,
      }}
    >
      {children}
    </Esp32Context.Provider>
  )
}

export function useEsp32() {
  return useContext(Esp32Context)
}
