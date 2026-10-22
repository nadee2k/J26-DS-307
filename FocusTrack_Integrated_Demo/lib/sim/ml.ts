// Small, dependency-free ML and statistics helpers for the in-browser analysis pipeline.

export type Matrix = number[][]

export function mean(xs: number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0 }
export function sd(xs: number[]) { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) || 1 }

/** Width of a rectangular matrix. Throws on ragged or non-finite input so training bugs surface early. */
export function matrixWidth(X: Matrix, name = "X") {
  if (X.length === 0) return 0
  const d = X[0].length
  for (let i = 0; i < X.length; i++) {
    if (X[i].length !== d) throw new Error(`${name} is ragged: row ${i} has ${X[i].length} columns, expected ${d}`)
    for (let j = 0; j < d; j++) if (!Number.isFinite(X[i][j])) throw new Error(`${name}[${i}][${j}] is not a finite number`)
  }
  return d
}

export function standardizer(X: Matrix) {
  const d = matrixWidth(X)
  if (X.length === 0 || d === 0) return { mu: [] as number[], sg: [] as number[], apply: (Y: Matrix) => Y.map((r) => [...r]) }
  const mu = Array.from({ length: d }, (_, j) => mean(X.map((r) => r[j])))
  const sg = Array.from({ length: d }, (_, j) => sd(X.map((r) => r[j])))
  return { mu, sg, apply: (Y: Matrix) => Y.map((r) => r.map((v, j) => (v - mu[j]) / sg[j])) }
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))))

/** Binary logistic regression (batch gradient descent, L2). Returns weights; w[0] is the bias. */
export function fitLogistic(X: Matrix, y: number[], opts: { iters?: number; lr?: number; l2?: number; balanced?: boolean } = {}) {
  const { iters = 400, lr = 0.2, l2 = 0.01, balanced = true } = opts
  const d = matrixWidth(X)
  if (y.length !== X.length) throw new Error(`fitLogistic: ${X.length} rows but ${y.length} labels`)
  if (X.length === 0 || d === 0) return new Array(d + 1).fill(0)
  const n = X.length
  const pos = y.filter((v) => v === 1).length
  // if every label is the same class there is nothing to balance
  const singleClass = pos === 0 || pos === n
  const wPos = balanced && !singleClass ? n / (2 * pos) : 1
  const wNeg = balanced && !singleClass ? n / (2 * (n - pos)) : 1
  const w = new Array(d + 1).fill(0)
  for (let it = 0; it < iters; it++) {
    const g = new Array(d + 1).fill(0)
    for (let i = 0; i < n; i++) {
      let z = w[0]
      for (let j = 0; j < d; j++) z += w[j + 1] * X[i][j]
      const err = (sigmoid(z) - y[i]) * (y[i] === 1 ? wPos : wNeg)
      g[0] += err
      for (let j = 0; j < d; j++) g[j + 1] += err * X[i][j]
    }
    let largestStep = 0
    for (let j = 0; j <= d; j++) {
      const step = g[j] / n + (j > 0 ? l2 * w[j] : 0)
      w[j] -= lr * step
      largestStep = Math.max(largestStep, Math.abs(step))
    }
    if (largestStep < 1e-7) break // converged
  }
  return w
}
export function predictLogistic(w: number[], X: Matrix) {
  return X.map((r) => sigmoid(r.reduce((s, v, j) => s + v * (w[j + 1] ?? 0), w[0] ?? 0)))
}

