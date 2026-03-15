import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type CycleRow = {
  month: string
  social: string | null
  shibor: string | null
  social_ma: string | null
  shibor_ma: string | null
  social_slope: string | null
  shibor_slope: string | null
  monetary_state: string | null
  credit_state: string | null
  monetary: string | null
  credit: string | null
  quadrant: string | null
}

export async function GET() {
  try {
    const rows = await query<CycleRow>(
      `SELECT month, social, shibor, social_ma, shibor_ma,
              social_slope, shibor_slope,
              monetary_state, credit_state, monetary, credit, quadrant
       FROM money_credit_cycle
       ORDER BY month ASC`
    )

    if (rows.length === 0) {
      return NextResponse.json({
        current: null,
        timeseries: [],
        distribution: [],
        recent36: [],
        stateSpace: [],
      })
    }

    // month comes back as "YYYY-MM-DD" string (pg DATE type parser override)
    function fmtMonth(d: string) {
      return typeof d === "string" ? d.slice(0, 7) : String(d).slice(0, 7)
    }

    function n(v: string | null) {
      return v != null ? Number(v) : null
    }

    const timeseries = rows.map((r) => ({
      date: fmtMonth(r.month),
      social: n(r.social),
      shibor: n(r.shibor),
      social_ma: n(r.social_ma),
      shibor_ma: n(r.shibor_ma),
      quadrant: r.quadrant,
    }))

    const validRows = rows.filter((r) => r.quadrant != null)
    const latest = validRows.length > 0 ? validRows[validRows.length - 1] : null

    const current = latest
      ? {
          date: fmtMonth(latest.month),
          monetary_state: latest.monetary_state,
          credit_state: latest.credit_state,
          monetary: latest.monetary,
          credit: latest.credit,
          quadrant: latest.quadrant,
          social_ma: n(latest.social_ma),
          shibor_ma: n(latest.shibor_ma),
        }
      : null

    const counts: Record<string, number> = {}
    for (const r of validRows) {
      if (r.quadrant) counts[r.quadrant] = (counts[r.quadrant] ?? 0) + 1
    }
    const distribution = Object.entries(counts).map(([quadrant, count]) => ({
      quadrant,
      count,
    }))

    const recent36 = validRows
      .slice(-36)
      .map((r) => ({ date: fmtMonth(r.month), quadrant: r.quadrant }))

    const stateSpace = rows
      .filter((r) => r.social_ma != null && r.shibor_ma != null && r.quadrant != null)
      .map((r) => ({
        date: fmtMonth(r.month),
        social_ma: Number(r.social_ma),
        shibor_ma: Number(r.shibor_ma),
        quadrant: r.quadrant,
      }))

    return NextResponse.json({
      current,
      timeseries,
      distribution,
      recent36,
      stateSpace,
    })
  } catch (err) {
    console.error("[money-credit API]", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
