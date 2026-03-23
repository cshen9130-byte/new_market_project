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

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const rawProduct = (searchParams.get("product") || "AU").toUpperCase().trim()
    const product    = /^[A-Z]{1,4}$/.test(rawProduct) ? rawProduct : "AU"
    const from       = searchParams.get("from") || "2025-01-01"
    const to         = searchParams.get("to")   || new Date().toISOString().slice(0, 10)

    // Primary: dominant contract per day (highest OI) from raw_futures_contracts_daily
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

    // Supplement / fallback: akshare continuous contract
    // Always attempt AkShare so recent dates missing from raw_futures_contracts_daily
    // (e.g. close=0 rows filtered by close>0) are filled in from AkShare.
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
        // Primary returned nothing — use AkShare entirely
        rows = akRows
      } else if (akRows.length > 0) {
        // Primary has historical data but may be missing recent dates — supplement
        const primaryDates = new Set(rows.map(r => r.date))
        const supplement = akRows.filter(r => !primaryDates.has(r.date))
        if (supplement.length > 0) {
          rows = [...rows, ...supplement].sort((a, b) => a.date.localeCompare(b.date))
        }
      }
    }

    return NextResponse.json({ ok: true, data: rows, product })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
