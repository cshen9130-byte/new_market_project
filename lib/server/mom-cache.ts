/**
 * Simple date-keyed file cache for MOM analysis API routes.
 * Cache files live in  data/mom-cache/<YYYY-MM-DD>_<key>.json
 * and are automatically ignored on a different calendar day.
 *
 * On a miss, withMomCache serves a matching stale snapshot (today with an
 * older freshness token, or a previous day's file) and refreshes in the
 * background so the UI is never blocked on a full recompute.
 */

import { NextResponse } from "next/server"
import { ensureAccountRiskSchema } from "@/lib/db"
import { momNhciFreshnessToken } from "@/lib/server/mom-nhci-freshness"
import { momSubAccountAlsRun, parseMomSubAccountParam } from "@/lib/server/mom-sub-account"
import { parseSourceFromRequest, riskSourceAls } from "@/lib/server/risk-data-source"
import {
  findStaleCache,
  freshnessCacheSuffix,
  paramKey,
  readCache,
  todayStr,
  writeCache,
} from "@/lib/server/mom-cache-key"

export {
  beijingDateStr,
  todayStr,
  readCache,
  writeCache,
  normalizeMomCacheParams,
  paramKey,
  clearAccountSourceCache,
  freshnessCacheSuffix,
  clearTodayMomCache,
  quantIdsParamAliases,
  findStaleCache,
} from "@/lib/server/mom-cache-key"
export type { StaleCacheHit } from "@/lib/server/mom-cache-key"

const inflightRefresh = new Map<string, Promise<void>>()

function scheduleBackgroundRefresh(
  key: string,
  handler: (req: Request) => Promise<NextResponse>,
  req: Request,
  transform?: (body: unknown) => unknown,
): void {
  if (inflightRefresh.has(key)) return
  const work = (async () => {
    try {
      const resp = await handler(req)
      if (resp.status !== 200) return
      const body = await resp.json()
      writeCache(key, transform ? transform(body) : body)
    } catch (err) {
      console.error("[mom-cache] background refresh failed", key, err)
    } finally {
      inflightRefresh.delete(key)
    }
  })()
  inflightRefresh.set(key, work)
}

/**
 * Wrap a GET handler with date-keyed file caching.
 * Usage:
 *   export const GET = withMomCache("position-change", handler)
 *
 * If req has ?nocache=1, skips the cache read (but still writes).
 * If req has ?light=1, the full cached body is still used, but heavy
 * timeseries fields are stripped from the response (same cache key).
 */
export type MomCacheOptions = {
  /**
   * Extra freshness token folded into the cache key. When position / NHCI max
   * dates advance mid-day, return a new token so withMomCache misses instead of
   * serving a stale 持仓截面 from an earlier warm.
   */
  freshness?: (req: Request) => Promise<string | null | undefined>
  /** Applied to cache hits, stale hits, and writes. Must be idempotent. */
  transform?: (body: unknown) => unknown
  /**
   * When today's exact key is missing, serve a matching older snapshot and
   * refresh in the background. Defaults to true.
   */
  staleWhileRevalidate?: boolean
  /** Project a first-paint subset when the request has ?light=1. */
  projectLight?: (body: unknown) => unknown
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
  const allowStale = options?.staleWhileRevalidate !== false

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
      const light = url.searchParams.get("light") === "1"
      // MOM charts default to the settlement/NHCI as-of token. Without it, a file
      // written before today's upload keeps serving Friday's 持仓 through midnight.
      const freshnessFn = options?.freshness ?? (source === "mom" ? momNhciFreshnessToken : undefined)
      let fresh = ""
      let freshnessFailed = false
      if (freshnessFn) {
        try {
          fresh = String((await freshnessFn(req)) || "").trim()
        } catch {
          freshnessFailed = true
        }
      }
      // Never fall back to the unsuffixed file when the as-of check was required.
      // That file is the snapshot from before the latest upload.
      const cacheable = !freshnessFailed && (!freshnessFn || fresh.length > 0)
      const paramSuffix = paramKey(url.searchParams)
      const freshSuffix = freshnessCacheSuffix(fresh)
      const key = `${source}__${routeKey}${paramSuffix}${freshSuffix}`

      const wrapLight = (body: unknown, status: "hit" | "stale" | "miss") => {
        // Transform (compact) first, then strip timeseries so the `light` flag
        // is not deleted by the compact step.
        const transformed = options?.transform ? options.transform(body) : body
        const projected = light && options?.projectLight ? options.projectLight(transformed) : transformed
        const extra = status === "stale" ? { cacheStatus: "stale" } : undefined
        let payload: unknown = projected
        if (extra && payload && typeof payload === "object" && !Array.isArray(payload)) {
          payload = { ...(payload as Record<string, unknown>), ...extra }
        }
        return NextResponse.json(payload, {
          headers: { ...cacheHeaders, "X-Mom-Cache": status },
        })
      }

      if (!noCache && cacheable) {
        const cached = readCache(key)
        if (cached !== null) {
          return wrapLight(cached, "hit")
        }
        if (allowStale) {
          const stale = findStaleCache(source, routeKey, paramSuffix, freshSuffix)
          if (stale) {
            // Today's file under an aliased param suffix (no ids vs default ids)
            // is a real hit — do not kick off a recompute.
            if (stale.date === todayStr() && stale.exactFresh) {
              return wrapLight(stale.data, "hit")
            }
            scheduleBackgroundRefresh(key, handler, req, options?.transform)
            return wrapLight(stale.data, "stale")
          }
        }
      }

      // If the freshness probe failed, still try a stale snapshot so the tab
      // is not stuck on 加载中 while the recompute waits on a busy DB.
      if (!noCache && allowStale && !cacheable) {
        const stale = findStaleCache(source, routeKey, paramSuffix, freshSuffix)
        if (stale) {
          scheduleBackgroundRefresh(key, handler, req, options?.transform)
          return wrapLight(stale.data, "stale")
        }
      }

      const resp = await handler(req)

      // Only cache 200 responses, and only under a key that tracks the as-of date.
      if (resp.status === 200 && cacheable) {
        try {
          const body = await resp.json()
          const stored = options?.transform ? options.transform(body) : body
          writeCache(key, stored)
          return wrapLight(stored, "miss")
        } catch {
          // couldn't parse — return original
        }
      }
      return resp
    }))
  }
}
