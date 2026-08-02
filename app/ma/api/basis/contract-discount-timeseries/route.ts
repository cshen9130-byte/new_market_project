import { NextResponse } from "next/server"
import { query, fmtIso, fmtYmd, n } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SYMBOLS = ["IH", "IF", "IC", "IM"] as const
const ROLE_NAMES = ["近月", "次月", "当季", "下季"] as const

function thirdFriday(year: number, month: number): Date {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const pyWeekday = (first.getUTCDay() + 6) % 7 // Mon=0
  const daysToFirstFri = (4 - pyWeekday + 7) % 7
  return new Date(Date.UTC(year, month - 1, 1 + daysToFirstFri + 14))
}

function listedYms(asOf: Date): Array<[number, number]> {
  let y = asOf.getUTCFullYear()
  let m = asOf.getUTCMonth() + 1
  if (asOf.getTime() > thirdFriday(y, m).getTime()) {
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  const near: [number, number] = [y, m]
  let y2 = y
  let m2 = m + 1
  if (m2 > 12) {
    m2 = 1
    y2 += 1
  }
  const nxt: [number, number] = [y2, m2]
  const quarterly: Array<[number, number]> = []
  let yy = y2
  let mm = m2
  while (quarterly.length < 2) {
    mm += 1
    if (mm > 12) {
      mm = 1
      yy += 1
    }
    if (mm === 3 || mm === 6 || mm === 9 || mm === 12) quarterly.push([yy, mm])
  }
  return [near, nxt, quarterly[0], quarterly[1]]
}

function parseRoot(root: string): { symbol: string; year: number; month: number } | null {
  const m = /^(IH|IF|IC|IM)(\d{2})(\d{2})$/.exec(root)
  if (!m) return null
  return { symbol: m[1], year: 2000 + Number(m[2]), month: Number(m[3]) }
}

function parseDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return null
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
}

function ymCode(y: number, m: number): string {
  return `${String(y % 100).padStart(2, "0")}${String(m).padStart(2, "0")}`
}

type Point = {
  date: string
  annualized_discount_pct: number
  spot_close: number
  futures_settle: number
  days_to_maturity: number
}

export async function GET() {
  try {
    const rows = await query<{
      symbol: string
      root: string
      trade_date: Date | string
      settle: string
      spot_close: string
    }>(
      `
      WITH norm AS (
        SELECT
          LEFT(UPPER(SPLIT_PART(contract, '.', 1)), 2) AS symbol,
          UPPER(SPLIT_PART(contract, '.', 1)) AS root,
          trade_date::date AS trade_date,
          -- Sina/AkShare often returns settle=0; prefer positive clear, else close
          COALESCE(NULLIF(clear, 0), NULLIF(close, 0)) AS settle
        FROM raw_futures_contracts_daily
        WHERE contract ~* '^(IH|IF|IC|IM)[0-9]{4}'
      ),
      dedup AS (
        SELECT DISTINCT ON (root, trade_date)
          symbol, root, trade_date, settle
        FROM norm
        WHERE settle IS NOT NULL AND settle::float8 > 0
        ORDER BY root, trade_date, settle DESC
      ),
      spot AS (
        SELECT DISTINCT ON (symbol, trade_date)
          symbol, trade_date, close AS spot_close
        FROM raw_spot_daily
        WHERE symbol = ANY($1)
        ORDER BY symbol, trade_date,
                 CASE WHEN source = 'emquant' THEN 0 ELSE 1 END
      )
      SELECT d.symbol, d.root, d.trade_date, d.settle, s.spot_close
      FROM dedup d
      JOIN spot s
        ON s.symbol = d.symbol AND s.trade_date = d.trade_date
      WHERE d.symbol = ANY($1)
      ORDER BY d.symbol, d.root, d.trade_date ASC
      `,
      [SYMBOLS as unknown as string[]],
    )

    if (!rows.length) {
      return NextResponse.json({ error: "No data" }, { status: 404 })
    }

    const bySymbolRoot: Record<string, Record<string, Point[]>> = {}
    const dates: string[] = []

    for (const r of rows) {
      const parsed = parseRoot(r.root)
      if (!parsed) continue
      const dateStr = fmtIso(r.trade_date)
      const td = parseDate(dateStr)
      const spot = n(r.spot_close)
      const settle = n(r.settle)
      if (!td || spot == null || !(spot > 0) || settle == null) continue

      const expiry = thirdFriday(parsed.year, parsed.month)
      const days = Math.max(1, Math.round((expiry.getTime() - td.getTime()) / 86400000))
      // Skip expired / near-expiry noise (days<=0 already clamped; drop expiry day spikes)
      if (expiry.getTime() < td.getTime()) continue

      const ann = ((spot - settle) / spot / days) * 365 * 100
      if (!Number.isFinite(ann)) continue

      if (!bySymbolRoot[r.symbol]) bySymbolRoot[r.symbol] = {}
      if (!bySymbolRoot[r.symbol][r.root]) bySymbolRoot[r.symbol][r.root] = []
      bySymbolRoot[r.symbol][r.root].push({
        date: dateStr,
        annualized_discount_pct: ann,
        spot_close: spot,
        futures_settle: settle,
        days_to_maturity: days,
      })
      dates.push(fmtYmd(r.trade_date))
    }

    dates.sort()
    const endYmd = dates[dates.length - 1]
    const endDate = parseDate(
      `${endYmd.slice(0, 4)}-${endYmd.slice(4, 6)}-${endYmd.slice(6, 8)}`,
    )
    if (!endDate) {
      return NextResponse.json({ error: "No data" }, { status: 404 })
    }

    // Only currently listed / not-yet-expired month contracts (产品窗口).
    const data: Record<string, Record<string, Point[]>> = {}
    const meta: Record<
      string,
      Record<string, { role: string | null; expiry_date: string; label: string }>
    > = {}

    for (const sym of SYMBOLS) {
      const roots = bySymbolRoot[sym] || {}
      const listed = listedYms(endDate).map(([y, m], idx) => ({
        root: `${sym}${ymCode(y, m)}`,
        role: ROLE_NAMES[idx],
      }))
      const roleByRoot = Object.fromEntries(listed.map((x) => [x.root, x.role]))
      const listedSet = new Set(listed.map((x) => x.root))

      const selected = Object.keys(roots)
        .filter((root) => {
          if (!(roots[root]?.length > 0)) return false
          const parsed = parseRoot(root)
          if (!parsed) return false
          const expiry = thirdFriday(parsed.year, parsed.month)
          // Future / still-listed: expiry on or after latest trade date, or in listing window
          return listedSet.has(root) || expiry.getTime() >= endDate.getTime()
        })
        .sort()

      if (!selected.length) continue
      data[sym] = {}
      meta[sym] = {}
      for (const root of selected) {
        const parsed = parseRoot(root)!
        const expiry = thirdFriday(parsed.year, parsed.month)
        const role = roleByRoot[root] ?? null
        const label = role ? `${root} ${role}` : root
        data[sym][root] = roots[root]
        meta[sym][root] = {
          role,
          expiry_date: fmtIso(expiry),
          label,
        }
      }
    }

    if (!Object.keys(data).length) {
      return NextResponse.json({ error: "No data" }, { status: 404 })
    }

    return NextResponse.json({
      start_date: dates[0],
      end_date: endYmd,
      data,
      meta,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
