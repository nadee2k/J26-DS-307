#!/usr/bin/env node
// Verify that the app's exported C1 model reproduces the Python fixture.
// Usage: npm run verify:c1-model
import { readFileSync } from "node:fs"

const modelUrl = new URL("../public/models/c1.json", import.meta.url)
const fixtureUrl = new URL("../../../research/contracts/c1_fixture.json", import.meta.url)

const exported = JSON.parse(readFileSync(modelUrl, "utf8"))
const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8"))
const model = exported.model

if (!model?.w || !model?.mu || !model?.sg || !model?.names) {
  console.error("c1.json has no model weights")
  process.exit(1)
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z))
let z = model.w[0]
for (let j = 0; j < model.names.length; j++) {
  const mu = model.mu[j] ?? 0
  const sg = model.sg[j] || 1
  z += (model.w[j + 1] ?? 0) * ((fixture.x[j] - mu) / sg)
}
const probability = sigmoid(z)
const diff = Math.abs(probability - fixture.expectedProbability)

console.log(`model:      ${exported.version} (${exported.trainedOn})`)
console.log(`features:   ${model.names.length}`)
console.log(`expected:   ${fixture.expectedProbability}`)
console.log(`recomputed: ${probability}`)
console.log(`max diff:   ${diff}`)

if (diff > (fixture.tolerance ?? 1e-9)) {
  console.error("FAIL: the app model and the Python fixture disagree")
  process.exit(1)
}
console.log("PASS: the app model reproduces the Python fixture")
