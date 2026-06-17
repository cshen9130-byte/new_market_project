import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { ensureEmailValuationMetricsTables } from "@/lib/server/email-valuation-metrics-pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Latest 市值 per underlying fund — for syncing to FOF底层. */
export async function GET(req: Request) {
  try {
    await ensureEmailValuationMetricsTables()
    const url = new URL(req.url)
    const conditions: string[] = []
    const params: unknown[] = []
    let idx = 1

    if (url.searchParams.get("underlyingProductCode")) {
      conditions.push(`underlying_product_code = $${idx++}`)
      params.push(url.searchParams.get("underlyingProductCode"))
    }
    if (url.searchParams.get("underlyingName")) {
      conditions.push(`underlying_name ILIKE $${idx++}`)
      params.push(`%${url.searchParams.get("underlyingName")}%`)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
    const rows = await query<{
      underlying_product_code: string | null
      underlying_name: string
      valuation_date: string
      market_value: string | null
      quantity: string | null
      source_fof_product_code: string | null
      source_fof_fund_name: string | null
      refreshed_at: string
    }>(
      `SELECT * FROM ops_email_valuation_underlying_market_latest
       ${where}
       ORDER BY underlying_name`,
      params,
    )

    return NextResponse.json({
      records: rows.map((r) => ({
        underlyingProductCode: r.underlying_product_code,
        underlyingName: r.underlying_name,
        valuationDate: r.valuation_date,
        marketValue: r.market_value,
        quantity: r.quantity,
        sourceFofProductCode: r.source_fof_product_code,
        sourceFofFundName: r.source_fof_fund_name,
        refreshedAt: r.refreshed_at,
      })),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "读取失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
