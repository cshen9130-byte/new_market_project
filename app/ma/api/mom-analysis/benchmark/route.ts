import { NextResponse } from "next/server"
import { query, fmtIso, n } from "@/lib/db"
import { withMomCache } from "@/lib/server/mom-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NH_NAMES: Record<string, string> = {
  "NHCI.NH":  "南华商品指数",
  "NHAI.NH":  "南华农产品指数",
  "NHECI.NH": "南华能化指数",
  "NHFI.NH":  "南华黑色指数",
  "NHPMI.NH": "南华贵金属指数",
  "NHNEI.NH": "南华新能源指数",
  "NHNFI.NH": "南华有色金属指数",
}

async function _GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const from   = sp.get("from") || "2020-01-01"
  const to     = sp.get("to")   || new Date().toISOString().slice(0, 10)
  const codesParam = sp.get("codes") || "NHCI.NH"
  const codes = codesParam.split(",").map(c => c.trim()).filter(c => c in NH_NAMES)

  if (!codes.length) {
    return NextResponse.json({ ok: false, error: "无效的指数代码" }, { status: 400 })
  }

  try {
    const rows = await query<{ trade_date: Date | string; code: string; close: string | number | null }>(
      `SELECT trade_date, code, close
       FROM raw_nanhua_indices_daily
       WHERE trade_date >= $1
         AND trade_date <= $2
         AND code = ANY($3::text[])
         AND close IS NOT NULL
         AND close > 0
       ORDER BY trade_date ASC, code ASC`,
      [from, to, codes],
    )

    const grouped = new Map<string, Array<{ date: string; close: number }>>()
    for (const code of codes) grouped.set(code, [])

    for (const row of rows) {
      const cl = n(row.close)
      if (cl === null) continue
      grouped.get(row.code)?.push({ date: fmtIso(row.trade_date), close: cl })
    }

    const series = codes
      .map(code => ({
        code,
        name: NH_NAMES[code] ?? code,
        data: grouped.get(code) ?? [],
      }))
      .filter(s => s.data.length > 0)

    return NextResponse.json({ ok: true, series })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = withMomCache("benchmark", _GET)
