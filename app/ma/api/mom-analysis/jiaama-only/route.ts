import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { withMomCache } from "@/lib/server/mom-cache"
import { getPrefix } from "@/lib/server/prod-utils"
import { parseQuantIdList } from "@/lib/ma/quant-accounts"
import {
  AKSHARE_CODE,
  CODE_TO_PROD,
  START_EQUITY,
  buildJiaamaSignals,
  buildRollBook,
  holdingsOn,
  runJiaamaAccount,
  withCumPnl,
  zeroRolloverSpikes,
  type ProductSignal,
} from "@/lib/server/jiaama-only"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

const ACCOUNT_EXCL = `
  UPPER(TRIM("账户"::text)) NOT LIKE '%GUOXIN%'
  AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOSEN%'
  AND TRIM("账户"::text) NOT LIKE '%国信%'
  AND TRIM("账户"::text) <> '665300200077'
`

const NON_DIGIT = "[^" + "0-9]"

function sleeveSql(quantIds: number[]): string {
  if (!quantIds.length) return "'subjective'"
  const list = quantIds.map((id) => `'${id}'`).join(",")
  const digits = `regexp_replace(TRIM("账户"), '${NON_DIGIT}', '', 'g')`
  const norm = `COALESCE(NULLIF(TRIM(LEADING '0' FROM ${digits}), ''), '0')`
  return (
    "CASE WHEN " + digits + " = '' THEN 'subjective' " +
    "WHEN " + norm + " IN (" + list + ") THEN 'quant' ELSE 'subjective' END"
  )
}

function toNum(v: unknown): number {
  if (v == null) return 0
  const n = parseFloat(String(v).replace(/[,%\s]/g, ""))
  return Number.isFinite(n) ? n : 0
}

const numExpr = (col: string) =>
  `COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("${col}"::text, ''), ',', ''), ' ', ''), '')::numeric, 0)`

