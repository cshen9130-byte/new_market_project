/**
 * Simple date-keyed file cache for MOM analysis API routes.
 * Cache files live in  data/mom-cache/<YYYY-MM-DD>_<key>.json
 * and are automatically ignored on a different calendar day.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { NextResponse } from "next/server"

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
  const entries = [...params.entries()].filter(([k]) => k !== "nocache")
  if (entries.length === 0) return ""
  return "_" + entries.sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}=${v}`).join("&")
}

/**
 * Wrap a GET handler with date-keyed file caching.
 * Usage:
 *   export const GET = withMomCache("position-change", handler)
 *
 * If req has ?nocache=1, skips the cache read (but still writes).
 */
export function withMomCache(
  routeKey: string,
  handler: (req: Request) => Promise<NextResponse>,
): (req: Request) => Promise<NextResponse> {
  const cacheHeaders = {
    // no-cache: browser always revalidates; server-side file cache still
    // provides the performance benefit (avoids DB queries on every hit).
    "Cache-Control": "no-cache",
  }

  return async (req: Request) => {
    const url = new URL(req.url)
    const noCache = url.searchParams.get("nocache") === "1"
    const key = routeKey + paramKey(url.searchParams)

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
  }
}
