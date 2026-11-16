import assert from "node:assert/strict"
import test from "node:test"
import { maskPersonName } from "@/lib/ma/mask-person-name"

test("a three-character name keeps the surname and the given-name initials", () => {
  assert.equal(maskPersonName("温雪琴"), "温xq")
  assert.equal(maskPersonName("林海啸"), "林hx")
})

test("a two-character name keeps one initial", () => {
  assert.equal(maskPersonName("罗双"), "罗s")
  assert.equal(maskPersonName("彭瑶"), "彭y")
})

test("a compound surname stays intact", () => {
  assert.equal(maskPersonName("欧阳锋"), "欧阳f")
})

test("a name without Chinese characters is left as written", () => {
  assert.equal(maskPersonName("BEN"), "BEN")
  assert.equal(maskPersonName("  "), "")
})