/** Multinomial (softmax) logistic regression for small K. */
export function fitSoftmax(X: Matrix, y: number[], K: number, iters = 300, lr = 0.3, l2 = 0.01) {
  const d = matrixWidth(X)
  if (y.length !== X.length) throw new Error(`fitSoftmax: ${X.length} rows but ${y.length} labels`)
  if (X.length === 0 || d === 0 || K <= 0) return (Xt: Matrix) => Xt.map(() => 0)
  const n = X.length
  const W = Array.from({ length: K }, () => new Array(d + 1).fill(0))
  for (let it = 0; it < iters; it++) {
    const G = Array.from({ length: K }, () => new Array(d + 1).fill(0))
    for (let i = 0; i < n; i++) {
      const z = W.map((w) => X[i].reduce((s, v, j) => s + v * w[j + 1], w[0]))
      const mx = Math.max(...z); const e = z.map((v) => Math.exp(v - mx)); const s = e.reduce((a, b) => a + b, 0)
      for (let k = 0; k < K; k++) {
        const err = e[k] / s - (y[i] === k ? 1 : 0)
        G[k][0] += err
        for (let j = 0; j < d; j++) G[k][j + 1] += err * X[i][j]
      }
    }
    for (let k = 0; k < K; k++) for (let j = 0; j <= d; j++) W[k][j] -= lr * (G[k][j] / n + (j > 0 ? l2 * W[k][j] : 0))
  }
  return (Xt: Matrix) => Xt.map((r) => { const z = W.map((w) => r.reduce((s, v, j) => s + v * w[j + 1], w[0])); return z.indexOf(Math.max(...z)) })
}

/** Ordinary least squares with small ridge penalty (normal equations, Gaussian elimination). */
export function fitLinear(X: Matrix, y: number[], ridge = 1e-3) {
  const d0 = matrixWidth(X)
  if (y.length !== X.length) throw new Error(`fitLinear: ${X.length} rows but ${y.length} labels`)
  if (X.length === 0 || d0 === 0) { const w = new Array(d0 + 1).fill(0); return { w, predict: (Xt: Matrix) => Xt.map(() => 0) } }
  const d = d0 + 1
  const A = Array.from({ length: d }, () => new Array(d).fill(0))
  const b = new Array(d).fill(0)
  for (let i = 0; i < X.length; i++) {
    const r = [1, ...X[i]]
    for (let p = 0; p < d; p++) { b[p] += r[p] * y[i]; for (let q = 0; q < d; q++) A[p][q] += r[p] * r[q] }
  }
  for (let p = 1; p < d; p++) A[p][p] += ridge * X.length
  // solve A w = b
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < d; c++) {
    let piv = c
    for (let r = c + 1; r < d; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r
    ;[M[c], M[piv]] = [M[piv], M[c]]
    const v = M[c][c] || 1e-9
    for (let k = c; k <= d; k++) M[c][k] /= v
    for (let r = 0; r < d; r++) if (r !== c) { const f = M[r][c]; for (let k = c; k <= d; k++) M[r][k] -= f * M[c][k] }
  }
  const w = M.map((row) => row[d])
  return { w, predict: (Xt: Matrix) => Xt.map((r) => r.reduce((s, v, j) => s + v * w[j + 1], w[0])) }
}

/** k-means clustering (deterministic farthest-first seeding, duplicate-free). */
export function kmeans(X: Matrix, k: number, iters = 40) {
  const d = matrixWidth(X)
  if (X.length === 0 || d === 0 || k <= 0) return { centroids: [] as Matrix, assign: (Y: Matrix) => Y.map(() => 0) }
  const kk = Math.min(k, X.length)
  const used = new Set<number>([0])
  const C: Matrix = [X[0]]
  while (C.length < kk) {
    let best = -1, bestD = -1
    X.forEach((x, i) => {
      if (used.has(i)) return
      const dmin = Math.min(...C.map((c) => dist2(x, c)))
      if (dmin > bestD) { bestD = dmin; best = i }
    })
    if (best < 0) break
    used.add(best)
    C.push(X[best])
  }
  let labels = new Array(X.length).fill(0)
  for (let it = 0; it < iters; it++) {
    labels = X.map((x) => nearest(x, C))
    for (let c = 0; c < C.length; c++) {
      const members = X.filter((_, i) => labels[i] === c)
      if (members.length) C[c] = members[0].map((_, j) => mean(members.map((m) => m[j])))
    }
  }
  return { centroids: C, assign: (Y: Matrix) => Y.map((y) => nearest(y, C)) }
}
const dist2 = (a: number[], b: number[]) => a.reduce((s, v, j) => s + (v - b[j]) ** 2, 0)
const nearest = (x: number[], C: Matrix) => { let b = 0, bd = Infinity; C.forEach((c, i) => { const d = dist2(x, c); if (d < bd) { bd = d; b = i } }); return b }

