import { NextResponse } from "next/server"
import { fmtIso, n, query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const INDEX_CODE = process.env.ASHARE_INDEX_CODE || "000300.SH"

interface CrowdingRow {
  trade_date: Date | string
  total_amount: string | number | null
  market_turn: string | number | null
  hhi: string | number | null
  top3_share: string | number | null
  top10_share: string | number | null
  crowding_pct: string | number | null
  crowding_smooth: string | number | null
  top_board: string | null
  top_board_share: string | number | null
  board_shares: Record<string, number> | string | null
}

interface TopStockRow {
  ts_code: string
  name: string | null
  amount: string | number | null
  share: string | number | null
}

interface IndexRow {
  trade_date: Date | string
  close: string | number | null
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const days = Math.min(365, Math.max(30, parseInt(searchParams.get("days") || "90", 10)))

  try {
    const seriesRows = await query<CrowdingRow>(
      `SELECT trade_date, total_amount, market_turn, hhi, top3_share, top10_share,
              crowding_pct, crowding_smooth, top_board, top_board_share, board_shares
       FROM derived_ashare_crowding_daily
       ORDER BY trade_date DESC
       LIMIT $1`,
      [days],
    )

    if (!seriesRows.length) {
      return NextResponse.json({ error: "No crowding data" }, { status: 404 })
    }

    const series = [...seriesRows]
      .reverse()
      .map((r) => {
        let boards: Record<string, number> = {}
        if (r.board_shares) {
          boards = typeof r.board_shares === "string"
            ? JSON.parse(r.board_shares)
            : r.board_shares
        }
        const smooth = n(r.crowding_smooth)
        const raw = n(r.crowding_pct)
        return {
          date: fmtIso(r.trade_date),
          total_amount: n(r.total_amount),
          market_turn: n(r.market_turn),
          hhi: n(r.hhi),
          top3_share: n(r.top3_share),
          top10_share: n(r.top10_share),
          crowding_pct: smooth ?? raw,
          crowding_raw: raw,
          crowding_smooth: smooth,
          top_board: r.top_board,
          top_board_share: n(r.top_board_share),
          board_shares: boards,
        }
      })

    const latest = series[series.length - 1]

    const topStocksSqlWithNames = `WITH latest AS (
         SELECT MAX(trade_date) AS d FROM raw_ashare_daily
       ),
       tot AS (
         SELECT COALESCE(SUM(amount), 0) AS t
         FROM raw_ashare_daily
         WHERE trade_date = (SELECT d FROM latest)
       )
       SELECT r.ts_code,
              s.name,
              r.amount,
              ROUND((r.amount / NULLIF(tot.t, 0) * 100)::numeric, 2) AS share
       FROM raw_ashare_daily r
       LEFT JOIN dim_ashare_stock s ON s.ts_code = r.ts_code
       CROSS JOIN tot
       WHERE r.trade_date = (SELECT d FROM latest)
         AND r.amount > 0
       ORDER BY r.amount DESC
       LIMIT 15`

    const topStocksSqlCodesOnly = `WITH latest AS (
         SELECT MAX(trade_date) AS d FROM raw_ashare_daily
       ),
       tot AS (
         SELECT COALESCE(SUM(amount), 0) AS t
         FROM raw_ashare_daily
         WHERE trade_date = (SELECT d FROM latest)
       )
       SELECT r.ts_code,
              NULL::text AS name,
              r.amount,
              ROUND((r.amount / NULLIF(tot.t, 0) * 100)::numeric, 2) AS share
       FROM raw_ashare_daily r
       CROSS JOIN tot
       WHERE r.trade_date = (SELECT d FROM latest)
         AND r.amount > 0
       ORDER BY r.amount DESC
       LIMIT 15`

    let topStocks: TopStockRow[]
    try {
      topStocks = await query<TopStockRow>(topStocksSqlWithNames)
    } catch {
      topStocks = await query<TopStockRow>(topStocksSqlCodesOnly)
    }

    const boards = Object.entries(latest.board_shares || {})
      .map(([name, share]) => ({ name, share }))
      .sort((a, b) => b.share - a.share)

    const dates = series.map((s) => s.date)
    const indexRows = dates.length
      ? await query<IndexRow>(
          `SELECT trade_date, close
           FROM raw_ashare_index_daily
           WHERE ts_code = $1
             AND trade_date = ANY($2::date[])
           ORDER BY trade_date ASC`,
          [INDEX_CODE, dates],
        )
      : []

    let indexByDate = new Map(
      indexRows.map((r) => [fmtIso(r.trade_date), n(r.close)]),
    )

    if (!indexRows.length && dates.length) {
      const synthRows = await query<IndexRow>(
        `WITH mkt AS (
           SELECT trade_date,
                  SUM(close * amount) / NULLIF(SUM(amount), 0) AS mkt_px
           FROM raw_ashare_daily
           WHERE close > 0 AND amount > 0
             AND trade_date = ANY($1::date[])
           GROUP BY trade_date
         ),
         chained AS (
           SELECT trade_date,
                  mkt_px,
                  mkt_px / NULLIF(LAG(mkt_px) OVER (ORDER BY trade_date), 0) AS px_ratio
           FROM mkt
         )
         SELECT trade_date,
                ROUND(
                  (5000.0 * EXP(
                    SUM(LN(px_ratio)) OVER (ORDER BY trade_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
                  ))::numeric,
                  2
                ) AS close
         FROM chained
         WHERE px_ratio IS NOT NULL
         ORDER BY trade_date ASC`,
        [dates],
      )
      indexByDate = new Map(
        synthRows.map((r) => [fmtIso(r.trade_date), n(r.close)]),
      )
    }

    const indexSeries = series.map((s) => ({
      date: s.date,
      all_a_index: indexByDate.get(s.date) ?? null,
    }))

    return NextResponse.json({
      series,
      index_series: indexSeries,
      index_code: INDEX_CODE,
      latest: {
        trade_date: latest.date,
        crowding_pct: latest.crowding_pct,
        crowding_raw: latest.crowding_raw,
        market_turn: latest.market_turn,
        hhi: latest.hhi,
        top3_share: latest.top3_share,
        top10_share: latest.top10_share,
        top_board: latest.top_board,
        top_board_share: latest.top_board_share,
        total_amount: latest.total_amount,
        boards,
        top_stocks: topStocks.map((r) => ({
          ts_code: r.ts_code,
          name: r.name?.trim() || null,
          amount: n(r.amount),
          share: n(r.share),
        })),
      },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
