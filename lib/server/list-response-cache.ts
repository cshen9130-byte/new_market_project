/**
 * Server-side in-memory response cache for the tracking-funds list API.
 *
 * Because runtime = "nodejs" module state persists in the same process,
 * the first request for a given (pool + filters) warms this cache and all
 * subsequent requests within TTL_MS return immediately — no DB round-trip,
 * no enrichTrackFundMetricsRows live SQL.
 *
 * The cache is stored on `global` so it survives Next.js hot-module reloads
 * in development (same pattern as the pg connection pool in lib/db.ts).
 *
 * Mutation routes (batch, add) import invalidateListResponseCache() so they
 * bust relevant entries immediately after writing to the DB.
 */

const TTL_MS = 5 * 60 * 1000 // 5 minutes

type CachedEntry = { body: unknown; ts: number }

declare global {
  // eslint-disable-next-line no-var
  var _listResponseCache: Map<string, CachedEntry> | undefined
  // eslint-disable-next-line no-var
  var _listResponseInFlight: Map<string, Promise<unknown>> | undefined
  // Bumped on invalidation so in-flight list queries cannot repopulate stale entries.
  // eslint-disable-next-line no-var
  var _listResponseCacheGen: number | undefined
}

function cacheGeneration(): number {
  return global._listResponseCacheGen ?? 0
}

function bumpCacheGeneration(): void {
  global._listResponseCacheGen = cacheGeneration() + 1
}

function getCache(): Map<string, CachedEntry> {
  if (!global._listResponseCache) global._listResponseCache = new Map()
  return global._listResponseCache
}

function getInFlight(): Map<string, Promise<unknown>> {
  if (!global._listResponseInFlight) global._listResponseInFlight = new Map()
  return global._listResponseInFlight
}

/**
 * Run `fn` for the given cache key, deduplicating concurrent callers so that
 * only ONE expensive computation fires while others await the same promise.
 * Result is automatically written to the response cache on success.
 */
export async function withListResponseCache(
  key: string,
  fn: () => Promise<unknown>,
): Promise<unknown> {
  const cached = getListResponseCache(key)
  if (cached !== null) return cached

  const inFlight = getInFlight()
  const existing = inFlight.get(key)
  if (existing) return existing

  const genAtStart = cacheGeneration()
  const promise = fn().then(
    (result) => {
      if (cacheGeneration() === genAtStart) setListResponseCache(key, result)
      return result
    },
    (err) => { inFlight.delete(key); throw err },
  ).finally(() => { inFlight.delete(key) })

  inFlight.set(key, promise)
  return promise
}

export function buildListResponseCacheKey(opts: {
  pool: string; page: number; pageSize: number; sortKey: string; sortDir: string
  keyword: string; strategyL1: string; strategyL2: string; strategyL3: string
  strategySource: string; orgSize: string; teamTagMode: string; teamTags: string[]
  personalTagMode: string; personalTags: string[];   personalUserKey: string
  asOfDate: string
  navSource?: string
}): string {
  // "不限" means "no filter" — normalise to "" so it shares a cache entry with
  // requests that omit the param entirely (both produce identical SQL).
  const normOrgSize = opts.orgSize === "不限" ? "" : opts.orgSize
  return JSON.stringify({
    pool: opts.pool, pg: opts.page, ps: opts.pageSize,
    sk: opts.sortKey, sd: opts.sortDir,
    kw: opts.keyword, l1: opts.strategyL1, l2: opts.strategyL2, l3: opts.strategyL3,
    ss: opts.strategySource, os: normOrgSize, ttm: opts.teamTagMode,
    tt: [...opts.teamTags].sort(), ptm: opts.personalTagMode,
    pt: [...opts.personalTags].sort(), uk: opts.personalUserKey, aod: opts.asOfDate,
    ns: opts.navSource ?? "",
  })
}

export function getListResponseCache(key: string): unknown | null {
  const c = getCache()
  const entry = c.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > TTL_MS) { c.delete(key); return null }
  return entry.body
}

export function setListResponseCache(key: string, body: unknown): void {
  const c = getCache()
  // Evict stale entries before writing to keep memory bounded.
  const now = Date.now()
  for (const [k, v] of c) {
    if (now - v.ts > TTL_MS) c.delete(k)
  }
  c.set(key, { body, ts: now })
}

/**
 * Invalidate cache entries for a specific pool (or all entries when poolKey
 * is omitted). Call this from mutation routes after writing to the DB.
 */
function cacheKeyMatchesPool(key: string, poolKey: string): boolean {
  try {
    return (JSON.parse(key) as { pool: string }).pool === poolKey
  } catch {
    return false
  }
}

export function invalidateListResponseCache(poolKey?: string): void {
  bumpCacheGeneration()
  const c = getCache()
  const inFlight = getInFlight()
  if (!poolKey) {
    c.clear()
    inFlight.clear()
    return
  }
  for (const k of c.keys()) {
    if (cacheKeyMatchesPool(k, poolKey)) c.delete(k)
  }
  for (const k of inFlight.keys()) {
    if (cacheKeyMatchesPool(k, poolKey)) inFlight.delete(k)
  }
}
