// End-to-end analysis pipeline for the four FocusTrack components, run on the simulated study.
// It mirrors the proposal's methodology (leave-one-participant-out validation, baselines, ablations,
// per-mode reporting) so the same code can be pointed at real data after collection.

import type { Epoch, SimSession, SimStudy } from "./types"
import {
  accuracy, fitLinear, fitLogistic, fitSoftmax, kmeans, macroF1, mae, mean, predictLogistic, rmse, rocAuc, sd, spearman,
  standardizer, weightedKappa, wilcoxon, type Matrix,
} from "./ml"

const SCREEN_TASKS = ["coding", "writing", "assignment", "zoom"] as const

// ---------- shared labelling ----------
export interface LabelStats {
  participants: number; sessions: number; epochs: number; probes: number; labelledEpochs: number
  meanRating: { screen: number; nonScreen: number }
  observerProbes: number; kappa: number; probeVsHiddenFocus: number
  sessionsPerRoom: Record<string, number>
}

/** Learner-normalised probe ratings (z-scores) keyed by session id → probe index. */
function zRatings(study: SimStudy) {
  const byP = new Map<string, number[]>()
  for (const s of study.sessions) for (const pr of s.probes) byP.set(s.pid, [...(byP.get(s.pid) ?? []), pr.rating])
  const stats = new Map([...byP].map(([p, r]) => [p, { m: mean(r), s: Math.max(sd(r), 0.5) }]))
  return (pid: string, rating: number) => { const st = stats.get(pid)!; return (rating - st.m) / st.s }
}

export function labelStats(study: SimStudy): LabelStats {
  const probes = study.sessions.flatMap((s) => s.probes.map((p) => ({ s, p })))
  const obs = probes.filter((x) => x.p.observer !== null)
  const hidden = probes.map(({ s, p }) => mean(s.epochs.slice(Math.max(0, p.t - 5), p.t).map((e) => e.focus)))
  const rooms: Record<string, number> = {}
  study.sessions.forEach((s) => { rooms[s.room] = (rooms[s.room] ?? 0) + 1 })
  return {
    participants: study.participants.length,
    sessions: study.sessions.length,
    epochs: study.sessions.reduce((n, s) => n + s.epochs.length, 0),
    probes: probes.length,
    labelledEpochs: probes.reduce((n, { p }) => n + Math.min(5, p.t), 0),
    meanRating: {
      screen: mean(probes.filter((x) => x.s.mode === "screen").map((x) => x.p.rating)),
      nonScreen: mean(probes.filter((x) => x.s.mode === "non-screen").map((x) => x.p.rating)),
    },
    observerProbes: obs.length,
    kappa: weightedKappa(obs.map((x) => x.p.rating), obs.map((x) => x.p.observer as number)),
    probeVsHiddenFocus: spearman(probes.map((x) => x.p.rating), hidden),
    sessionsPerRoom: rooms,
  }
}

interface Row { pid: string; sid: string; mode: string; task: string; e: Epoch; idx: number; session: SimSession; label: number; z: number }

/** Epochs in the 5 minutes before each probe, labelled focused (z > 0) or not. */
function labelledRows(study: SimStudy): Row[] {
  const z = zRatings(study)
  const rows: Row[] = []
  for (const s of study.sessions) for (const pr of s.probes) {
    const zz = z(s.pid, pr.rating)
    for (let t = Math.max(0, pr.t - 5); t < pr.t; t++) rows.push({ pid: s.pid, sid: s.id, mode: s.mode, task: s.task, e: s.epochs[t], idx: t, session: s, label: zz > 0 ? 1 : 0, z: zz })
  }
  return rows
}

// ---------- Component 1: interaction states ----------
export interface C1Result {
  baselineF1: number; proposedF1: number; byMode: { mode: string; baseline: number; proposed: number }[]
  wilcoxonP: number; nParticipants: number
  loto: { task: string; baseline: number; proposed: number }[]
  ablation: { name: string; f1: number }[]
  states: { state: number; typing: number; idle: number; switches: number; share: number }[]
}

