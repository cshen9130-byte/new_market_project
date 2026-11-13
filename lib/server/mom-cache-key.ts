/**
 * Date-keyed MOM file-cache helpers (keying, aliasing, stale lookup).
 * Kept free of Next.js / DB imports so unit tests can load it with `tsx --test`.
 */

import { createHash } from "crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs"
import { join } from "path"
import { QUANT_ACCOUNT_IDS, parseQuantIdList } from "@/lib/ma/quant-accounts"

function isDefaultQuantIds(ids: Iterable<number>): boolean {
  const a = [...ids].sort((x, y) => x - y)
  if (a.length !== QUANT_ACCOUNT_IDS.length) return false
  const b = [...QUANT_ACCOUNT_IDS].sort((x, y) => x - y)
  return a.every((n, i) => n === b[i])
}

/** Query keys that must never become part of the file-cache identity. */
const CACHE_KEY_SKIP = new Set(["nocache", "source", "light"])

const STALE_LOOKBACK_DAYS = 7

function cacheDir(): string {
  return process.env.MOM_CACHE_DIR || join(process.cwd(), "data", "mom-cache")
}


function ensureDir() {
  if (!existsSync(cacheDir())) mkdirSync(cacheDir(), { recursive: true })
}

/** Beijing (UTC+8) calendar date, optionally shifted by whole days. */
export function beijingDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + 8 * 3600_000 + offsetDays * 86_400_000)
  return d.toISOString().slice(0, 10)
}

export function todayStr(): string {
  return beijingDateStr(0)
}

function cachePath(date: string, key: string): string {
  return join(cacheDir(), `${date}_${key}.json`)
}

function readCacheFile<T = unknown>(path: string): T | null {
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, "utf-8")) as T
  } catch {
    return null
  }
}

/** Return cached value if today's file exists, otherwise null. */
export function readCache<T = unknown>(key: string): T | null {
  try {
    ensureDir()
    return readCacheFile<T>(cachePath(todayStr(), key))
  } catch {
    // ignore read/parse errors — treat as cache miss
  }
  return null
}

/** Persist value to today's cache file.  Silently swallows write errors. */
export function writeCache(key: string, data: unknown): void {
  try {
    ensureDir()
    writeFileSync(cachePath(todayStr(), key), JSON.stringify(data), "utf-8")
  } catch {
    // non-fatal
  }
}

/**
 * Canonicalise search params so default quantIds and a missing quantIds
 * share one cache key (they already compute the same payload).
 * `light` / `nocache` / `source` are dropped and quantIds are sorted.
 */
