import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const from         = searchParams.get("from")
    const to           = searchParams.get("to")
    const code         = searchParams.get("code") || "NHCI.NH"
    const fallbackCode = searchParams.get("fallbackCode") || null

    const buildParams = (primaryCode: string) => {
      const params: unknown[] = [primaryCode]
      const conditions = [`code = $1`, `CAST(close AS float8) > 0`]
      if (from) { params.push(from); conditions.push(`trade_date >= $${params.length}::date`) }
      if (to)   { params.push(to);   conditions.push(`trade_date <= $${params.length}::date`) }
      return { params, conditions }
    }

    // ── Primary: raw_nanhua_indices_daily ─────────────────────────────────────
    const { params, conditions } = buildParams(code)
    const nhSql = `
      SELECT
        trade_date::text                    AS date,
        CAST(open      AS float8)           AS open,
        CAST(high      AS float8)           AS high,
        CAST(low       AS float8)           AS low,
        CAST(close     AS float8)           AS close,
        CAST(COALESCE(volume, 0) AS float8) AS volume
      FROM raw_nanhua_indices_daily
      WHERE ${conditions.join(" AND ")}
      ORDER BY trade_date ASC
    `
    const rows = await query<{
      date: string; open: number; high: number; low: number; close: number; volume: number
    }>(nhSql, params)

    // ── Supplement / fallback: raw_akshare_futures_daily ─────────────────────
    // Always try AkShare when a fallbackCode is given so recent dates missing
    // from raw_nanhua_indices_daily (e.g. close=0 filtered out) are filled in.
    if (fallbackCode) {
      const { params: fbParams, conditions: fbCond } = buildParams(fallbackCode)
      const akSql = `
        SELECT
          trade_date::text                    AS date,
          CAST(open      AS float8)           AS open,
          CAST(high      AS float8)           AS high,
          CAST(low       AS float8)           AS low,
          CAST(close     AS float8)           AS close,
          CAST(COALESCE(volume, 0) AS float8) AS volume
        FROM raw_akshare_futures_daily
        WHERE ${fbCond.join(" AND ")}
        ORDER BY trade_date ASC
      `
      const fbRows = await query<{
        date: string; open: number; high: number; low: number; close: number; volume: number
      }>(akSql, fbParams).catch(() => [] as typeof rows)

      if (rows.length === 0) {
        return NextResponse.json({ ok: true, data: fbRows, source: "akshare" })
      } else if (fbRows.length > 0) {
        // Supplement NH data with AkShare for any dates NH is missing
        const nhDates = new Set(rows.map(r => r.date))
        const supplement = fbRows.filter(r => !nhDates.has(r.date))
        if (supplement.length > 0) {
          const merged = [...rows, ...supplement].sort((a, b) => a.date.localeCompare(b.date))
          return NextResponse.json({ ok: true, data: merged, source: "nh+akshare" })
        }
      }
    }

    return NextResponse.json({ ok: true, data: rows, source: rows.length > 0 ? "nh" : "empty" })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