const c1Base = (e: Epoch) => [e.typingRate, e.idleRatio, e.mouseSpeed, e.switchRate]
const c1Raw = (e: Epoch) => [e.typingRate, e.idleRatio, e.mouseSpeed, e.switchRate, e.interKeyVar, e.backspaceRatio]
// interaction states describe the activity pattern only; rhythm and corrections are features, not state definitions
const c1Act = (e: Epoch) => [e.typingRate, e.idleRatio, e.mouseSpeed, e.switchRate]
const K = 4

function c1Features(rows: Row[], assign: (X: Matrix) => number[], std: (X: Matrix) => Matrix, opts: { context: boolean; states: boolean; transitions: boolean }) {
  return rows.map((r) => {
    const f = [...c1Raw(r.e)]
    const s = r.session
    if (opts.states || opts.transitions) {
      const win = s.epochs.slice(Math.max(0, r.idx - 5), r.idx + 1)
      const st = assign(std(win.map(c1Act)))
      const cur = st[st.length - 1]
      if (opts.states) for (let k = 0; k < K; k++) f.push(cur === k ? 1 : 0)
      if (opts.transitions) {
        let dwell = 1; for (let i = st.length - 2; i >= 0 && st[i] === cur; i--) dwell++
        const changes = st.slice(1).filter((v, i) => v !== st[i]).length
        f.push(dwell, changes)
      }
    }
    if (opts.context) {
      const screen = r.mode === "screen" ? 1 : 0
      f.push(screen, ...SCREEN_TASKS.map((t) => (r.task === t ? 1 : 0)))
      // interaction: activity features only mean something in screen sessions
      f.push(screen * r.e.typingRate, screen * r.e.idleRatio, screen * r.e.switchRate)
    }
    return f
  })
}

function c1Fold(train: Row[], test: Row[], study: SimStudy, opts: { context: boolean; states: boolean; transitions: boolean }, base = false) {
  if (base) {
    const st = standardizer(train.map((r) => c1Base(r.e)))
    const w = fitLogistic(st.apply(train.map((r) => c1Base(r.e))), train.map((r) => r.label), { iters: 150 })
    return predictLogistic(w, st.apply(test.map((r) => c1Base(r.e)))).map((p) => (p > 0.5 ? 1 : 0))
  }
  const trainP = new Set(train.map((r) => r.pid))
  const allTrainEpochs = study.sessions.filter((s) => trainP.has(s.pid)).flatMap((s) => s.epochs.filter((_, i) => i % 3 === 0).map(c1Act))
  const rawStd = standardizer(allTrainEpochs)
  const km = kmeans(rawStd.apply(allTrainEpochs), K, 25)
  const Xtr = c1Features(train, km.assign, rawStd.apply, opts)
  const Xte = c1Features(test, km.assign, rawStd.apply, opts)
  const st = standardizer(Xtr)
  const w = fitLogistic(st.apply(Xtr), train.map((r) => r.label), { iters: 150 })
  return predictLogistic(w, st.apply(Xte)).map((p) => (p > 0.5 ? 1 : 0))
}

