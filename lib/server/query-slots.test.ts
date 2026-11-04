/**
 *   npx tsx --test lib/server/query-slots.test.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { QuerySlots, usingQuerySlots } from "./query-slots"

test("query slots never run more than the limit at once", async () => {
  const slots = new QuerySlots(2)
  let active = 0
  let peak = 0
  const jobs = Array.from({ length: 8 }, () => usingQuerySlots(slots, async () => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 20))
    active -= 1
  }))
  await Promise.all(jobs)
  assert.equal(peak, 2)
  assert.equal(active, 0)
})