export function normalizeMomCacheParams(params: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams()
  const values = new Map<string, string>()
  for (const [k, v] of params.entries()) {
    if (CACHE_KEY_SKIP.has(k)) continue
    values.set(k, v)
  }
  if (values.has("quantIds")) {
    const raw = values.get("quantIds") ?? ""
    if (!raw.trim()) {
      // Explicit empty list means "no quant sleeves", not the default set.
    } else {
      const ids = parseQuantIdList(raw, false)
      if (isDefaultQuantIds(ids)) {
        values.delete("quantIds")
      } else {
        values.set("quantIds", [...ids].sort((a, b) => a - b).join(","))
      }
    }
  }
  for (const [k, v] of [...values.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    out.set(k, v)
  }
  return out
}

/**
 * Normalise a URLSearchParams into a stable cache-key suffix.
 */
export function paramKey(params: URLSearchParams): string {
  const entries = [...normalizeMomCacheParams(params).entries()]
  if (entries.length === 0) return ""
  return "_" + entries.map(([k, v]) => `${k}=${v}`).join("&")
}

/** Drop today's cached account-risk (source=account) responses so charts pick up a fresh ETL. */
export function clearAccountSourceCache(): void {
  try {
    ensureDir()
    const prefix = `${todayStr()}_`
    for (const f of readdirSync(cacheDir())) {
      if (!f.startsWith(prefix)) continue
      if (f.includes("account__") || f.includes("source=account")) {
        try { unlinkSync(join(cacheDir(), f)) } catch { /* ignore */ }
      }
    }
  } catch {
    // non-fatal
  }
}

/** Short stable suffix so a mid-day settlement date change misses today's file cache. */
export function freshnessCacheSuffix(token: string): string {
  const trimmed = token.trim()
  if (!trimmed) return ""
  const digest = createHash("sha1").update(trimmed).digest("hex").slice(0, 12)
  return `__fresh=${digest}`
}

function isAccountRiskCacheFile(name: string): boolean {
  return name.includes("account__") || name.includes("source=account")
}

/** Drop all of today's MOM file-cache entries (e.g. after NHCI / position ETL advances). */
export function clearTodayMomCache(routeKeySubstring?: string): void {
  try {
    ensureDir()
    const prefix = `${todayStr()}_`
    for (const f of readdirSync(cacheDir())) {
      if (!f.startsWith(prefix)) continue
      if (isAccountRiskCacheFile(f)) continue
      if (routeKeySubstring && !f.includes(routeKeySubstring)) continue
      try { unlinkSync(join(cacheDir(), f)) } catch { /* ignore */ }
    }
  } catch {
    // non-fatal
  }
}

export type StaleCacheHit<T = unknown> = {
  data: T
  file: string
  date: string
  exactFresh: boolean
}

/**
 * Param-suffix aliases so a warm without quantIds still matches the UI's
 * default-quantIds request (and vice versa). Custom id lists stay exact.
 */
function suffixFromParams(params: URLSearchParams): string {
  const entries = [...params.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  if (entries.length === 0) return ""
  return "_" + entries.map(([k, v]) => `${k}=${v}`).join("&")
}

export function quantIdsParamAliases(paramSuffix: string): string[] {
  const aliases = new Set<string>([paramSuffix])
  const inner = paramSuffix.startsWith("_") ? paramSuffix.slice(1) : paramSuffix
  const params = new URLSearchParams(inner)
  const raw = params.has("quantIds") ? (params.get("quantIds") ?? "") : null
  if (raw == null) {
    const ids = [...parseQuantIdList(null)].sort((a, b) => a - b)
    params.set("quantIds", ids.join(","))
    aliases.add(suffixFromParams(params))
  } else if (raw.trim() && isDefaultQuantIds(parseQuantIdList(raw, false))) {
    params.delete("quantIds")
    aliases.add(suffixFromParams(params))
  }
  return [...aliases]
}

type CacheCandidate = {
  file: string
  date: string
  params: string
  fresh: string
}

function parseCandidate(name: string, date: string, source: string, routeKey: string): CacheCandidate | null {
  const prefix = `${date}_${source}__${routeKey}`
  if (!name.startsWith(prefix) || !name.endsWith(".json")) return null
  const rem = name.slice(prefix.length, -".json".length)
  const idx = rem.indexOf("__fresh=")
  const params = idx >= 0 ? rem.slice(0, idx) : rem
  const fresh = idx >= 0 ? rem.slice(idx) : ""
  return { file: name, date, params, fresh }
}

/**
 * Find a stale but usable snapshot for this route + params.
 * Preference: today with any freshness, then previous days (same freshness first).
 */
export function findStaleCache<T = unknown>(
  source: string,
  routeKey: string,
  paramSuffix: string,
  freshSuffix: string,
): StaleCacheHit<T> | null {
  try {
    ensureDir()
    const aliases = new Set(quantIdsParamAliases(paramSuffix))
    const names = readdirSync(cacheDir())
    const picks: StaleCacheHit<T>[] = []
    for (let offset = 0; offset <= STALE_LOOKBACK_DAYS; offset++) {
      const date = beijingDateStr(-offset)
      for (const name of names) {
        const parsed = parseCandidate(name, date, source, routeKey)
        if (!parsed) continue
        if (!aliases.has(parsed.params)) continue
        if (offset === 0 && parsed.fresh === freshSuffix && parsed.params === paramSuffix) continue
        const data = readCacheFile<T>(join(cacheDir(), name))
        if (data == null) continue
        picks.push({
          data,
          file: name,
          date,
          exactFresh: parsed.fresh === freshSuffix,
        })
      }
      if (picks.length) break
    }
    if (!picks.length) return null
    picks.sort((a, b) => {
      if (a.exactFresh !== b.exactFresh) return a.exactFresh ? -1 : 1
      return b.file.localeCompare(a.file)
    })
    return picks[0]
  } catch {
    return null
  }
}