export function runC1(study: SimStudy): C1Result {
  const rows = labelledRows(study)
  const pids = study.participants.map((p) => p.id)
  const full = { context: true, states: true, transitions: true }
  const yAll: number[] = [], pBase: number[] = [], pProp: number[] = [], modes: string[] = []
  const perPBase: number[] = [], perPProp: number[] = []
  const abl: Record<string, number[][]> = { "Full model": [[], []], "No task context": [[], []], "No states": [[], []], "No transitions": [[], []] }
  for (const pid of pids) {
    const train = rows.filter((r) => r.pid !== pid), test = rows.filter((r) => r.pid === pid)
    if (!test.length) continue
    const b = c1Fold(train, test, study, full, true)
    const pr = c1Fold(train, test, study, full)
    const y = test.map((r) => r.label)
    yAll.push(...y); pBase.push(...b); pProp.push(...pr); modes.push(...test.map((r) => r.mode))
    perPBase.push(macroF1(y, b)); perPProp.push(macroF1(y, pr))
    if (pids.indexOf(pid) % 2 === 0) { // ablations on half the folds to keep the browser responsive (same folds for every variant)
      abl["Full model"][0].push(...y); abl["Full model"][1].push(...pr)
      for (const [name, o] of [["No task context", { ...full, context: false }], ["No states", { ...full, states: false }], ["No transitions", { ...full, transitions: false }]] as const) {
        abl[name][0].push(...y); abl[name][1].push(...c1Fold(train, test, study, o))
      }
    }
  }
  const sel = (m: string) => modes.map((v, i) => (v === m ? i : -1)).filter((i) => i >= 0)
  const byMode = ["screen", "non-screen"].map((m) => { const ix = sel(m); return { mode: m, baseline: macroF1(ix.map((i) => yAll[i]), ix.map((i) => pBase[i])), proposed: macroF1(ix.map((i) => yAll[i]), ix.map((i) => pProp[i])) } })
  // leave-one-task-out among computer-based tasks
  const screenRows = rows.filter((r) => r.mode === "screen")
  const loto = SCREEN_TASKS.map((task) => {
    const train = screenRows.filter((r) => r.task !== task), test = screenRows.filter((r) => r.task === task)
    const y = test.map((r) => r.label)
    return { task, baseline: macroF1(y, c1Fold(train, test, study, full, true)), proposed: macroF1(y, c1Fold(train, test, study, full)) }
  })
  // describe discovered states on all data
  const all = study.sessions.flatMap((s) => s.epochs.filter((_, i) => i % 2 === 0))
  const st = standardizer(all.map(c1Raw)); const km = kmeans(st.apply(all.map(c1Raw)), K, 25); const lab = km.assign(st.apply(all.map(c1Raw)))
  const states = Array.from({ length: K }, (_, k) => { const m = all.filter((_, i) => lab[i] === k); return { state: k + 1, typing: mean(m.map((e) => e.typingRate)), idle: mean(m.map((e) => e.idleRatio)), switches: mean(m.map((e) => e.switchRate)), share: m.length / all.length } })
  return {
    baselineF1: macroF1(yAll, pBase), proposedF1: macroF1(yAll, pProp), byMode,
    wilcoxonP: wilcoxon(perPProp, perPBase).p, nParticipants: perPProp.length,
    loto,
    ablation: Object.entries(abl).map(([name, [y, p]]) => ({ name, f1: macroF1(y, p) })),
    states,
  }
}

// ---------- Component 2: environment ----------
export interface C2Result {
  models: { name: string; mae: number; rmse: number }[]
  personalVsPopulationP: number
  spearman: { variable: string; rho: number }[]
  bands: { pid: string; noise: [number, number]; temp: [number, number] }[]
}

