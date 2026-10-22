// Unit tests for the training primitives in lib/sim/ml (run with: npm run test:ml).
const assert = require("assert")
const path = require("path")
const {
  accuracy, fitLinear, fitLogistic, fitSoftmax, kmeans, macroF1, matrixWidth, mean, predictLogistic,
  rocAuc, sd, standardizer, weightedKappa,
} = require(path.resolve(process.argv[2], "ml.js"))

let pass = 0
const ok = (name, fn) => {
  try { fn(); pass++; console.log("  ok  ", name) }
  catch (e) { console.log("  FAIL", name, "-", e.message); process.exitCode = 1 }
}
const close = (a, b, eps = 1e-9) => assert(Math.abs(a - b) < eps, `${a} != ${b}`)

console.log("ml · summary statistics")
ok("mean of an empty list is 0, not NaN", () => assert.equal(mean([]), 0))
ok("sd of an empty list is 1 (unit scale fallback)", () => assert.equal(sd([]), 1))
ok("sd of constant values is 1 (unit scale fallback)", () => assert.equal(sd([5, 5, 5]), 1))

console.log("ml · matrix validation")
ok("matrixWidth reports the number of columns", () => assert.equal(matrixWidth([[1, 2, 3], [4, 5, 6]]), 3))
ok("matrixWidth accepts an empty matrix", () => assert.equal(matrixWidth([]), 0))
ok("ragged matrices are rejected", () => assert.throws(() => matrixWidth([[1, 2], [3]]), /ragged/))
ok("non-finite values are rejected", () => assert.throws(() => matrixWidth([[1, NaN]]), /not a finite/))

console.log("ml · standardizer")
ok("standardises columns to zero mean and unit scale", () => {
  const st = standardizer([[1, 10], [2, 20], [3, 30]])
  const z = st.apply([[1, 10], [2, 20], [3, 30]])
  z[0].forEach((v, j) => close(mean(z.map((r) => r[j])), 0, 1e-9))
  assert(z.flat().every(Number.isFinite))
})
ok("empty input is a no-op instead of a crash", () => {
  const st = standardizer([])
  assert.deepEqual(st.mu, [])
  assert.deepEqual(st.apply([]), [])
})

console.log("ml · logistic regression")
ok("separates a linearly separable problem", () => {
  const X = [[-2], [-1], [1], [2]]
  const y = [0, 0, 1, 1]
  const w = fitLogistic(X, y, { iters: 400 })
  const p = predictLogistic(w, X)
  assert(p[0] < 0.5 && p[1] < 0.5 && p[2] > 0.5 && p[3] > 0.5, JSON.stringify(p))
  assert.equal(accuracy(y, p.map((v) => (v > 0.5 ? 1 : 0))), 1)
})
ok("stays finite on perfectly separable data (no overflow)", () => {
  const w = fitLogistic([[0], [10]], [0, 1], { iters: 500 })
  assert(w.every(Number.isFinite), JSON.stringify(w))
})
ok("empty training set returns a bias-only model", () => {
  const w = fitLogistic([], [])
  assert.deepEqual(w, [0])
  assert.deepEqual(predictLogistic(w, [[1, 2]]), [0.5])
})
ok("single-class labels do not distort the balanced weights", () => {
  const w = fitLogistic([[0], [1], [2]], [0, 0, 0], { iters: 200 })
  assert(w.every(Number.isFinite), JSON.stringify(w))
})
ok("mismatched X/y lengths are rejected", () => assert.throws(() => fitLogistic([[1]], [0, 1]), /rows but/))

console.log("ml · linear and softmax models")
ok("fitLinear recovers a simple line", () => {
  const X = [[0], [1], [2], [3]]
  const y = X.map(([x]) => 3 * x + 1)
  const m = fitLinear(X, y, 0)
  const p = m.predict(X)
  y.forEach((v, i) => close(p[i], v, 1e-6))
})
ok("fitLinear handles empty input without NaN", () => {
  const m = fitLinear([], [])
  assert.deepEqual(m.w, [0])
  assert.deepEqual(m.predict([[1]]), [0])
})
ok("fitSoftmax classifies two well-separated groups", () => {
  const X = [[0], [0.1], [9], [9.1]]
  const y = [0, 0, 1, 1]
  const f = fitSoftmax(X, y, 2, 400)
  assert.deepEqual(f(X), [0, 0, 1, 1])
})
ok("fitSoftmax handles empty input", () => {
  const f = fitSoftmax([], [], 2)
  assert.deepEqual(f([[1, 2]]), [0])
})

console.log("ml · k-means")
ok("finds the obvious two clusters", () => {
  const X = [[0], [0.1], [10], [10.1]]
  const km = kmeans(X, 2, 30)
  assert.equal(km.centroids.length, 2)
  assert.deepEqual(km.assign(X), [0, 0, 1, 1])
})
ok("k is capped at the number of points", () => {
  const km = kmeans([[0], [1]], 4, 10)
  assert.equal(km.centroids.length, 2)
})
ok("empty input returns no centroids and assigns 0", () => {
  const km = kmeans([], 4)
  assert.deepEqual(km.centroids, [])
  assert.deepEqual(km.assign([[1, 2]]), [0])
})
ok("identical points do not crash or produce NaN centroids", () => {
  const km = kmeans([[1, 1], [1, 1], [1, 1]], 4, 10)
  assert(km.centroids.every((c) => c.every(Number.isFinite)))
})

console.log("ml · metrics")
ok("macro-F1 is 1 for a perfect prediction", () => assert.equal(macroF1([0, 0, 1, 1], [0, 0, 1, 1]), 1))
ok("macro-F1 is 0 for an all-wrong prediction", () => assert.equal(macroF1([0, 0, 1, 1], [1, 1, 0, 0]), 0))
ok("ROC-AUC is 1 for a perfectly ranked score", () => assert.equal(rocAuc([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9]), 1))
ok("ROC-AUC is undefined (NaN) with a single class", () => assert(Number.isNaN(rocAuc([1, 1], [0.2, 0.8]))))
ok("weighted kappa is undefined (NaN) with no observations", () => assert(Number.isNaN(weightedKappa([], []))))
ok("weighted kappa is 1 for perfect agreement", () => assert.equal(weightedKappa([1, 3, 5], [1, 3, 5]), 1))

console.log(`\n${pass} passed`)
