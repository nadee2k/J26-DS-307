// Unit tests for the component logic in lib/focus (run with: npm run test:logic).
const assert = require("assert")
const path = require("path")
const L = (m) => require(path.resolve(process.argv[2], m))
const { headPose, irisOffset, fixedZone } = L("vision-math.js")
const { fitZoneModel, predictZone } = L("zone-model.js")
const { readingLike, dgdFrame, aggregateC3, readingMotionScore } = L("c3.js")
const { hampel, aggregateC2, toDb, toLux, DEFAULT_CALIBRATION, comfortBand } = L("c2.js")
const { computeC1 } = L("c1.js")
let pass = 0
const ok = (name, fn) => { try { fn(); pass++; console.log("  ok  ", name) } catch (e) { console.log("  FAIL", name, "-", e.message); process.exitCode = 1 } }

// ---------- synthetic 3D face (pixel units, y down, z away from the camera) ----------
const W = 640, H = 480
const base = {
  33: [-45, -25, 10], 133: [-15, -25, 12], 159: [-30, -32, 8], 145: [-30, -18, 8],
  263: [45, -25, 10], 362: [15, -25, 12], 386: [30, -32, 8], 374: [30, -18, 8],
  10: [0, -95, 15], 152: [0, 95, 15], 1: [0, 10, -25], 234: [-75, 0, 40], 454: [75, 0, 40],
  468: [-30, -25, 8], 473: [30, -25, 8],
}
function face(pitchDeg, yawDeg, irisShift = [0, 0], centre = [320, 240]) {
  const p = (pitchDeg * Math.PI) / 180, y = (yawDeg * Math.PI) / 180
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
  for (const [k, v0] of Object.entries(base)) {
    let [x, yy, z] = v0
    if (k === "468" || k === "473") { x += irisShift[0]; yy += irisShift[1] }
    // pitch about x (positive = looking down: chin moves away from the camera)
    let y1 = yy * Math.cos(p) - z * Math.sin(p), z1 = yy * Math.sin(p) + z * Math.cos(p)
    // yaw about y
    const x2 = x * Math.cos(y) + z1 * Math.sin(y), z2 = -x * Math.sin(y) + z1 * Math.cos(y)
    lm[Number(k)] = { x: (centre[0] + x2) / W, y: (centre[1] + y1) / H, z: z2 / W }
  }
  return lm
}

console.log("C3 head pose and gaze")
ok("pitch is recovered (0, 15, 30 degrees down)", () => {
  for (const d of [0, 15, 30]) { const e = headPose(face(d, 0), W, H); assert(Math.abs(e.pitch - d) < 3, `pitch ${d} -> ${e.pitch.toFixed(1)}`) }
})
ok("looking up gives negative pitch", () => { assert(headPose(face(-15, 0), W, H).pitch < -10) })
ok("yaw is recovered (±25 degrees)", () => {
  const a = headPose(face(0, 25), W, H).yaw, b = headPose(face(0, -25), W, H).yaw
  assert(Math.abs(Math.abs(a) - 25) < 3 && Math.abs(Math.abs(b) - 25) < 3 && Math.sign(a) !== Math.sign(b), `${a} ${b}`)
})
ok("pose does not depend on where the face is in the frame (the old bug)", () => {
  const a = headPose(face(10, 0, [0, 0], [200, 150]), W, H), b = headPose(face(10, 0, [0, 0], [450, 330]), W, H)
  assert(Math.abs(a.pitch - b.pitch) < 0.5 && Math.abs(a.yaw - b.yaw) < 0.5)
})
ok("iris offset is relative to the eye corners", () => {
  const c = irisOffset(face(0, 0), W, H), r = irisOffset(face(0, 0, [8, 0]), W, H), moved = irisOffset(face(0, 0, [0, 0], [450, 300]), W, H)
  assert(Math.abs(c.x) < 0.05 && r.x > 0.3, `centre ${c.x} right ${r.x}`)
  assert(Math.abs(moved.x - c.x) < 0.01, "moving the head in the frame must not change the iris offset")
})
ok("fixed-angle rule zones", () => { assert.equal(fixedZone(30, 0), 1); assert.equal(fixedZone(0, 40), 2); assert.equal(fixedZone(2, 3), 0) })

console.log("C3 personal zone model")
ok("three zones are separated on held-out samples", () => {
  const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647) })()
  const n = () => (rnd() - 0.5) * 2
  const sample = (zone) => zone === 0 ? [n() * 0.1, -0.1 + n() * 0.1, 5 + n() * 3, n() * 4] : zone === 1 ? [n() * 0.1, 0.4 + n() * 0.1, 28 + n() * 4, n() * 4] : [0.6 + n() * 0.2, n() * 0.2, n() * 6, 30 + n() * 6]
  const train = [], test = []
  for (const z of [0, 1, 2]) for (let i = 0; i < 40; i++) (i < 28 ? train : test).push({ x: sample(z), zone: z })
  const m = fitZoneModel(train)
  const acc = test.filter((t) => predictZone(m, { irisX: t.x[0], irisY: t.x[1], pitch: t.x[2], yaw: t.x[3] }).zone === t.zone).length / test.length
  assert(acc > 0.9, `accuracy ${acc}`)
})

