import assert from "node:assert/strict"
import test from "node:test"
import {
  fundDisplayNamesMatch,
  fundNameKey,
  shareClassCodeMatchesProduct,
  shareClassLetterFromName,
  shareClassProductNamesMatch,
} from "./fund-name-match"

const BARE = "锦福源乐享2号私募证券投资基金B"
const LABELED = "锦福源乐享2号私募证券投资基金B类"
const PATH = "场外_已上市_开放式_私募_成本.锦福源乐享2号私募证券投资基金B"

test("bare 投资基金B is the same B share class as B类", () => {
  assert.equal(shareClassLetterFromName(BARE), "B")
  assert.equal(shareClassLetterFromName(LABELED), "B")
  assert.equal(shareClassLetterFromName(PATH), "B")
  assert.equal(shareClassProductNamesMatch(PATH, LABELED), true)
  assert.equal(shareClassProductNamesMatch(BARE, "锦福源乐享2号私募证券投资基金A类"), false)
})

test("BAY51B matches a catalog name that omits 类", () => {
  assert.equal(shareClassCodeMatchesProduct("BAY51B", BARE), true)
  assert.equal(shareClassCodeMatchesProduct("BAY51A", BARE), false)
  assert.equal(shareClassCodeMatchesProduct("BAY51B", "普通私募证券投资基金"), false)
})

test("bare letter and B类 collapse to the same fund name", () => {
  assert.equal(fundNameKey(BARE), fundNameKey(LABELED))
  assert.equal(fundNameKey(BARE), "锦福源乐享2号")
  assert.equal(fundDisplayNamesMatch(BARE, LABELED), true)
  assert.equal(fundDisplayNamesMatch(PATH, BARE), true)
  assert.equal(fundDisplayNamesMatch(PATH, LABELED), true)
})
