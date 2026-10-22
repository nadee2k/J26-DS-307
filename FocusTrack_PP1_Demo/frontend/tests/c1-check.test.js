// Unit tests for the model-check helpers (run with: npm run test:check).
const assert = require("assert")
const path = require("path")
const {
  recomputeC1Scores, verifyC1Scores, scoreContributions, contributionText,
} = require(path.resolve(process.argv[2], "focus/c1-check.js"))

let pass = 0
const ok = (name, fn) => {
  try { fn(); pass++; console.log("  ok  ", name) }
  catch (e) { console.log("  FAIL", name, "-", e.message); process.exitCode = 1 }
}
const close = (a, b, eps = 1e-9) => assert(Math.abs(a - b) < eps, `${a} != ${b}`)

const features = {
  typingRate: 1, interKeyVar: 0.5, backspaceRatio: 0.1, idleRatio: 0.5,
  mouseSpeed: 20, switchRate: 0, scrollRate: 0, keyboardActive: true,
  state: 0, stateLabel: "Sustained typing", dwell: 1, changes: 0, awayShare: 0,
}

// Only the typing-rate coefficient is non-zero, so the expected probability is sigmoid(typingRate).
const names = [
  "typing rate", "idle time", "app switching", "mouse activity", "typing rhythm variability",
  "corrections", "screen session", "typing (screen)", "idle (screen)", "switching (screen)",
]
const model = {
  w: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  mu: Array(10).fill(0),
  sg: Array(10).fill(1),
  names,
}
const expected = 1 / (1 + Math.exp(-1))

console.log("C1 model check · score reproduction")
ok("the exact stored score is recomputed from the trained weights", () => {
  const scores = recomputeC1Scores([{ f: features, p: expected }], model, false)
  close(scores[0], expected)
})
ok("matching stored scores pass verification", () => {
  const result = verifyC1Scores([{ f: features, p: expected }], model, false)
  assert(result.ok)
  assert.equal(result.count, 1)
  assert(result.maxDiff < 1e-12)
})
ok("tampered stored scores are reported", () => {
  const result = verifyC1Scores([{ f: features, p: expected + 0.2 }], model, false)
  assert(!result.ok)
  assert.equal(result.mismatches.length, 1)
  assert(result.maxDiff > 0.19)
})
ok("smoothing uses the preceding epochs, not only the latest one", () => {
  const epochs = [
    { f: { ...features, typingRate: 0 }, p: 0 },
    { f: { ...features, typingRate: 2 }, p: 0 },
  ]
  const scores = recomputeC1Scores(epochs, model, false)
  close(scores[0], 1 / (1 + Math.exp(0))) // first epoch: typingRate 0 -> 0.5
  close(scores[1], 1 / (1 + Math.exp(-1))) // mean typingRate 1 -> 0.731
})

console.log("C1 model check · contributions")
ok("a positive contribution is described as helping", () => {
  const { contributions } = scoreContributions([{ f: features, p: expected }], model, false)
  assert.equal(contributions[0].feature, "typing rate")
  close(contributions[0].contribution, 1)
  assert.equal(contributions[0].direction, "helps")
  assert(contributionText(contributions[0]).includes("Typing activity is helping"))
})
ok("a negative coefficient is described as pulling focus down", () => {
  const negative = { ...model, w: [0, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0] }
  const { contributions } = scoreContributions([{ f: features, p: expected }], negative, false)
  assert.equal(contributions[0].direction, "hurts")
  assert(contributionText(contributions[0]).includes("Very little typing"))
})
ok("an empty history is handled safely", () => {
  const { contributions } = scoreContributions([], model, false)
  assert.deepEqual(contributions, [])
})

console.log(`\n${pass} passed`)
