/**
 *   npx tsx --test lib/server/mom-cache.test.ts
 */
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { QUANT_ACCOUNT_IDS } from "../ma/quant-accounts"
import {
  beijingDateStr,
  findStaleCache,
  paramKey,
  quantIdsParamAliases,
} from "./mom-cache-key"

const DEFAULT_IDS = [...QUANT_ACCOUNT_IDS].sort((a, b) => a - b).join(",")

test("paramKey aliases missing quantIds with the default QUANT_ACCOUNT_IDS list", () => {
  const none = paramKey(new URLSearchParams())
  const def = paramKey(new URLSearchParams({ quantIds: DEFAULT_IDS }))
  const shuffled = paramKey(new URLSearchParams({
    quantIds: [...QUANT_ACCOUNT_IDS].slice().reverse().join(","),
  }))
  const light = paramKey(new URLSearchParams({ quantIds: DEFAULT_IDS, light: "1" }))
  const nocache = paramKey(new URLSearchParams({ quantIds: DEFAULT_IDS, nocache: "1" }))
  assert.equal(none, "")
  assert.equal(def, "")
  assert.equal(shuffled, "")
  assert.equal(light, "")
  assert.equal(nocache, "")
})

test("paramKey keeps a custom quantIds list and an explicit empty list distinct", () => {
  const custom = paramKey(new URLSearchParams({ quantIds: "319,324" }))
  const empty = paramKey(new URLSearchParams({ quantIds: "" }))
  const missing = paramKey(new URLSearchParams())
  assert.equal(custom, "_quantIds=319,324")
  assert.notEqual(custom, missing)
  assert.equal(empty, "_quantIds=")
  assert.notEqual(empty, missing)
})

test("paramKey still distinguishes as-of date filters", () => {
  const dated = paramKey(new URLSearchParams({ date: "2026-08-01", quantIds: DEFAULT_IDS }))
  const datedCustom = paramKey(new URLSearchParams({ date: "2026-08-01", quantIds: "319" }))
  assert.equal(dated, "_date=2026-08-01")
  assert.equal(datedCustom, "_date=2026-08-01&quantIds=319")
})

test("quantIdsParamAliases maps default ids to the unsuffixed warm key", () => {
  const aliases = new Set(quantIdsParamAliases(`_quantIds=${DEFAULT_IDS}`))
  assert.ok(aliases.has(""))
  assert.ok(aliases.has(`_quantIds=${DEFAULT_IDS}`))
  const dated = new Set(quantIdsParamAliases(`_date=2026-08-01&quantIds=${DEFAULT_IDS}`))
  assert.ok(dated.has("_date=2026-08-01"))
})

test("findStaleCache uses today's no-quantIds warm as an alias hit", () => {
  const dir = mkdtempSync(join(tmpdir(), "mom-cache-"))
  const prev = process.env.MOM_CACHE_DIR
  process.env.MOM_CACHE_DIR = dir
  try {
    const today = beijingDateStr(0)
    const fresh = "__fresh=4b20308aaf50"
    writeFileSync(
      join(dir, `${today}_mom__quant-vs-subjective-v12${fresh}.json`),
      JSON.stringify({ ok: true, source: "today-noid" }),
    )
    const hit = findStaleCache(
      "mom",
      "quant-vs-subjective-v12",
      `quantIds=${DEFAULT_IDS}`.replace(/^/, "_"),
      fresh,
    )
    assert.ok(hit)
    assert.equal((hit!.data as { source: string }).source, "today-noid")
    assert.equal(hit!.date, today)
    assert.equal(hit!.exactFresh, true)
  } finally {
    if (prev == null) delete process.env.MOM_CACHE_DIR
    else process.env.MOM_CACHE_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
})

test("findStaleCache falls back to yesterday when today is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "mom-cache-"))
  const prev = process.env.MOM_CACHE_DIR
  process.env.MOM_CACHE_DIR = dir
  try {
    const yesterday = beijingDateStr(-1)
    const fresh = "__fresh=abc111111111"
    writeFileSync(
      join(dir, `${yesterday}_mom__quant-vs-subjective-v12_quantIds=${DEFAULT_IDS}${fresh}.json`),
      JSON.stringify({ ok: true, source: "yesterday" }),
    )
    const hit = findStaleCache("mom", "quant-vs-subjective-v12", "", fresh)
    assert.ok(hit)
    assert.equal((hit!.data as { source: string }).source, "yesterday")
    assert.equal(hit!.date, yesterday)
    assert.equal(hit!.exactFresh, true)
  } finally {
    if (prev == null) delete process.env.MOM_CACHE_DIR
    else process.env.MOM_CACHE_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
})
