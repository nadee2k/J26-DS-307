"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Download, Play, Save, Square } from "lucide-react"
import { AppShell } from "@/components/layout/app-shell"
import { Esp32ConnectPanel } from "@/components/features/telemetry/esp32-connect-panel"
import { Metric, Panel, Spark, WorkbenchShell, type WorkbenchInfo } from "@/components/workbench/workbench-shell"
import { useAuth } from "@/hooks/use-auth"
import { useEsp32 } from "@/hooks/use-esp32"
import { isDemoMode } from "@/lib/demo-db"
import { buffers, windowOf } from "@/lib/focus/buffers"
import { aggregateC2, comfortBand, DEFAULT_CALIBRATION, loadCalibration, saveCalibration, toDb, type ComfortBand, type SensorCalibration } from "@/lib/focus/c2"
import { zOf } from "@/lib/focus/c4"
import { getModels } from "@/lib/focus/models"
import { goodFocusMinutes } from "@/lib/focus/store"
import type { C2Features } from "@/lib/focus/types"

const INFO: WorkbenchInfo = {
  n: 2, title: "Environmental Context and Influence Modelling", owner: "Kapuwella K.G.N.D.", id: "IT23199330",
  question: "Which room conditions, alone and together, go with lower focus for each learner?",
  done: [
    "ESP32 firmware: DHT22, LDR, sound loudness (peak-to-peak over 50 ms), PIR – 1 Hz CSV over USB (demo board simulator included)",
    "Two-point sensor calibration to approximate lux and dB(A); failed reads stored as missing, never as 0",
    "Cleaning: Hampel filter (rolling median ± 3 scaled MAD) and missing-data accounting",
    "Per-epoch features: mean, SD, slope, noise × temperature, condition categories",
    "Personal comfort band and comfort index from earlier sessions (population band until there is enough data)",
    "Analysis on the simulated study: mean / linear / population / personalised models, Spearman, comfort bands",
  ],
  next: [
    "Measure the calibration points against a reference lux meter and sound-level meter",
    "Collect real sessions in at least two room types per participant",
    "Mixed-effects model (random sound slope per learner) on real data; shrink personal bands towards the population",
    "Integration: export C2 epochs and comfort ranges to C4",
  ],
  analysisTab: "C2 Environment",
}

const cat = (v: number | null, cuts: [number, number], names: [string, string, string]) => (v == null ? "–" : v < cuts[0] ? names[0] : v < cuts[1] ? names[1] : names[2])
interface Row { at: string; f: C2Features }

