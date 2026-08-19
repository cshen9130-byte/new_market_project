import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const AKSHARE_CODE: Record<string, string> = {
  A:"A0.DCE",   AD:"AD0.SHF",  AG:"AG0.SHF",  AL:"AL0.SHF",  AO:"AO0.SHF",  AP:"AP0.CZC",
  AU:"AU0.SHF", B:"B0.DCE",    BB:"BB0.DCE",  BC:"BCM.INE",  BR:"BR0.SHF",  BU:"BU0.SHF",
  BZ:"BZ0.DCE", C:"C0.DCE",    CF:"CF0.CZC",  CJ:"CJ0.CZC",  CS:"CS0.DCE",  CU:"CU0.SHF",
  CY:"CY0.CZC", EB:"EB0.DCE",  EC:"ECM.INE",  EG:"EG0.DCE",  FB:"FB0.DCE",  FG:"FG0.CZC",
  FU:"FU0.SHF", HC:"HC0.SHF",  I:"I0.DCE",    IC:"IC0.CFE",  IF:"IF0.CFE",  IH:"IH0.CFE",
  IM:"IM0.CFE", J:"J0.DCE",    JD:"JD0.DCE",  JM:"JM0.DCE",  JR:"JR0.CZC",  L:"L0.DCE",
  LC:"LCM.GFE", LF:"LF0.DCE",  LG:"LG0.DCE",  LH:"LH0.DCE",  LR:"LR0.CZC",  LU:"LUM.INE",
  M:"M0.DCE",   MA:"MA0.CZC",  NI:"NI0.SHF",  NR:"NRM.INE",  OI:"OI0.CZC",  OP:"OP0.SHF",
  P:"P0.DCE",   PB:"PB0.SHF",  PD:"PDM.GFE",  PF:"PF0.CZC",  PG:"PG0.DCE",  PK:"PK0.CZC",
  PL:"PL0.CZC", PM:"PM0.CZC",  PP:"PP0.DCE",  PR:"PR0.CZC",  PS:"PSM.GFE",  PT:"PTM.GFE",
  PX:"PX0.CZC", RB:"RB0.SHF",  RI:"RI0.CZC",  RM:"RM0.CZC",  RR:"RR0.DCE",  RS:"RS0.CZC",
  RU:"RU0.SHF", SA:"SA0.CZC",  SC:"SCM.INE",  SF:"SF0.CZC",  SH:"SH0.CZC",  SI:"SIM.GFE",
  SM:"SM0.CZC", SN:"SN0.SHF",  SP:"SP0.SHF",  SR:"SR0.CZC",  SS:"SS0.SHF",  TA:"TA0.CZC",
  T:"T0.CFE",   TF:"TF0.CFE",  TL:"TL0.CFE",  TS:"TS0.CFE",  UR:"UR0.CZC",  V:"V0.DCE",
  VF:"VF0.DCE", WH:"WH0.CZC",  WR:"WR0.SHF",  Y:"Y0.DCE",   ZC:"ZC0.CZC",  ZN:"ZN0.SHF",
}