// ---------- metrics ----------
export function macroF1(y: number[], p: number[], classes = [0, 1]) {
  return mean(classes.map((c) => {
    const tp = y.filter((v, i) => v === c && p[i] === c).length
    const fp = y.filter((v, i) => v !== c && p[i] === c).length
    const fn = y.filter((v, i) => v === c && p[i] !== c).length
    return tp === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn)
  }))
}
export function accuracy(y: number[], p: number[]) { return y.length ? y.filter((v, i) => v === p[i]).length / y.length : 0 }
export function rocAuc(y: number[], s: number[]) {
  const pos = s.filter((_, i) => y[i] === 1), neg = s.filter((_, i) => y[i] === 0)
  if (!pos.length || !neg.length) return NaN
  let wins = 0
  for (const a of pos) for (const b of neg) wins += a > b ? 1 : a === b ? 0.5 : 0
  return wins / (pos.length * neg.length)
}
export function mae(y: number[], p: number[]) { return mean(y.map((v, i) => Math.abs(v - p[i]))) }
export function rmse(y: number[], p: number[]) { return Math.sqrt(mean(y.map((v, i) => (v - p[i]) ** 2))) }
function ranks(xs: number[]) {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0])
  const r = new Array(xs.length)
  for (let i = 0; i < idx.length;) {
    let j = i
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1
    i = j + 1
  }
  return r as number[]
}
export function spearman(a: number[], b: number[]) {
  const ra = ranks(a), rb = ranks(b), ma = mean(ra), mb = mean(rb)
  const num = ra.reduce((s, v, i) => s + (v - ma) * (rb[i] - mb), 0)
  const den = Math.sqrt(ra.reduce((s, v) => s + (v - ma) ** 2, 0) * rb.reduce((s, v) => s + (v - mb) ** 2, 0))
  return den ? num / den : 0
}
/** Quadratic-weighted Cohen's kappa for ordinal ratings 1..K. */
export function weightedKappa(a: number[], b: number[], K = 5) {
  const O = Array.from({ length: K }, () => new Array(K).fill(0))
  a.forEach((v, i) => { O[v - 1][b[i] - 1]++ })
  const n = a.length
  if (n === 0) return NaN // no observations → agreement is undefined, not perfect
  const ra = O.map((r) => r.reduce((s, v) => s + v, 0)), cb = O[0].map((_, j) => O.reduce((s, r) => s + r[j], 0))
  let num = 0, den = 0
  for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) {
    const w = ((i - j) ** 2) / ((K - 1) ** 2)
    num += w * O[i][j]; den += w * (ra[i] * cb[j]) / n
  }
  return den ? 1 - num / den : 1
}
/** Wilcoxon signed-rank test (two-sided, normal approximation). Returns statistic and p-value. */
export function wilcoxon(a: number[], b: number[]) {
  const d = a.map((v, i) => v - b[i]).filter((v) => v !== 0)
  const n = d.length
  if (n < 6) return { n, p: NaN }
  const r = ranks(d.map(Math.abs))
  const wPlus = d.reduce((s, v, i) => s + (v > 0 ? r[i] : 0), 0)
  const mu = (n * (n + 1)) / 4, sigma = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24)
  const z = (wPlus - mu) / sigma
  const p = 2 * (1 - normCdf(Math.abs(z)))
  return { n, p }
}
function normCdf(z: number) {
  const t = 1 / (1 + 0.2316419 * z)
  const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return 1 - (Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI)) * poly
}
