/**
 * Module-level + sessionStorage cache for Futures Style returns payloads.
 * Makes revisits / sector toggles feel instant while a background revalidate runs.
 */

export type FuturesStyleClientPayload = {
  ok: true
  from: string
  to: string
  sector: string
  auto?: boolean
  minDate?: string | null
  maxDate?: string | null
  dates: string[]
  source: { prices: string; oiCarry: string; note: string }
  cards: Array<{ key: string; name: string; value: number; sector: string }>
  daily: Array<{ key: string; name: string; color: string; data: number[] }>
  cumulative: Array<{ key: string; name: string; color: string; data: number[] }>
  interval: Array<{ key: string; name: string; sector: string; returns: number[] }>
}

const MEM_TTL_MS = 10 * 60 * 1000
const SS_KEY = "fs_style_returns_v1"
const SS_TTL_MS = 30 * 60 * 1000

type Entry = { at: number; body: FuturesStyleClientPayload }

const mem = new Map<string, Entry>()
const inFlight = new Map<string, Promise<FuturesStyleClientPayload>>()

export function futuresStyleReturnsQueryKey(opts: {
  sector: string
  auto: boolean
  from?: string
  to?: string
}): string {
  if (opts.auto || !opts.from || !opts.to) return `auto|${opts.sector}`
  return `range|${opts.sector}|${opts.from}|${opts.to}`
}

function readSession(key: string): FuturesStyleClientPayload | null {
  if (typeof window === "undefined") return null
  try {
    const raw = sessionStorage.getItem(SS_KEY)
    if (!raw) return null
    const all = JSON.parse(raw) as Record<string, Entry>
    const hit = all?.[key]
    if (!hit || Date.now() - hit.at > SS_TTL_MS) return null
    if (!hit.body || hit.body.ok !== true) return null
    return hit.body
  } catch {
    return null
  }
}

function writeSession(key: string, body: FuturesStyleClientPayload) {
  if (typeof window === "undefined") return
  try {
    const raw = sessionStorage.getItem(SS_KEY)
    const all = (raw ? JSON.parse(raw) : {}) as Record<string, Entry>
    all[key] = { at: Date.now(), body }
    // Keep at most 12 entries
    const keys = Object.keys(all)
    if (keys.length > 12) {
      keys
        .map((k) => ({ k, at: all[k].at }))
        .sort((a, b) => a.at - b.at)
        .slice(0, keys.length - 12)
        .forEach(({ k }) => {
          delete all[k]
        })
    }
    sessionStorage.setItem(SS_KEY, JSON.stringify(all))
  } catch {
    /* quota / private mode */
  }
}

export function getFuturesStyleReturnsCached(key: string): FuturesStyleClientPayload | null {
  const m = mem.get(key)
  if (m && Date.now() - m.at <= MEM_TTL_MS) return m.body
  const ss = readSession(key)
  if (ss) {
    mem.set(key, { at: Date.now(), body: ss })
    return ss
  }
  return null
}

export function setFuturesStyleReturnsCached(key: string, body: FuturesStyleClientPayload) {
  mem.set(key, { at: Date.now(), body })
  writeSession(key, body)
  // Also index auto alias when payload came from auto window
  if (body.auto) {
    const autoKey = `auto|${body.sector}`
    if (autoKey !== key) {
      mem.set(autoKey, { at: Date.now(), body })
      writeSession(autoKey, body)
    }
  }
}

/** Prefetch default auto window; safe to call from page shell. */
export function prefetchFuturesStyleReturns(sector = "all"): void {
  if (typeof window === "undefined") return
  const key = futuresStyleReturnsQueryKey({ sector, auto: true })
  if (getFuturesStyleReturnsCached(key)) return
  if (inFlight.has(key)) return
  void fetchFuturesStyleReturns(key, `/ma/api/style-factors/returns?sector=${encodeURIComponent(sector)}&auto=1`)
}

export async function fetchFuturesStyleReturns(
  key: string,
  url: string,
  signal?: AbortSignal,
): Promise<FuturesStyleClientPayload> {
  const existing = inFlight.get(key)
  if (existing) return existing

  const p = (async () => {
    const res = await fetch(url, {
      signal,
      // Allow browser HTTP cache (server sends Cache-Control).
      headers: { Accept: "application/json" },
    })
    const json = (await res.json()) as FuturesStyleClientPayload | { ok: false; error?: string }
    if (!res.ok || !json || (json as { ok?: boolean }).ok === false) {
      const err = (json as { error?: string })?.error || `加载失败 (${res.status})`
      throw new Error(err)
    }
    const body = json as FuturesStyleClientPayload
    setFuturesStyleReturnsCached(key, body)
    return body
  })().finally(() => {
    inFlight.delete(key)
  })

  inFlight.set(key, p)
  return p
}