async function _GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const dateParam = searchParams.get("date")
    const quantIds = parseQuantIdList(searchParams.get("quantIds"))
    const SLEEVE_EXPR = sleeveSql(quantIds)
    const wantDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : "9999-12-31"

    const boundRows = await query<{ latest: string | null; snapped: string | null }>(
      `SELECT
         (SELECT MAX("交易日期"::date)::text FROM mom_position_details
          WHERE "交易日期" IS NOT NULL AND ${ACCOUNT_EXCL}) AS latest,
         (SELECT MAX("交易日期"::date)::text FROM mom_position_details
          WHERE "交易日期" IS NOT NULL AND ${ACCOUNT_EXCL}
            AND "交易日期"::date <= $1::date) AS snapped`,
      [wantDate],
    )
    const latestDate = boundRows[0]?.latest ?? null
    const date = boundRows[0]?.snapped || latestDate
    if (!date) {
      return NextResponse.json({
        ok: true,
        date: null,
        latestDate: null,
        daily: [],
        holdings: [],
        signalTrades: [],
        pending: true,
        signals: [],
        stats: null,
        startEquity: START_EQUITY,
      })
    }

    const optionRe = "[0-9]" + "[CP]" + "[0-9]"
    const optionExcl =
      " AND UPPER(TRIM(\"合约\")) !~ '" + optionRe + "'" +
      " AND TRIM(\"合约\") NOT LIKE '%-%-%'"

    const [posRows, pxRows, contractRows, rollRows] = await Promise.all([
      query<{
        date: string; sleeve: string; contract: string
        long_mv: string; short_mv: string; long_lots: string; short_lots: string
      }>(
        `SELECT
           "交易日期"::date::text AS date,
           ${SLEEVE_EXPR} AS sleeve,
           UPPER(TRIM("合约")) AS contract,
           SUM(CASE WHEN ${numExpr("买持仓")} > 0 THEN ${numExpr("持仓市値")} ELSE 0 END)::text AS long_mv,
           SUM(CASE WHEN ${numExpr("卖持仓")} > 0 THEN ${numExpr("持仓市値")} ELSE 0 END)::text AS short_mv,
           SUM(${numExpr("买持仓")})::text AS long_lots,
           SUM(${numExpr("卖持仓")})::text AS short_lots
         FROM mom_position_details
         WHERE "交易日期" IS NOT NULL
           AND "合约" IS NOT NULL
           AND ${ACCOUNT_EXCL}
           ${optionExcl}
         GROUP BY 1, 2, 3
         ORDER BY 1`,
      ),
      query<{ date: string; code: string; pct: string; close: string; settle: string }>(
        `SELECT trade_date::text AS date, code,
                pct_change::text AS pct,
                close::text AS close,
                clear::text AS settle
         FROM raw_akshare_futures_daily
         WHERE pct_change IS NOT NULL
         ORDER BY trade_date, code`,
      ).catch(() => [] as { date: string; code: string; pct: string; close: string; settle: string }[]),
      query<{ date: string; product: string; contract: string; px: string; oi: string; vol: string }>(
        `SELECT
           trade_date::text AS date,
           UPPER(REGEXP_REPLACE(SPLIT_PART(TRIM(contract), '.', 1), '[0-9].*$', '')) AS product,
           SPLIT_PART(TRIM(contract), '.', 1) AS contract,
           COALESCE(NULLIF(close::float8, 0), NULLIF(clear::float8, 0), 0)::text AS px,
           COALESCE(hqoi, 0)::text AS oi,
           COALESCE(volume, 0)::text AS vol
         FROM raw_futures_contracts_daily
         WHERE COALESCE(clear, close) > 0
           AND trade_date >= '2025-01-01'
           AND UPPER(REGEXP_REPLACE(SPLIT_PART(TRIM(contract), '.', 1), '[0-9].*$', '')) ~ '^[A-Z]{1,3}$'`,
      ).catch(() => [] as { date: string; product: string; contract: string; px: string; oi: string; vol: string }[]),
      query<{ date: string; product: string; from_contract: string; to_contract: string }>(
        `SELECT rollover_date::text AS date,
                UPPER(TRIM(product)) AS product,
                from_contract, to_contract
         FROM raw_futures_rollover_dates
         WHERE rollover_date >= '2025-01-01'`,
      ).catch(() => [] as { date: string; product: string; from_contract: string; to_contract: string }[]),
    ])

    const grouped = new Map<string, {
      date: string; sleeve: string; product: string
      longMv: number; shortMv: number; longLots: number; shortLots: number
    }>()
    for (const r of posRows) {
      const product = getPrefix(r.contract)
      if (!product) continue
      const key = `${r.date.slice(0, 10)}|${r.sleeve}|${product}`
      const cur = grouped.get(key) ?? {
        date: r.date.slice(0, 10),
        sleeve: r.sleeve,
        product,
        longMv: 0,
        shortMv: 0,
        longLots: 0,
        shortLots: 0,
      }
      cur.longMv += toNum(r.long_mv)
      cur.shortMv += toNum(r.short_mv)
      cur.longLots += toNum(r.long_lots)
      cur.shortLots += toNum(r.short_lots)
      grouped.set(key, cur)
    }

    const close = new Map<string, Map<string, number>>()
    const rawRet = new Map<string, Map<string, number>>()
    const mktDateSet = new Set<string>()
    for (const r of pxRows) {
      const prod = CODE_TO_PROD[r.code]
      if (!prod) continue
      const dt = r.date.slice(0, 10)
      mktDateSet.add(dt)
      const px = toNum(r.close) || toNum(r.settle)
      if (px > 0) {
        if (!close.has(dt)) close.set(dt, new Map())
        close.get(dt)!.set(prod, px)
      }
      if (!rawRet.has(dt)) rawRet.set(dt, new Map())
      rawRet.get(dt)!.set(prod, toNum(r.pct) / 100)
    }
    const mktDates = [...mktDateSet].sort()
    const prods = [...new Set(Object.keys(AKSHARE_CODE))]
    const cleanByProd = new Map<string, number[]>()
    const cleanRets = new Map<string, Map<string, number>>()
    for (const p of prods) {
      const series = zeroRolloverSpikes(mktDates.map((d) => rawRet.get(d)?.get(p) ?? 0))
      cleanByProd.set(p, series)
      series.forEach((v, i) => {
        const dt = mktDates[i]
        if (!cleanRets.has(dt)) cleanRets.set(dt, new Map())
        cleanRets.get(dt)!.set(p, v)
      })
    }

    const roll = buildRollBook(
      contractRows.map((r) => ({
        date: r.date.slice(0, 10),
        product: getPrefix(r.product) || r.product,
        contract: r.contract,
        px: toNum(r.px),
        oi: toNum(r.oi),
        vol: toNum(r.vol),
      })),
      rollRows.map((r) => ({
        date: r.date.slice(0, 10),
        product: r.product,
        fromContract: r.from_contract,
        toContract: r.to_contract,
      })),
    )

    const groupedRows = [...grouped.values()]
    const signals = buildJiaamaSignals(groupedRows, mktDates, cleanByProd)
    const acct = runJiaamaAccount(signals, mktDates, close, cleanRets, cleanByProd, roll)

    const snapSignals = signals.filter((s) => s.date === date)
    const addSignals = snapSignals.filter((s) => s.action === "加码")
    const executed = acct.trades.filter((t) => t.signalDate === date)
    const pendingForDate = acct.pendingTrades.filter((t) => t.signalDate === date)
    const signalTrades = pendingForDate.length ? pendingForDate : executed
    const pending = pendingForDate.length > 0
    const liveHolds = holdingsOn(acct.holds, date)
    const rawHolds = liveHolds.length
      ? liveHolds
      : pending && acct.lastBook.length
        ? acct.lastBook.map((p) => ({
            signalDate: date,
            holdDate: acct.daily.at(-1)?.returnDate ?? date,
            product: p.product,
            name: p.name,
            sector: p.sector,
            action: p.action,
            kind: p.kind,
            dir: (p.lots > 0 ? "多" : "空") as "多" | "空",
            lots: p.lots,
            price: p.price,
            contract: p.contract,
            notional: p.notional,
            margin: p.margin,
            qPct: p.qPct,
            sPct: p.sPct,
            pnl: p.pnl ?? 0,
            ret: p.ret ?? 0,
            openedAt: p.openedAt,
            openedSession: p.openedSession,
            entryPrice: p.entryPrice,
            entrySignalDate: p.entrySignalDate,
          }))
        : []
    const holdings = withCumPnl(rawHolds, acct.holds)
    const sessionTrades = acct.trades.filter((t) => t.tradeDate === date)
    const tradeHistory = acct.trades.filter((t) => t.signalDate <= date || t.tradeDate <= date)

    const daily = date < (latestDate ?? date)
      ? acct.daily.filter((d) => d.returnDate <= date || d.signalDate <= date)
      : acct.daily

    return NextResponse.json({
      ok: true,
      date,
      latestDate,
      startEquity: START_EQUITY,
      pending,
      stats: acct.stats,
      daily,
      holdings,
      signalTrades,
      sessionTrades,
      tradeHistory,
      signals: addSignals.map((s: ProductSignal) => ({
        product: s.product,
        name: s.name,
        sector: s.sector,
        kind: s.kind,
        qPct: s.qPct,
        sPct: s.sPct,
        dir: s.kind === "consensus_short" ? "空" : "多",
      })),
      rule: {
        title: "只做加码同向",
        startEquity: START_EQUITY,
        maxNames: 8,
        leverage: 2.2,
        commBps: 1.2,
        slipBps: 1.5,
        note: "信号日收盘后生成仓位，下一交易日生效。只交易加码；控拥挤/观望/暂缓/减码/补风格一律空仓。换月按主力合约旧约平、新约开。",
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[jiaama-only]", err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = withMomCache("jiaama-only-v6", _GET)