type CandleRow = {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

type AkRow = CandleRow & { code: string }

function parseProductCodes(raw: string): string[] {
  const seen = new Set<string>()
  for (const part of raw.split(",")) {
    const code = part.toUpperCase().trim()
    if (/^[A-Z]{1,4}$/.test(code)) seen.add(code)
    if (seen.size >= 24) break
  }
  return [...seen]
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0
}

function buildEqualWeightIndex(rows: AkRow[]): CandleRow[] {
  const byDate = new Map<string, AkRow[]>()
  for (const r of rows) {
    const list = byDate.get(r.date)
    if (list) list.push(r)
    else byDate.set(r.date, [r])
  }
  const dates = [...byDate.keys()].sort()
  const prevClose = new Map<string, number>()
  const out: CandleRow[] = []
  let index = 1000
  for (const date of dates) {
    const day = byDate.get(date) ?? []
    const oRets: number[] = []
    const hRets: number[] = []
    const lRets: number[] = []
    const cRets: number[] = []
    let vol = 0
    for (const r of day) {
      vol += r.volume
      const pc = prevClose.get(r.code)
      if (pc && pc > 0) {
        oRets.push(r.open / pc - 1)
        hRets.push(r.high / pc - 1)
        lRets.push(r.low / pc - 1)
        cRets.push(r.close / pc - 1)
      }
      prevClose.set(r.code, r.close)
    }
    if (!cRets.length) continue
    const open = index * (1 + mean(oRets))
    const high = index * (1 + mean(hRets))
    const low = index * (1 + mean(lRets))
    const close = index * (1 + mean(cRets))
    index = close
    out.push({
      date,
      open,
      high: Math.max(high, open, close),
      low: Math.min(low, open, close),
      close,
      volume: vol,
    })
  }
  return out
}

async function loadSingleProduct(product: string, from: string, to: string): Promise<CandleRow[]> {
  let rows: CandleRow[] = await query<CandleRow>(
    `WITH ranked AS (
       SELECT trade_date::text          AS date,
              CAST(open   AS float8)    AS open,
              CAST(high   AS float8)    AS high,
              CAST(low    AS float8)    AS low,
              CAST(close  AS float8)    AS close,
              CAST(COALESCE(volume, 0) AS float8) AS volume,
              ROW_NUMBER() OVER (
                PARTITION BY trade_date
                ORDER BY COALESCE(hqoi, 0) DESC, COALESCE(volume, 0) DESC
              ) AS rn
       FROM raw_futures_contracts_daily
       WHERE UPPER(contract) ~ ('^' || $1 || '[0-9]')
         AND trade_date BETWEEN $2 AND $3
     )
     SELECT date, open, high, low, close, volume
     FROM ranked WHERE rn = 1 AND close > 0
     ORDER BY date`,
    [product, from, to],
  ).catch(() => [] as CandleRow[])

  const akCode = AKSHARE_CODE[product]
  if (akCode) {
    const akRows = await query<CandleRow>(
      `SELECT trade_date::text                    AS date,
              CAST(open   AS float8)              AS open,
              CAST(high   AS float8)              AS high,
              CAST(low    AS float8)              AS low,
              CAST(close  AS float8)              AS close,
              CAST(COALESCE(volume, 0) AS float8) AS volume
       FROM raw_akshare_futures_daily
       WHERE code = $1 AND trade_date BETWEEN $2 AND $3
         AND CAST(close AS float8) > 0
       ORDER BY trade_date`,
      [akCode, from, to],
    ).catch(() => [] as CandleRow[])

    if (rows.length === 0) {
      rows = akRows
    } else if (akRows.length > 0) {
      const primaryDates = new Set(rows.map(r => r.date))
      const supplement = akRows.filter(r => !primaryDates.has(r.date))
      if (supplement.length > 0) {
        rows = [...rows, ...supplement].sort((a, b) => a.date.localeCompare(b.date))
      }
    }
  }
  return rows
}

async function loadBasketIndex(products: string[], from: string, to: string): Promise<CandleRow[]> {
  const akCodes = products.map((p) => AKSHARE_CODE[p]).filter(Boolean)
  if (!akCodes.length) return []
  const rows = await query<AkRow>(
    `SELECT trade_date::text                    AS date,
            code,
            CAST(open   AS float8)              AS open,
            CAST(high   AS float8)              AS high,
            CAST(low    AS float8)              AS low,
            CAST(close  AS float8)              AS close,
            CAST(COALESCE(volume, 0) AS float8) AS volume
     FROM raw_akshare_futures_daily
     WHERE code = ANY($1) AND trade_date BETWEEN $2 AND $3
       AND CAST(close AS float8) > 0
     ORDER BY trade_date, code`,
    [akCodes, from, to],
  ).catch(() => [] as AkRow[])
  return buildEqualWeightIndex(rows)
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const from = searchParams.get("from") || "2025-01-01"
    const to = searchParams.get("to") || new Date().toISOString().slice(0, 10)
    const basket = parseProductCodes(searchParams.get("products") || "")

    if (basket.length > 1) {
      const rows = await loadBasketIndex(basket, from, to)
      return NextResponse.json({ ok: true, data: rows, product: basket.join(","), products: basket })
    }

    const rawProduct = (searchParams.get("product") || basket[0] || "AU").toUpperCase().trim()
    const product = /^[A-Z]{1,4}$/.test(rawProduct) ? rawProduct : "AU"
    const rows = await loadSingleProduct(product, from, to)
    return NextResponse.json({ ok: true, data: rows, product })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
