/** Client-side stale-while-revalidate cache for 团队跟踪 / 我的跟踪 list views. */

const LIST_CACHE_PREFIX = "tracking_list_cache:"

export function invalidateTrackingListCache(poolKeys?: string[]): void {
  if (typeof window === "undefined") return

  const shouldClear = (cacheKey: string): boolean => {
    if (!poolKeys || poolKeys.length === 0) return true
    const params = cacheKey.includes("\u0000") ? cacheKey.split("\u0000").pop() ?? cacheKey : cacheKey
    return poolKeys.some((pool) => params.includes(`pool=${encodeURIComponent(pool)}`))
  }

  try {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(LIST_CACHE_PREFIX)) continue
      const cacheKey = k.slice(LIST_CACHE_PREFIX.length)
      if (shouldClear(cacheKey)) localStorage.removeItem(k)
    }
  } catch { /* ignore quota / access errors */ }

  window.dispatchEvent(
    new CustomEvent("tracking-funds-pool-changed", { detail: { pools: poolKeys ?? [] } }),
  )
}