console.log("C3 Downward-Gaze Disambiguation")
const frame = (o) => ({ t: 0, face: true, yaw: 0, pitch: 28, roll: 0, irisX: 0, irisY: 0.3, faceSize: 0.3, luminance: 120, glare: 0, phone: false, phoneScore: 0, zone: 1, zoneProb: 0.9, ...o })
const reading = Array.from({ length: 30 }, (_, i) => frame({ t: i * 333, yaw: 2 * Math.sin(i / 2), irisX: 0.25 * Math.sin(i / 1.5) }))
const staring = Array.from({ length: 30 }, (_, i) => frame({ t: i * 333 }))
const ctx = { mode: "non-screen", deskAnchor: 28, screenPitch: 4, keyboardActive: false, readingNow: false }
ok("reading-like motion is detected while reading", () => assert(readingLike(reading, ctx)))
ok("a still downward look is not reading", () => assert(!readingLike(staring, ctx)))
ok("phone in frame -> phone", () => assert.equal(dgdFrame(frame({ phone: true }), ctx), "phone"))
ok("desk anchor + reading motion -> reading (focused)", () => assert.equal(dgdFrame(frame({}), { ...ctx, readingNow: true }), "reading"))
ok("screen session + keyboard -> typing", () => assert.equal(dgdFrame(frame({}), { ...ctx, mode: "screen", keyboardActive: true }), "typing"))
ok("down, no reading, no keyboard -> possible phone out of frame", () => assert.equal(dgdFrame(frame({}), ctx), "unclear"))
ok("looking at the screen -> screen", () => assert.equal(dgdFrame(frame({ zone: 0, pitch: 4 }), ctx), "screen"))
ok("no face -> no-face", () => assert.equal(dgdFrame(frame({ face: false }), ctx), "no-face"))
ok("epoch aggregation", () => {
  const states = reading.map(() => "reading")
  const a = aggregateC3(reading, states, ctx, true)
  assert(a.zoneDesk > 0.99 && a.validFace === 1 && a.dgdState === "reading" && a.readingMotion > 0.5, JSON.stringify(a))
})

console.log("C2 cleaning and features")
ok("Hampel filter removes a single spike", () => {
  const xs = [45, 46, 45, 47, 90, 46, 45, 46, 44]
  const h = hampel(xs)
  assert.equal(h.removed, 1); assert.equal(h.values[4], null)
})
ok("missing readings are counted, not stored as 0", () => {
  const rs = Array.from({ length: 15 }, (_, i) => ({ t: i * 1000, temp: i === 3 ? null : 28, humidity: 70, light: 300, noise: 46, motion: false, calibrated: true }))
  const a = aggregateC2(rs, 0, 15000, { noise: [37, 60], temp: [23, 29], personal: false, basis: 0 })
  assert(Math.abs(a.temp - 28) < 1e-9 && a.missingRatio > 0, JSON.stringify(a))
})
ok("comfort index is the distance outside the band", () => {
  const rs = Array.from({ length: 10 }, (_, i) => ({ t: i * 1000, temp: 31, humidity: 70, light: 300, noise: 66, motion: false, calibrated: true }))
  const a = aggregateC2(rs, 0, 10000, { noise: [37, 60], temp: [23, 29], personal: false, basis: 0 })
  assert(Math.abs(a.comfortNoise - 6) < 1e-6 && Math.abs(a.comfortTemp - 2) < 1e-6)
})
ok("two-point calibration maps the reference points exactly", () => {
  const c = DEFAULT_CALIBRATION
  assert(Math.abs(toLux(c.light[0].raw, c) - c.light[0].value) < 1e-6 && Math.abs(toDb(c.sound[1].raw, c) - c.sound[1].value) < 1e-6)
})
ok("personal band needs at least 8 high-focus minutes", () => {
  const pop = { noise: [37, 60], temp: [23, 29], personal: false, basis: 0 }
  assert.equal(comfortBand([{ noise: 40, temp: 25 }], pop).personal, false)
  assert.equal(comfortBand(Array.from({ length: 10 }, (_, i) => ({ noise: 40 + i, temp: 25 })), pop).personal, true)
})

console.log("C1 interaction features")
ok("rates, corrections, idle time and switching", () => {
  const ev = []
  for (let i = 0; i < 30; i++) ev.push({ t: 1000 + i * 300, kind: i % 10 === 9 ? "back" : "key" })
  ev.push({ t: 20000, kind: "leave" }, { t: 25000, kind: "return" })
  const f = computeC1(ev, 0, 60000, false, [], null)
  assert(Math.abs(f.typingRate - 30) < 1e-9, "typing rate per minute")
  assert(Math.abs(f.backspaceRatio - 0.1) < 1e-9, "corrections")
  assert(f.idleRatio > 0.8 && f.switchRate === 1 && Math.abs(f.awayShare - 5 / 60) < 1e-9, JSON.stringify(f))
})
console.log(`\n${pass} passed`)
