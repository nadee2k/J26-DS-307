// Shared linear-model helpers used by every component's trained model.

import { fitLogistic, predictLogistic, standardizer, type Matrix } from "../sim/ml"

export interface LinModel { w: number[]; mu: number[]; sg: number[]; names: string[] }
export const scoreLin = (m: LinModel, x: number[]) => predictLogistic(m.w, [x.map((v, j) => (v - m.mu[j]) / m.sg[j])])[0]
export const standardized = (m: LinModel, x: number[]) => x.map((v, j) => (v - m.mu[j]) / m.sg[j])

export function fit(X: Matrix, y: number[], names: string[], opts: { iters?: number; l2?: number } = {}): LinModel {
  if (X.length !== y.length) throw new Error(`fit: ${X.length} rows but ${y.length} labels`)
  if (X.length > 0 && X[0].length !== names.length) throw new Error(`fit: ${X[0].length} features but ${names.length} names`)
  const st = standardizer(X)
  return { w: fitLogistic(st.apply(X), y, { iters: opts.iters ?? 250, l2: opts.l2 }), mu: st.mu, sg: st.sg, names }
}
