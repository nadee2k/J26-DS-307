// Seeded random numbers so the simulated study is reproducible (same seed → same dataset → same results).

export type Rng = {
  next: () => number
  normal: (mean?: number, sd?: number) => number
  int: (min: number, max: number) => number
  pick: <T>(items: readonly T[]) => T
  chance: (p: number) => boolean
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const normal = (mean = 0, sd = 1) => {
    const u = Math.max(next(), 1e-12)
    const v = next()
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  return {
    next,
    normal,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
  }
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
