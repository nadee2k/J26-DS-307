// In-memory ring buffers shared by the three sensing providers and the epoch engine.
// Raw events, readings and frame features live only here (in browser memory); only per-epoch
// numeric features are written to the database.

export interface InputEvent {
  t: number
  kind: "key" | "back" | "click" | "move" | "scroll" | "leave" | "return"
  dist?: number
}

export interface EnvReading {
  t: number
  temp: number | null
  humidity: number | null
  light: number | null
  noise: number | null
  motion: boolean | null
  calibrated: boolean
}

export interface FrameFeatures {
  t: number
  face: boolean
  yaw: number
  pitch: number
  roll: number
  irisX: number
  irisY: number
  faceSize: number // face width as a share of the frame width
  luminance: number // mean frame luminance 0–255
  glare: number // share of near-saturated pixels in the eye region
  phone: boolean | null // null = phone detector not run on this frame
  phoneScore: number
  zone: -1 | 0 | 1 | 2 // -1 = no face / no model
  zoneProb: number
}

const MAX = { input: 20000, env: 4000, frames: 6000 }

export const buffers = {
  input: [] as InputEvent[],
  env: [] as EnvReading[],
  frames: [] as FrameFeatures[],
}

function push<T>(arr: T[], item: T, max: number) {
  arr.push(item)
  if (arr.length > max) arr.splice(0, arr.length - max)
}

export const pushInput = (e: InputEvent) => push(buffers.input, e, MAX.input)
export const pushEnv = (r: EnvReading) => push(buffers.env, r, MAX.env)
export const pushFrame = (f: FrameFeatures) => push(buffers.frames, f, MAX.frames)

export function windowOf<T extends { t: number }>(arr: T[], from: number, to: number): T[] {
  const out: T[] = []
  for (let i = arr.length - 1; i >= 0; i--) {
    const t = arr[i].t
    if (t < from) break
    if (t < to) out.push(arr[i])
  }
  return out.reverse()
}

export function clearBuffers() {
  buffers.input.length = 0
  buffers.env.length = 0
  buffers.frames.length = 0
}
