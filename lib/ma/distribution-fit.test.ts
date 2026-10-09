/**
 *   npx tsx --test lib/ma/distribution-fit.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  bestParametricFit,
  densityPoints,
  frequencyHistogram,
  rankParametricFits,
  resolveFitMethod,
} from "./distribution-fit"

function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 4294967296
  }
}

function gaussian(rand: () => number): number {
  const u1 = Math.max(rand(), 1e-12)
  const u2 = rand()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

function laplaceDraw(rand: () => number, scale = 1): number {
  let u = rand() - 0.5
  if (Math.abs(u) < 1e-12) u = u < 0 ? -1e-12 : 1e-12
  return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u))
}

function studentT3(rand: () => number): number {
  const z = gaussian(rand)
  let chi = 0
  for (let i = 0; i < 3; i++) {
    const g = gaussian(rand)
    chi += g * g
  }
  return z / Math.sqrt(chi / 3)
}

function sample(n: number, draw: (rand: () => number) => number, seed: number): number[] {
  const rand = lcg(seed)
  return Array.from({ length: n }, () => draw(rand))
}

describe("distribution fit", () => {
  it("picks the normal model for a normal sample", () => {
    const values = sample(1200, (rand) => gaussian(rand) * 1.4 + 0.3, 11)
    const best = bestParametricFit(values)
    assert.equal(best.method, "normal")
    assert.equal(resolveFitMethod(values, "auto"), "normal")
  })

  it("picks the Laplace model for a Laplace sample", () => {
    const values = sample(1200, (rand) => laplaceDraw(rand, 1.2), 29)
    const ranked = rankParametricFits(values)
    const laplace = ranked.find((fit) => fit.method === "laplace")
    const normal = ranked.find((fit) => fit.method === "normal")
    assert.ok(laplace && normal)
    assert.ok(laplace.aic < normal.aic)
    assert.equal(bestParametricFit(values).method, "laplace")
  })

  it("prefers a t distribution when tails are heavy", () => {
    const values = sample(1200, studentT3, 47)
    const ranked = rankParametricFits(values)
    const student = ranked.find((fit) => fit.method === "t")
    const normal = ranked.find((fit) => fit.method === "normal")
    assert.ok(student && normal)
    assert.ok(student.aic < normal.aic)
    assert.equal(bestParametricFit(values).method, "t")
  })

  it("keeps a manual choice and falls back when the sample is short", () => {
    assert.equal(resolveFitMethod([1, 2, 3], "auto"), "normal")
    assert.equal(resolveFitMethod([1, 2, 3, 4, 5, 6, 7, 8, 9], "kde"), "kde")
  })

  it("counts the share of products in each return bin", () => {
    const values = [0, 0, 0, 1, 1, 5]
    const bins = frequencyHistogram(values, -1, 2)
    const holding = (x: number) => bins.find((bin) => x >= bin.left && x < bin.right)
    assert.equal(holding(0)?.count, 3)
    assert.equal(holding(1)?.count, 2)
    assert.equal(bins.reduce((sum, bin) => sum + bin.count, 0), 5)
    assert.ok(Math.abs((holding(0)?.pct ?? 0) - 50) < 0.01)
  })

  it("draws a finite density curve scaled by 100", () => {
    const values = sample(80, (rand) => gaussian(rand), 3)
    const curve = densityPoints(values, "auto", -4, 4, { mean: 0, std: 1 }, 20)
    assert.equal(curve.points.length, 21)
    assert.ok(curve.points.every((point) => Number.isFinite(point[1]) && point[1] >= 0))
    const peak = Math.max(...curve.points.map((point) => point[1]))
    assert.ok(peak > 1)
  })
})