export function runC2(study: SimStudy): C2Result {
  const z = zRatings(study)
  interface W { pid: string; sIndex: number; x: number[]; raw: number[]; z: number; noise: number; temp: number }
  const ws: W[] = []
  for (const s of study.sessions) for (const pr of s.probes) {
    const win = s.epochs.slice(Math.max(0, pr.t - 5), pr.t)
    const lag = s.epochs.slice(Math.max(0, pr.t - 10), Math.max(1, pr.t - 5))
    const noise = mean(win.map((e) => e.noise)), temp = mean(win.map((e) => e.temp))
    const raw = [noise, temp, mean(win.map((e) => e.humidity)), mean(win.map((e) => e.light)), mean(win.map((e) => e.motion))]
    const x = [...raw, mean(lag.map((e) => e.noise)), noise * temp / 30, s.startHour, s.room === "library" ? 1 : 0, s.room === "campus" ? 1 : 0, s.mode === "screen" ? 1 : 0]
    ws.push({ pid: s.pid, sIndex: s.index, x, raw, z: z(s.pid, pr.rating), noise, temp })
  }
  const train = ws.filter((w) => w.sIndex < 4), test = ws.filter((w) => w.sIndex >= 4)
  const yTe = test.map((w) => w.z)
  const stRaw = standardizer(train.map((w) => w.raw)), stX = standardizer(train.map((w) => w.x))
  const lin = fitLinear(stRaw.apply(train.map((w) => w.raw)), train.map((w) => w.z))
  const pop = fitLinear(stX.apply(train.map((w) => w.x)), train.map((w) => w.z))
  const popPredTe = pop.predict(stX.apply(test.map((w) => w.x)))
  // personalised: population prediction + a per-learner linear correction on noise and temperature (earlier sessions only)
  const popPredTr = pop.predict(stX.apply(train.map((w) => w.x)))
  const persPred = test.map((w, i) => {
    const own = train.map((t, j) => ({ t, j })).filter(({ t }) => t.pid === w.pid)
    if (own.length < 8) return popPredTe[i]
    const corr = fitLinear(own.map(({ t }) => [(t.noise - 45) / 10, (t.temp - 26) / 2]), own.map(({ t, j }) => t.z - popPredTr[j]), 0.5)
    return popPredTe[i] + corr.predict([[(w.noise - 45) / 10, (w.temp - 26) / 2]])[0]
  })
  const perL = [...new Set(test.map((w) => w.pid))].map((pid) => {
    const ix = test.map((w, i) => (w.pid === pid ? i : -1)).filter((i) => i >= 0)
    return { pop: mae(ix.map((i) => yTe[i]), ix.map((i) => popPredTe[i])), pers: mae(ix.map((i) => yTe[i]), ix.map((i) => persPred[i])) }
  })
  const names = ["noise", "temperature", "humidity", "light", "motion"]
  const bands = study.participants.slice(0, 8).map((p) => {
    const good = train.filter((w) => w.pid === p.id && w.z > 0.3)
    const q = (xs: number[], f: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(f * (s.length - 1))] : NaN }
    return { pid: p.code, noise: [q(good.map((w) => w.noise), 0.1), q(good.map((w) => w.noise), 0.9)] as [number, number], temp: [q(good.map((w) => w.temp), 0.1), q(good.map((w) => w.temp), 0.9)] as [number, number] }
  })
  return {
    models: [
      { name: "Mean baseline", mae: mae(yTe, yTe.map(() => 0)), rmse: rmse(yTe, yTe.map(() => 0)) },
      { name: "Linear (raw readings)", mae: mae(yTe, lin.predict(stRaw.apply(test.map((w) => w.raw)))), rmse: rmse(yTe, lin.predict(stRaw.apply(test.map((w) => w.raw)))) },
      { name: "Population model (lags, interaction, covariates)", mae: mae(yTe, popPredTe), rmse: rmse(yTe, popPredTe) },
      { name: "Personalised model", mae: mae(yTe, persPred), rmse: rmse(yTe, persPred) },
    ],
    personalVsPopulationP: wilcoxon(perL.map((l) => l.pers), perL.map((l) => l.pop)).p,
    spearman: names.map((n, j) => ({ variable: n, rho: spearman(ws.map((w) => w.raw[j]), ws.map((w) => w.z)) })),
    bands,
  }
}

// ---------- Component 3: vision ----------
export interface C3Result {
  zoneGeneric: number; zonePersonal: number; zoneP: number
  falseDistraction: { fixed: number; dgd: number; reduction: number }
  phoneRecall: { fixed: number; dgd: number; visible: number; outOfFrame: number }
}

export function deskAnchor(study: SimStudy, pid: string) {
  return mean(study.calibration.filter((c) => c.pid === pid && c.zone === 1 && !c.heldOut).map((c) => c.x[2]))
}
export function dgdDistracted(e: Epoch, mode: string, anchor: number) {
  if (e.phoneInFrame > 0.25) return true
  if (e.zoneAway > 0.5) return true
  const down = e.pitchMean > 15
  if (down) {
    const anchorMatch = Math.abs(e.pitchMean - anchor) < 9
    const reading = e.readingMotion > 0.4
    const keys = mode === "screen" && e.keyboardActive
    return !(anchorMatch && (reading || keys))
  }
  return e.zoneScreen < 0.5 && e.zoneDesk < 0.5
}
export const fixedDistracted = (e: Epoch) => e.pitchMean > 20 || e.zoneScreen < 0.5

