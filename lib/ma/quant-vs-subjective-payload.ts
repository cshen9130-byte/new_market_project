/**
 * Compact on-the-wire / on-disk encoding for the 量化vs主观 payload.
 *
 * The bulky part is productTs (~1.9 MB of repeated key names) and sectorTs.
 * holdingTs is already a dense numeric grid, so it is left as-is.
 * expand() is idempotent and also accepts the legacy expanded arrays, so
 * yesterday's cache files keep working.
 */

export type CompactTsSeries = {
  v: 1
  d: string[]
  k: string[]
  r: number[]
}

const TS_STRIDE = 6

function isCompactTs(value: unknown): value is CompactTsSeries {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const v = value as CompactTsSeries
  return v.v === 1 && Array.isArray(v.d) && Array.isArray(v.k) && Array.isArray(v.r)
}

function compactTs(
  rows: unknown,
  keyField: "product" | "sector",
): CompactTsSeries | unknown {
  if (rows == null) return rows
  if (isCompactTs(rows)) return rows
  if (!Array.isArray(rows)) return rows
  const d: string[] = []
  const dIdx = new Map<string, number>()
  const k: string[] = []
  const kIdx = new Map<string, number>()
  const r: number[] = []
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue
    const row = raw as Record<string, unknown>
    const date = String(row.date ?? "")
    const key = String(row[keyField] ?? "")
    let di = dIdx.get(date)
    if (di == null) {
      di = d.length
      dIdx.set(date, di)
      d.push(date)
    }
    let ki = kIdx.get(key)
    if (ki == null) {
      ki = k.length
      kIdx.set(key, ki)
      k.push(key)
    }
    r.push(
      di,
      ki,
      Number(row.quantNetPct ?? 0),
      Number(row.subjNetPct ?? 0),
      Number(row.quantEquityPct ?? 0),
      Number(row.subjEquityPct ?? 0),
    )
  }
  return { v: 1, d, k, r }
}

function expandTs(rows: unknown, keyField: "product" | "sector"): unknown {
  if (!isCompactTs(rows)) return rows
  const out: Record<string, unknown>[] = []
  const { d, k, r } = rows
  for (let i = 0; i + TS_STRIDE - 1 < r.length; i += TS_STRIDE) {
    out.push({
      date: d[r[i]] ?? "",
      [keyField]: k[r[i + 1]] ?? "",
      quantNetPct: r[i + 2] ?? 0,
      subjNetPct: r[i + 3] ?? 0,
      quantEquityPct: r[i + 4] ?? 0,
      subjEquityPct: r[i + 5] ?? 0,
    })
  }
  return out
}

const LIGHT_KEYS = new Set(["holdingTs", "productTs", "sectorTs"])

/** Drop the heavy timeseries so first paint can ship without the 3 MB body. */
export function projectQuantVsSubjectiveLight(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body
  const out: Record<string, unknown> = { ...(body as Record<string, unknown>), light: true }
  for (const key of LIGHT_KEYS) delete out[key]
  delete out.cacheStatus
  return out
}

export function compactQuantVsSubjectivePayload<T>(body: T): T {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body
  const src = body as Record<string, unknown>
  const out: Record<string, unknown> = { ...src }
  delete out.cacheStatus
  delete out.light
  if ("productTs" in out) out.productTs = compactTs(out.productTs, "product")
  if ("sectorTs" in out) out.sectorTs = compactTs(out.sectorTs, "sector")
  return out as T
}

export function expandQuantVsSubjectivePayload<T>(body: T): T {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body
  const src = body as Record<string, unknown>
  const out: Record<string, unknown> = { ...src }
  if ("productTs" in out) out.productTs = expandTs(out.productTs, "product")
  if ("sectorTs" in out) out.sectorTs = expandTs(out.sectorTs, "sector")
  return out as T
}
