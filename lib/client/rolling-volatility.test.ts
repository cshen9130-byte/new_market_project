/**
 *   npx tsx --test lib/client/rolling-volatility.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { annualizedGarmanKlassByTime, levelScaleFactor, rollingGarmanKlass, rollingLogVolatility, volPeriodsPerYear } from "./rolling-volatility"

describe("rollingLogVolatility", () => {
  it("stays empty until 20 log returns exist", () => {
    const closes = Array.from({ length: 21 }, () => 100)
    const values = rollingLogVolatility(closes, 20)
    assert.equal(values.slice(0, 20).every((value) => value == null), true)
    assert.equal(values[20], 0)
  })

  it("is the sample standard deviation of the last 20 log returns, in percent", () => {
    const closes = [100]
    for (let i = 0; i < 20; i += 1) closes.push(closes[i]! * Math.exp(i % 2 === 0 ? 0.01 : -0.03))
    const value = rollingLogVolatility(closes, 20).at(-1)
    const rets = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.03))
    const mean = rets.reduce((sum, ret) => sum + ret, 0) / rets.length
    const expected = Math.sqrt(rets.reduce((sum, ret) => sum + (ret - mean) ** 2, 0) / 19) * 100
    assert.ok(value != null)
    assert.ok(Math.abs(value - expected) < 1e-9)
  })
})

describe("rollingGarmanKlass", () => {
  const flat = { open: 100, high: 100, low: 100, close: 100 }

  it("stays empty until 20 bars exist", () => {
    const values = rollingGarmanKlass(Array.from({ length: 20 }, () => flat), 20)
    assert.equal(values.slice(0, 19).every((value) => value == null), true)
    assert.equal(values[19], 0)
  })

  it("is the square root of the mean Garman-Klass variance, in percent", () => {
    const bar = { open: 100, high: 110, low: 90, close: 105 }
    const value = rollingGarmanKlass(Array.from({ length: 20 }, () => bar), 20).at(-1)
    const range = Math.log(110 / 90)
    const body = Math.log(105 / 100)
    const term = 0.5 * range * range - (2 * Math.log(2) - 1) * body * body
    const expected = Math.sqrt(term) * 100
    assert.ok(value != null)
    assert.ok(Math.abs(value - expected) < 1e-9)
  })

  it("floors a negative window at zero and skips a bar with a broken range", () => {
    const inverted = { open: 100, high: 100.1, low: 99.9, close: 110 }
    assert.equal(rollingGarmanKlass(Array.from({ length: 20 }, () => inverted), 20).at(-1), 0)
    const bars = Array.from({ length: 20 }, () => ({ ...flat }))
    bars[10] = { open: 100, high: 90, low: 110, close: 100 }
    assert.equal(rollingGarmanKlass(bars, 20).at(-1), null)
  })

  it("annualizes onto a shared time key", () => {
    assert.equal(volPeriodsPerYear("1d", 240), 252)
    assert.equal(volPeriodsPerYear("1m", 240), 240 * 252)
    const bar = { open: 100, high: 110, low: 90, close: 105 }
    const bars = Array.from({ length: 20 }, (_, i) => ({ ...bar, time: i * 86400 }))
    const raw = rollingGarmanKlass(bars, 20).at(-1)
    const map = annualizedGarmanKlassByTime(bars, 20, 252, (time) => time)
    assert.ok(raw != null)
    const scaled = map.get(19 * 86400)
    assert.ok(scaled != null)
    assert.ok(Math.abs(scaled - raw * Math.sqrt(252)) < 1e-9)
    assert.equal(map.has(0), false)
  })

  it("scales a lower series onto the reference level", () => {
    const reference = [20, 21, 19, 20, 22, null]
    const source = [8, 10, 9, 8, 11, 4]
    const factor = levelScaleFactor(reference, source)
    assert.ok(factor != null)
    assert.ok(Math.abs(factor - 20 / 9) < 1e-9)
    assert.equal(levelScaleFactor([1, 2], [1, 2]), null)
  })
})