export function runC3(study: SimStudy): C3Result {
  const accG: number[] = [], accP: number[] = []
  for (const p of study.participants) {
    const own = study.calibration.filter((c) => c.pid === p.id)
    const others = study.calibration.filter((c) => c.pid !== p.id && !c.heldOut)
    const test = own.filter((c) => c.heldOut), trainOwn = own.filter((c) => !c.heldOut)
    const stG = standardizer(others.map((c) => c.x))
    const gen = fitSoftmax(stG.apply(others.map((c) => c.x)), others.map((c) => c.zone), 3, 150)
    const stP = standardizer(trainOwn.map((c) => c.x))
    const per = fitSoftmax(stP.apply(trainOwn.map((c) => c.x)), trainOwn.map((c) => c.zone), 3, 200)
    accG.push(accuracy(test.map((c) => c.zone), gen(stG.apply(test.map((c) => c.x)))))
    accP.push(accuracy(test.map((c) => c.zone), per(stP.apply(test.map((c) => c.x)))))
  }
  let fFixed = 0, fDgd = 0, nFoc = 0, phone = 0, rFixed = 0, rDgd = 0, vis = 0, visHit = 0, out = 0, outHit = 0
  for (const s of study.sessions) {
    const anchor = deskAnchor(study, s.pid)
    for (const e of s.epochs) {
      if (s.mode === "non-screen" && e.truth === "focused") { nFoc++; if (fixedDistracted(e)) fFixed++; if (dgdDistracted(e, s.mode, anchor)) fDgd++ }
      if (s.mode === "screen" && e.truth === "phone") {
        phone++; const d = dgdDistracted(e, s.mode, anchor)
        if (fixedDistracted(e)) rFixed++; if (d) rDgd++
        if (e.phoneVisible) { vis++; if (d) visHit++ } else { out++; if (d) outHit++ }
      }
    }
  }
  const fixedRate = fFixed / nFoc, dgdRate = fDgd / nFoc
  return {
    zoneGeneric: mean(accG), zonePersonal: mean(accP), zoneP: wilcoxon(accP, accG).p,
    falseDistraction: { fixed: fixedRate, dgd: dgdRate, reduction: 1 - dgdRate / fixedRate },
    phoneRecall: { fixed: rFixed / phone, dgd: rDgd / phone, visible: visHit / Math.max(vis, 1), outOfFrame: outHit / Math.max(out, 1) },
  }
}

// ---------- Component 4: forecasting, alert policy, explanations ----------
export interface C4Result {
  auc: { name: string; auc: number }[]
  dropRate: number; rows: number
  policy: { name: string; recall: number; falsePerHour: number; alertsPerHour: number }[]
  example: { session: string; minute: number; risk: number; threshold: number; contributions: { feature: string; value: number }[]; counterfactual: string; message: string } | null
  sessionTrace: { session: string; focus: number[]; risk: number[]; probes: { t: number; rating: number }[] } | null
}

const C4_NAMES = ["typing rate", "idle ratio", "app switching", "noise (dB)", "temperature", "looking away", "phone in frame", "reading motion", "minutes since start", "last probe (z)", "screen session"]
function c4Vec(s: SimSession, t0: number, lastZ: number, use: { vision: boolean; context: boolean }) {
  const win = s.epochs.slice(Math.max(0, t0 - 3), t0 + 1)
  const m = (f: (e: Epoch) => number) => mean(win.map(f))
  const v = [m((e) => e.typingRate), m((e) => e.idleRatio), m((e) => e.switchRate), m((e) => e.noise), m((e) => e.temp),
    use.vision ? m((e) => e.zoneAway) : 0, use.vision ? m((e) => e.phoneInFrame) : 0, use.vision ? m((e) => e.readingMotion) : 0,
    t0, lastZ, use.context ? (s.mode === "screen" ? 1 : 0) : 0]
  if (use.context) { const scr = s.mode === "screen" ? 1 : 0; v.push(scr * v[0], scr * v[1], (1 - scr) * v[7]) } else v.push(0, 0, 0)
  return v
}