export default function C2Workbench() {
  const { student, isLoading } = useAuth()
  const router = useRouter()
  const { connected, lastReading } = useEsp32()
  const [epochSec, setEpochSec] = useState(15)
  const [running, setRunning] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [band, setBand] = useState<ComfortBand | null>(null)
  const [bandInfo, setBandInfo] = useState("")
  const [cal, setCal] = useState<SensorCalibration>(DEFAULT_CALIBRATION)
  const [, setTick] = useState(0)
  const lastRef = useRef(0)

  useEffect(() => { if (!isLoading && !student) router.push("/login") }, [student, isLoading, router])
  useEffect(() => { setCal(loadCalibration()) }, [])
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(id) }, [])

  // comfort band: personal from earlier sessions when there is enough probe-labelled data, otherwise population
  useEffect(() => {
    if (!student) return
    const t = setTimeout(async () => {
      const pop = getModels().populationBand
      try {
        const c = loadCalibration()
        const g = await goodFocusMinutes(student.id, zOf, (noise) => (noise == null ? null : noise > 120 ? toDb(noise, c) : noise))
        const b = comfortBand(g.minutes, pop)
        setBand(b)
        setBandInfo(b.personal ? `Personal band from ${g.minutes.length} high-focus minutes in ${g.sessions} earlier session(s)` : `Population band (simulated study) – only ${g.minutes.length} high-focus minutes from ${g.sessions} earlier session(s); 8 needed for a personal band`)
      } catch { setBand(pop); setBandInfo("Population band (simulated study)") }
    }, 50)
    return () => clearTimeout(t)
  }, [student])

  const tick = useCallback(() => {
    if (!band) return
    const now = Date.now(), from = lastRef.current
    const f = aggregateC2(windowOf(buffers.env, from, now), from, now, band)
    if (f) setRows((r) => [...r, { at: new Date(now).toLocaleTimeString(), f }])
    lastRef.current = now
  }, [band])
  useEffect(() => { if (!running) return; const id = setInterval(tick, epochSec * 1000); return () => clearInterval(id) }, [running, epochSec, tick])

  const recent = buffers.env.slice(-90)
  const last = rows[rows.length - 1]
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ component: "C2", epochSec, band, calibration: cal, epochs: rows }, null, 2)], { type: "application/json" })
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "focustrack_c2_epochs.json"; a.click()
  }
  const setPoint = (sensor: "light" | "sound", i: 0 | 1, key: "raw" | "value", v: string) => {
    const c = JSON.parse(JSON.stringify(cal)) as SensorCalibration
    c[sensor][i][key] = Number(v); setCal(c)
  }

  if (isLoading || !student) return null
  return (
    <AppShell studentName={student.name}>
      <WorkbenchShell info={INFO}>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid gap-3">
            <Esp32ConnectPanel />
            <p className="text-[11px] text-muted-foreground">{isDemoMode() ? "Demo mode: a simulated board streams calibrated readings with occasional failed DHT22 reads and sound glitches, so cleaning can be shown." : "Real board: light and sound arrive as raw ADC values and are converted with the calibration below."}</p>
          </div>
          <Panel title="Live readings (1 Hz)">
            {!connected || !lastReading ? <p className="text-sm text-muted-foreground">Connect the sensor unit to see readings.</p> : (
              <div className="grid gap-2">
                <div className="grid grid-cols-5 gap-2">
                  <Metric label="Temp" value={lastReading.temperature != null ? `${lastReading.temperature}°C` : "missing"} />
                  <Metric label="Humidity" value={lastReading.humidity != null ? `${lastReading.humidity}%` : "missing"} />
                  <Metric label="Light" value={lastReading.light ?? "–"} hint={lastReading.raw ? "raw ADC" : "lux"} />
                  <Metric label="Sound" value={lastReading.noise ?? "–"} hint={lastReading.raw ? "raw p2p" : "dB(A)"} />
                  <Metric label="Motion" value={lastReading.motion ? "yes" : "no"} />
                </div>
                <p className="text-[11px] text-muted-foreground">Sound level, last 90 s (dB)</p>
                <Spark values={recent.map((r) => r.noise)} min={30} max={90} color="#1E8E5A" />
              </div>
            )}
          </Panel>
        </div>

        <Panel title="Per-epoch features after cleaning" right={
          <div className="flex items-center gap-2">
            <select className="rounded-lg border px-2 py-1 text-xs" value={epochSec} disabled={running} onChange={(e) => setEpochSec(Number(e.target.value))}>
              <option value={60}>60-s epochs (study)</option><option value={15}>15-s epochs (fast demo)</option>
            </select>
            {!running ? <button onClick={() => { lastRef.current = Date.now(); setRows([]); setRunning(true) }} disabled={!connected || !band} className="flex items-center gap-1 rounded-lg bg-[#1E8E5A] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"><Play className="h-3.5 w-3.5" />Start</button>
              : <button onClick={() => setRunning(false)} className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white"><Square className="h-3.5 w-3.5" />Stop</button>}
            <button onClick={exportJson} disabled={!rows.length} className="flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs disabled:opacity-50"><Download className="h-3.5 w-3.5" />Export</button>
          </div>}>
          {band && <p className="mb-2 text-xs"><b>Comfort band:</b> noise {band.noise[0].toFixed(0)}–{band.noise[1].toFixed(0)} dB, temperature {band.temp[0].toFixed(1)}–{band.temp[1].toFixed(1)} °C · <span className="text-muted-foreground">{bandInfo}</span></p>}
          {last && (
            <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-6">
              <Metric label="Noise" value={last.f.noise != null ? `${last.f.noise.toFixed(1)} dB` : "–"} hint={cat(last.f.noise, [40, 55], ["quiet", "moderate", "noisy"])} />
              <Metric label="Temperature" value={last.f.temp != null ? `${last.f.temp.toFixed(1)} °C` : "–"} hint={last.f.tempSlope != null ? `slope ${last.f.tempSlope.toFixed(2)} °C/min` : undefined} />
              <Metric label="Light" value={last.f.light != null ? `${last.f.light.toFixed(0)} lux` : "–"} hint={cat(last.f.light, [150, 500], ["dim", "normal", "bright"])} />
              <Metric label="Noise × temp" value={last.f.noise != null && last.f.temp != null ? (last.f.noise * last.f.temp).toFixed(0) : "–"} hint="interaction term" />
              <Metric label="Comfort index" value={last.f.comfortNoise > 0 || last.f.comfortTemp > 0 ? `+${last.f.comfortNoise.toFixed(1)} dB / +${last.f.comfortTemp.toFixed(1)} °C` : "inside band"} hint="distance outside the band" />
              <Metric label="Data quality" value={`${(100 * (1 - last.f.missingRatio)).toFixed(0)}%`} hint={`${last.f.outliersRemoved} outlier(s) removed`} />
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="text-muted-foreground"><th className="py-1">Epoch end</th><th>Noise (dB)</th><th>Noise SD</th><th>Temp (°C)</th><th>Humidity</th><th>Light</th><th>Motion</th><th>Readings</th><th>Missing</th><th>Outliers</th><th>Outside band</th></tr></thead>
              <tbody>{rows.slice(-12).reverse().map((r, i) => (
                <tr key={i} className="border-t"><td className="py-1">{r.at}</td><td>{r.f.noise?.toFixed(1) ?? "–"}</td><td>{r.f.noiseSd?.toFixed(1) ?? "–"}</td><td>{r.f.temp?.toFixed(1) ?? "–"}</td><td>{r.f.humidity?.toFixed(0) ?? "–"}</td><td>{r.f.light?.toFixed(0) ?? "–"}</td><td>{(r.f.motion * 100).toFixed(0)}%</td><td>{r.f.readings}</td><td>{(r.f.missingRatio * 100).toFixed(0)}%</td><td>{r.f.outliersRemoved}</td><td>{r.f.comfortNoise > 0 || r.f.comfortTemp > 0 ? "yes" : "no"}</td></tr>
              ))}</tbody>
            </table>
            {!rows.length && <p className="py-2 text-sm text-muted-foreground">Connect the sensor unit and press Start.</p>}
          </div>
        </Panel>

        <Panel title="Sensor calibration (two reference points per sensor)" right={<button onClick={() => { const c = { ...cal, measured: true }; saveCalibration(c); setCal(c) }} className="flex items-center gap-1 rounded-lg border px-2 py-1 text-xs"><Save className="h-3.5 w-3.5" />Save as measured</button>}>
          <p className="mb-2 text-xs text-muted-foreground">Hold the lux meter / sound-level meter next to the unit, note the raw value shown by the board and the meter reading, at a low and a high level. Status: <b>{cal.measured ? "measured" : "placeholder defaults – not yet measured"}</b>.</p>
          <div className="grid gap-3 md:grid-cols-2">
            {(["light", "sound"] as const).map((s) => (
              <div key={s} className="rounded-xl bg-[#f6f3ee] p-3 text-xs">
                <p className="mb-2 font-semibold">{s === "light" ? "Light: raw ADC → lux (linear)" : "Sound: raw peak-to-peak → dB(A) (log-linear)"}</p>
                {[0, 1].map((i) => (
                  <div key={i} className="mb-1 flex items-center gap-2">Point {i + 1}: raw
                    <input className="w-20 rounded border px-1" type="number" value={cal[s][i].raw} onChange={(e) => setPoint(s, i as 0 | 1, "raw", e.target.value)} />
                    = <input className="w-20 rounded border px-1" type="number" value={cal[s][i].value} onChange={(e) => setPoint(s, i as 0 | 1, "value", e.target.value)} /> {s === "light" ? "lux" : "dB(A)"}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Panel>
      </WorkbenchShell>
    </AppShell>
  )
}
