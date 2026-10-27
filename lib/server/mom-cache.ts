/**
 * Simple date-keyed file cache for MOM analysis API routes.
 * Cache files live in  data/mom-cache/<YYYY-MM-DD>_<key>.json
 * and are automatically ignored on a different calendar day.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs"
import { join } from "path"
import { NextResponse } from "next/server"
import { ensureAccountRiskSchema } from "@/lib/db"
import { momSubAccountAlsRun, parseMomSubAccountParam } from "@/lib/server/mom-sub-account"
import { parseSourceFromRequest, riskSourceAls } from "@/lib/server/risk-data-source"

const CACHE_DIR = join(process.cwd(), "data", "mom-cache")

function ensureDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true })
}

function todayStr(): string {
  // Use Beijing time (UTC+8) so the cache rolls at midnight CST
  const d = new Date(Date.now() + 8 * 3600_000)
  return d.toISOString().slice(0, 10)
}

/** Return cached value if today's file exists, otherwise null. */
export function readCache<T = unknown>(key: string): T | null {
  try {
    ensureDir()
    const path = join(CACHE_DIR, `${todayStr()}_${key}.json`)
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf-8")) as T
    }
  } catch {
    // ignore read/parse errors — treat as cache miss
  }
  return null
}

/** Persist value to today's cache file.  Silently swallows write errors. */
export function writeCache(key: string, data: unknown): void {
  try {
    ensureDir()
    const path = join(CACHE_DIR, `${todayStr()}_${key}.json`)
    writeFileSync(path, JSON.stringify(data), "utf-8")
  } catch {
    // non-fatal
  }
}

/**
 * Normalise a URLSearchParams into a stable cache-key suffix.
 */
export function paramKey(params: URLSearchParams): string {
  const entries = [...params.entries()].filter(([k]) => k !== "nocache" && k !== "source")
  if (entries.length === 0) return ""
  return "_" + entries.sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}=${v}`).join("&")
}

/** Drop today's cached account-risk (source=account) responses so charts pick up a fresh ETL. */
export function clearAccountSourceCache(): void {
  try {
    ensureDir()
    const prefix = `${todayStr()}_`
    for (const f of readdirSync(CACHE_DIR)) {
      if (!f.startsWith(prefix)) continue
      if (f.includes("account__") || f.includes("source=account")) {
        try { unlinkSync(join(CACHE_DIR, f)) } catch { /* ignore */ }
      }
    }
  } catch {
    // non-fatal
  }
}

/** Drop all of today's MOM file-cache entries (e.g. after NHCI / position ETL advances). */
export function clearTodayMomCache(routeKeySubstring?: string): void {
  try {
    ensureDir()
    const prefix = `${todayStr()}_`
    for (const f of readdirSync(CACHE_DIR)) {
      if (!f.startsWith(prefix)) continue
      if (routeKeySubstring && !f.includes(routeKeySubstring)) continue
      try { unlinkSync(join(CACHE_DIR, f)) } catch { /* ignore */ }
    }
  } catch {
    // non-fatal
  }
}

/**
 * Wrap a GET handler with date-keyed file caching.
 * Usage:
 *   export const GET = withMomCache("position-change", handler)
 *
 * If req has ?nocache=1, skips the cache read (but still writes).
 */
export type MomCacheOptions = {
  /**
   * Extra freshness token folded into the cache key. When position / NHCI max
   * dates advance mid-day, return a new token so withMomCache misses instead of
   * serving a stale 持仓截面 from an earlier warm.
   */
  freshness?: (req: Request) => Promise<string | null | undefined>
}

export function withMomCache(
  routeKey: string,
  handler: (req: Request) => Promise<NextResponse>,
  options?: MomCacheOptions,
): (req: Request) => Promise<NextResponse> {
  const cacheHeaders = {
    // no-cache: browser always revalidates; server-side file cache still
    // provides the performance benefit (avoids DB queries on every hit).
    "Cache-Control": "no-cache",
  }

  return async (req: Request) => {
    const source = parseSourceFromRequest(req)
    const url = new URL(req.url)
    const accountParsed = parseMomSubAccountParam(url.searchParams.get("account"))
    if (accountParsed === false) {
      return NextResponse.json({ ok: false, error: "无效账户" }, { status: 400 })
    }
    return riskSourceAls.run(source, () => momSubAccountAlsRun(accountParsed, async () => {
      if (source === "account") {
        await ensureAccountRiskSchema()
      }

      const noCache = url.searchParams.get("nocache") === "1"
      let fresh = ""
      if (options?.freshness) {
        try {
          fresh = String((await options.freshness(req)) || "").trim()
        } catch {
          fresh = ""
        }
      }
      const freshSuffix = fresh ? `__fresh=${fresh}` : ""
      const key = `${source}__${routeKey}${paramKey(url.searchParams)}${freshSuffix}`

      if (!noCache) {
        const cached = readCache(key)
        if (cached !== null) {
          // no-cache: browser always revalidates; ETag/304 handled by Next.js
          return NextResponse.json(cached, { headers: cacheHeaders })
        }
      }

      const resp = await handler(req)

      // Only cache 200 responses
      if (resp.status === 200) {
        try {
          const body = await resp.json()
          writeCache(key, body)
          return NextResponse.json(body, { headers: cacheHeaders })
        } catch {
          // couldn't parse — return original
        }
      }
      return resp
    }))
  }
}
