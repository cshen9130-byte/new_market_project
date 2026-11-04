import { NextResponse } from "next/server"
import { publicQuery } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function accountLabel(account: string, clientName: string | null): string {
  const raw = (clientName ?? "").trim()
  const after = raw.replace(/^.+?(?:私募基金管理有限公司|基金管理有限公司|资产管理有限公司|股份有限公司|有限责任公司|有限公司)/u, "").trim()
  const head = after.match(/^([\u4e00-\u9fffA-Za-z0-9]{2,16}号)/u)
  if (head) return `${account} ${head[1]}`
  if (after && after.length <= 12 && after !== raw) return `${account} ${after}`
  if (raw && raw.length <= 12) return `${account} ${raw}`
  return account
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const fromRaw = (searchParams.get("from") || "").trim()
    const toRaw = (searchParams.get("to") || "").trim()
    const from = DATE_RE.test(fromRaw) ? fromRaw : null
    const to = DATE_RE.test(toRaw) ? toRaw : null

    const conditions: string[] = []
    const params: unknown[] = []
    if (from) {
      params.push(from)
      conditions.push(`trade_date >= $${params.length}::date`)
    }
    if (to) {
      params.push(to)
      conditions.push(`trade_date <= $${params.length}::date`)
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

    const res = await publicQuery<{
      account_no: string
      trade_date: string
      daily_pnl: number | string | null
      margin: number | string | null
      equity: number | string | null
      client_name: string | null
    }>(
      `SELECT account_no,
              trade_date::text AS trade_date,
              COALESCE(daily_pnl, 0) AS daily_pnl,
              COALESCE(margin_occupied, 0) AS margin,
              COALESCE(client_equity, 0) AS equity,
              client_name
       FROM public.cfmmc_daily_summary
       ${where}
       ORDER BY account_no ASC, trade_date ASC`,
      params.length > 0 ? params : undefined,
    )

    type Day = { date: string; pnl: number; margin: number; equity: number }
    const byAccount = new Map<string, { days: Day[]; clientName: string }>()
    for (const row of res.rows) {
      const account = String(row.account_no || "").trim()
      if (!account) continue
      let bucket = byAccount.get(account)
      if (!bucket) {
        bucket = { days: [], clientName: "" }
        byAccount.set(account, bucket)
      }
      const name = (row.client_name ?? "").trim()
      if (name) bucket.clientName = name
      bucket.days.push({
        date: String(row.trade_date).slice(0, 10),
        pnl: Number(row.daily_pnl) || 0,
        margin: Number(row.margin) || 0,
        equity: Number(row.equity) || 0,
      })
    }

    const series = Array.from(byAccount.entries()).map(([account, bucket]) => {
      let cum = 0
      let nominalCapital: number | null = null
      let firstPositiveEquity: number | null = null
      const data = bucket.days.map((day) => {
        cum += day.pnl
        if (firstPositiveEquity == null && day.equity > 0) firstPositiveEquity = day.equity
        if (nominalCapital == null && day.equity >= 100_000) nominalCapital = day.equity
        return { date: day.date, cumPnl: cum, margin: day.margin, equity: day.equity }
      })
      nominalCapital = nominalCapital ?? firstPositiveEquity
      return {
        account,
        label: accountLabel(account, bucket.clientName),
        source: "account" as const,
        nominalCapital,
        data,
      }
    })

    series.sort((a, b) => {
      const aLast = a.data[a.data.length - 1]?.cumPnl ?? 0
      const bLast = b.data[b.data.length - 1]?.cumPnl ?? 0
      return bLast - aLast
    })

    return NextResponse.json({ ok: true, from, to, series })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("cfmmc_daily_summary") || msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, from: null, to: null, series: [] })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
