/** One stored 1-minute print for an option contract or its underlying. */
export type StoredMinute = {
  underlyingKey: string
  contractId: string
  side: "call" | "put" | "spot"
  monthCode: string
  strike: number | null
  expireDay: string | null
  /** Shanghai calendar date YYYY-MM-DD. */
  day: string
  hhmm: string
  price: number
  volume: number | null
  /** CFFEX market id. ETF rows leave this empty. */
  market?: number
}

export type CaptureContract = {
  underlyingKey: string
  contractId: string
  side: "call" | "put" | "spot"
  monthCode: string
  strike: number | null
  expireDay: string | null
  market?: number
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      out[index] = await fn(items[index]!, index)
    }
  })
  await Promise.all(workers)
  return out
}

export function inSessionMinute(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return false
  const n = h * 60 + m
  return (n >= 9 * 60 + 30 && n <= 11 * 60 + 30) || (n >= 13 * 60 && n <= 15 * 60)
}
