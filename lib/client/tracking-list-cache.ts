/** Client-side stale-while-revalidate cache for 团队跟踪 / 我的跟踪 list views. */

const LIST_CACHE_PREFIXES = ["tracking_list_cache_v6:", "tracking_list_cache_v5:", "tracking_list_cache_v4:", "tracking_list_cache_v3:", "tracking_list_cache_v2:", "tracking_list_cache:"]

export function invalidateTrackingListCache(poolKeys?: string[]): void {
  if (typeof window === "undefined") return

  const poolsToCheck = poolKeys && poolKeys.length > 0
    ? [...new Set([...poolKeys, "all"])]
    : null

  const shouldClear = (cacheKey: string): boolean => {
    if (!poolsToCheck) return true
    const params = cacheKey.includes("\u0000") ? cacheKey.split("\u0000").pop() ?? cacheKey : cacheKey
    return poolsToCheck.some((pool) => params.includes(`pool=${encodeURIComponent(pool)}`))
  }

  try {
    for (const k of Object.keys(localStorage)) {
      const prefix = LIST_CACHE_PREFIXES.find((p) => k.startsWith(p))
      if (!prefix) continue
      const cacheKey = k.slice(prefix.length)
      if (shouldClear(cacheKey)) localStorage.removeItem(k)
    }
  } catch { /* ignore quota / access errors */ }

  window.dispatchEvent(
    new CustomEvent("tracking-funds-pool-changed", { detail: { pools: poolKeys ?? [] } }),
  )
}