export function runC4(study: SimStudy): C4Result {
  const z = zRatings(study)
  interface R { pid: string; sIndex: number; s: SimSession; t0: number; lastZ: number; y: number }
  const rows: R[] = []
  for (const s of study.sessions) {
    let lastZ = 0
    for (const pr of s.probes) {
      const zz = z(s.pid, pr.rating)
      for (let t0 = Math.max(0, pr.t - 10); t0 <= pr.t - 5; t0++) rows.push({ pid: s.pid, sIndex: s.index, s, t0, lastZ, y: zz <= -1 ? 1 : 0 })
      lastZ = zz
    }
  }
  const pids = study.participants.map((p) => p.id)
  const variants = { full: { vision: true, context: true }, noVision: { vision: false, context: true }, noContext: { vision: true, context: false } }
  const scores: Record<string, number[]> = { full: [], noVision: [], noContext: [] }
  const ys: number[] = [], persist: number[] = [], rowRef: R[] = []
  for (const pid of pids) {
    const tr = rows.filter((r) => r.pid !== pid), te = rows.filter((r) => r.pid === pid)
    for (const [k, use] of Object.entries(variants)) {
      const Xtr = tr.map((r) => c4Vec(r.s, r.t0, r.lastZ, use)), st = standardizer(Xtr)
      const w = fitLogistic(st.apply(Xtr), tr.map((r) => r.y), { iters: 150 })
      scores[k].push(...predictLogistic(w, st.apply(te.map((r) => c4Vec(r.s, r.t0, r.lastZ, use)))))
    }
    ys.push(...te.map((r) => r.y)); persist.push(...te.map((r) => -r.lastZ)); rowRef.push(...te)
  }
  // alert policy: fixed 0.5 vs per-learner threshold tuned on sessions 1–3, tested on sessions 4–6
  const cost = (yy: number[], ss: number[], th: number, hours: number) => {
    const fn = yy.filter((v, i) => v === 1 && ss[i] <= th).length, fp = yy.filter((v, i) => v === 0 && ss[i] > th).length
    const alerts = ss.filter((v) => v > th).length / Math.max(hours, 0.1)
    return 8 * fn + fp + 3 * Math.max(0, alerts - 6)
  }
  const evalPolicy = (pick: (pid: string) => number) => {
    let tp = 0, pos = 0, fp = 0, alerts = 0, hours = 0
    for (const pid of pids) {
      const ix = rowRef.map((r, i) => (r.pid === pid && r.sIndex >= 3 ? i : -1)).filter((i) => i >= 0)
      const th = pick(pid)
      for (const i of ix) { const a = scores.full[i] > th; if (ys[i] === 1) { pos++; if (a) tp++ } else if (a) fp++; if (a) alerts++ }
      hours += (ix.length / 6) * (10 / 60) // each probe contributes ~6 forecast rows covering ~10 minutes
    }
    return { recall: tp / Math.max(pos, 1), falsePerHour: fp / hours, alertsPerHour: alerts / hours }
  }
  const personal = (pid: string) => {
    const ix = rowRef.map((r, i) => (r.pid === pid && r.sIndex < 3 ? i : -1)).filter((i) => i >= 0)
    const hours = (ix.length / 6) * (10 / 60)
    let best = 0.5, bestC = Infinity
    for (let th = 0.2; th <= 0.9; th += 0.05) { const c = cost(ix.map((i) => ys[i]), ix.map((i) => scores.full[i]), th, hours); if (c < bestC) { bestC = c; best = th } }
    return best
  }
  // explained example: among the highest-risk screen-session rows, the first whose risk a small change to
  // changeable factors can bring below the learner's threshold (shows an actionable counterfactual)
  let example: C4Result["example"] = null, sessionTrace: C4Result["sessionTrace"] = null
  const tries: { label: string; set: [number, number][] }[] = [
    { label: "move to a quieter spot (noise 45 dB)", set: [[3, 45]] },
    { label: "put the phone away", set: [[6, 0]] },
    { label: "take a short break (resets time on task)", set: [[8, 0]] },
    { label: "put the phone away and take a short break", set: [[6, 0], [8, 0]] },
    { label: "move to a quieter spot and take a short break", set: [[3, 45], [8, 0]] },
  ]
  const models = new Map<string, { w: number[]; st: ReturnType<typeof standardizer> }>()
  const modelFor = (pid: string) => {
    if (!models.has(pid)) {
      const tr = rows.filter((r) => r.pid !== pid)
      const Xtr = tr.map((r) => c4Vec(r.s, r.t0, r.lastZ, variants.full)), st = standardizer(Xtr)
      models.set(pid, { w: fitLogistic(st.apply(Xtr), tr.map((r) => r.y), { iters: 150 }), st })
    }
    return models.get(pid)!
  }
  const candidates = rowRef.map((r, i) => ({ r, i })).filter(({ r }) => r.s.mode === "screen").sort((a, b) => scores.full[b.i] - scores.full[a.i]).slice(0, 40)
  for (const cand of candidates) {
    const pid = cand.r.pid
    const { w, st } = modelFor(pid)
    const x = c4Vec(cand.r.s, cand.r.t0, cand.r.lastZ, variants.full)
    const xs = st.apply([x])[0]
    const risk = predictLogistic(w, [xs])[0]
    const th = personal(pid)
    if (risk <= th) continue
    let cf = ""
    for (const t2 of tries) {
      const x2 = [...x]; for (const [j, val] of t2.set) x2[j] = val
      const scr = x2[10]; x2[11] = scr * x2[0]; x2[12] = scr * x2[1]; x2[13] = (1 - scr) * x2[7]
      const r2 = predictLogistic(w, st.apply([x2]))[0]
      if (r2 < th) { cf = `Suggested change: ${t2.label} – predicted risk falls from ${risk.toFixed(2)} to ${r2.toFixed(2)} (this learner's threshold ${th.toFixed(2)}).`; break }
    }
    if (!cf && cand !== candidates[candidates.length - 1]) continue
    const contributions = C4_NAMES.map((f, j) => ({ feature: f, value: w[j + 1] * xs[j] })).sort((a, b) => b.value - a.value).slice(0, 3)
    const msg = `Your focus is likely to drop in the next 5–10 minutes (risk ${risk.toFixed(2)}). Main factors: ${contributions.map((c) => c.feature).join(", ")}.`
    example = { session: cand.r.s.id, minute: cand.r.t0, risk, threshold: th, contributions, counterfactual: cf || "No small change to the changeable factors brings the risk below the threshold.", message: msg }
    const riskTrace = cand.r.s.epochs.map((_, t) => predictLogistic(w, st.apply([c4Vec(cand.r.s, t, 0, variants.full)]))[0])
    sessionTrace = { session: cand.r.s.id, focus: cand.r.s.epochs.map((e) => e.focus), risk: riskTrace, probes: cand.r.s.probes.map((p) => ({ t: p.t, rating: p.rating })) }
    break
  }
  return {
    auc: [
      { name: "Persistence (last probe)", auc: rocAuc(ys, persist) },
      { name: "Fused, no vision (H1 ablation)", auc: rocAuc(ys, scores.noVision) },
      { name: "Fused, no context (H2 ablation)", auc: rocAuc(ys, scores.noContext) },
      { name: "Fused + context (proposed)", auc: rocAuc(ys, scores.full) },
    ],
    dropRate: mean(ys), rows: ys.length,
    policy: [{ name: "Fixed threshold 0.5", ...evalPolicy(() => 0.5) }, { name: "Personal threshold (tuned on sessions 1–3)", ...evalPolicy(personal) }],
    example, sessionTrace,
  }
}

export function runAll(study: SimStudy) {
  return { labels: labelStats(study), c1: runC1(study), c2: runC2(study), c3: runC3(study), c4: runC4(study) }
}
export type AllResults = ReturnType<typeof runAll>
