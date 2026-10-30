/**
 * In-memory response + in-flight dedupe cache for Futures Style factor returns.
 * Same process-global pattern as list-response-cache (survives HMR via globalThis).
 *
 * Goal: cache-hit cold start for /ma/api/style-factors/returns in a few hundred ms
 * instead of re-running DB loads + factor compute (~2s+).
 */

const TTL_MS = 15 * 60 * 1000 // 15 minutes
const MAX_ENTRIES = 48

type CachedEntry = { body: unknown; ts: number; maxDate: string | null }

declare global {
  // eslint-disable-next-line no-var
  var _fsStyleResponseCache: Map<string, CachedEntry> | undefined
  // eslint-disable-next-line no-var
  var _fsStyleResponseInFlight: Map<string, Promise<unknown>> | undefined
  // eslint-disable-next-line no-var
  var _fsStyleResponseCacheGen: number | undefined
  // eslint-disable-next-line no-var
  var _fsStyleBoundsCache: { at: number; body: { minDate: string | null; maxDate: string | null } } | undefined
  // eslint-disable-next-line no-var
  var _fsStyleMaterialsCache: Map<string, { at: number; value: unknown }> | undefined
  // eslint-disable-next-line no-var
  var _fsStyleDailyFracCache: Map<string, { at: number; value: unknown }> | undefined
}

function cacheGeneration(): number {
  return global._fsStyleResponseCacheGen ?? 0
}

function bumpCacheGeneration(): void {
  global._fsStyleResponseCacheGen = cacheGeneration() + 1
}

function getCache(): Map<string, CachedEntry> {
  if (!global._fsStyleResponseCache) global._fsStyleResponseCache = new Map()
  return global._fsStyleResponseCache
}

function getInFlight(): Map<string, Promise<unknown>> {
  if (!global._fsStyleResponseInFlight) global._fsStyleResponseInFlight = new Map()
  return global._fsStyleResponseInFlight
}

function evictStale(map: Map<string, { at?: number; ts?: number }>, ttl: number) {
  const now = Date.now()
  for (const [k, v] of map) {
    const t = (v as CachedEntry).ts ?? (v as { at: number }).at ?? 0
    if (now - t > ttl) map.delete(k)
  }
  while (map.size > MAX_ENTRIES) {
    const oldest = map.keys().next().value
    if (oldest == null) break
    map.delete(oldest)
  }
}

export function buildFuturesStyleResponseCacheKey(opts: {
  sector: string
  from: string
  to: string
  auto: boolean
  maxDate?: string | null
}): string {
  // Version bump when payload shape / REPORT_FIT live path changes.
  return JSON.stringify({
    v: 1,
    s: opts.sector,
    f: opts.from,
    t: opts.to,
    a: opts.auto ? 1 : 0,
    // Bind auto windows to data max so a new ETL day misses cleanly.
    m: opts.maxDate ?? "",
  })
}

export function getFuturesStyleResponseCache(key: string): unknown | null {
  const c = getCache()
  const entry = c.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > TTL_MS) {
    c.delete(key)
    return null
  }
  return entry.body
}

export function setFuturesStyleResponseCache(
  key: string,
  body: unknown,
  maxDate: string | null = null,
): void {
  const c = getCache()
  evictStale(c as Map<string, CachedEntry>, TTL_MS)
  c.set(key, { body, ts: Date.now(), maxDate })
}

/**
 * Run `fn` once per key; concurrent callers share the same promise.
 */
export async function withFuturesStyleResponseCache<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<{ body: T; cache: "HIT" | "MISS" | "JOIN" }> {
  const cached = getFuturesStyleResponseCache(key)
  if (cached !== null) return { body: cached as T, cache: "HIT" }

  const inFlight = getInFlight()
  const existing = inFlight.get(key)
  if (existing) {
    const body = (await existing) as T
    return { body, cache: "JOIN" }
  }

  const genAtStart = cacheGeneration()
  const promise = fn()
    .then((result) => {
      if (cacheGeneration() === genAtStart) {
        const maxDate =
          result && typeof result === "object" && "maxDate" in (result as object)
            ? ((result as { maxDate?: string | null }).maxDate ?? null)
            : null
        setFuturesStyleResponseCache(key, result, maxDate)
      }
      return result
    })
    .finally(() => {
      inFlight.delete(key)
    })

  inFlight.set(key, promise)
  const body = (await promise) as T
  return { body, cache: "MISS" }
}

export function invalidateFuturesStyleResponseCache(): void {
  bumpCacheGeneration()
  getCache().clear()
  getInFlight().clear()
  global._fsStyleBoundsCache = undefined
  global._fsStyleMaterialsCache?.clear()
  global._fsStyleDailyFracCache?.clear()
}

const BOUNDS_TTL_MS = 60_000

export function getFuturesStyleBoundsCache(): { minDate: string | null; maxDate: string | null } | null {
  const hit = global._fsStyleBoundsCache
  if (!hit) return null
  if (Date.now() - hit.at > BOUNDS_TTL_MS) {
    global._fsStyleBoundsCache = undefined
    return null
  }
  return hit.body
}

export function setFuturesStyleBoundsCache(body: { minDate: string | null; maxDate: string | null }): void {
  global._fsStyleBoundsCache = { at: Date.now(), body }
}

const MATERIALS_TTL_MS = 15 * 60 * 1000

export function getFuturesStyleMaterialsCache<T>(key: string): T | null {
  if (!global._fsStyleMaterialsCache) global._fsStyleMaterialsCache = new Map()
  const hit = global._fsStyleMaterialsCache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > MATERIALS_TTL_MS) {
    global._fsStyleMaterialsCache.delete(key)
    return null
  }
  return hit.value as T
}

export function setFuturesStyleMaterialsCache(key: string, value: unknown): void {
  if (!global._fsStyleMaterialsCache) global._fsStyleMaterialsCache = new Map()
  evictStale(global._fsStyleMaterialsCache as Map<string, { at: number }>, MATERIALS_TTL_MS)
  global._fsStyleMaterialsCache.set(key, { at: Date.now(), value })
}

const DAILY_FRAC_TTL_MS = 15 * 60 * 1000

export function getFuturesStyleDailyFracCache<T>(key: string): T | null {
  if (!global._fsStyleDailyFracCache) global._fsStyleDailyFracCache = new Map()
  const hit = global._fsStyleDailyFracCache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > DAILY_FRAC_TTL_MS) {
    global._fsStyleDailyFracCache.delete(key)
    return null
  }
  return hit.value as T
}

export function setFuturesStyleDailyFracCache(key: string, value: unknown): void {
  if (!global._fsStyleDailyFracCache) global._fsStyleDailyFracCache = new Map()
  evictStale(global._fsStyleDailyFracCache as Map<string, { at: number }>, DAILY_FRAC_TTL_MS)
  global._fsStyleDailyFracCache.set(key, { at: Date.now(), value })
}
