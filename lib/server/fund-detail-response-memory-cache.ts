/** Short TTL L1 cache for full private-fund detail API bodies. */

const DETAIL_TTL_MS = 45_000
const DETAIL_CACHE_MAX = 200
const detailResponseCache = new Map<string, { at: number; body: unknown }>()

export function getDetailResponseMemoryCache(key: string): unknown | null {
  const hit = detailResponseCache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at >= DETAIL_TTL_MS) {
    detailResponseCache.delete(key)
    return null
  }
  return hit.body
}

export function rememberDetailResponseMemoryCache(key: string, body: unknown): void {
  detailResponseCache.set(key, { at: Date.now(), body })
  if (detailResponseCache.size <= DETAIL_CACHE_MAX) return
  const oldest = detailResponseCache.keys().next().value
  if (oldest != null) detailResponseCache.delete(oldest)
}

export function invalidateDetailResponseMemoryCache(
  keys: Array<string | null | undefined>,
): void {
  for (const raw of keys) {
    const k = (raw ?? "").trim()
    if (!k) continue
    detailResponseCache.delete(k)
    detailResponseCache.delete(k.toUpperCase())
  }
}
