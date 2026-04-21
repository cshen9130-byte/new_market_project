/**
 * settlement-account-etl.ts
 * ─────────────────────────
 * Reads 资金状况 (Account Summary) data from 国信 settlement xlsx files
 * and upserts into the guosen_account_summary PostgreSQL table.
 *
 * Cells extracted (first sheet):
 *   C5  client_id        G5  client_name       N5  trade_date (date range)
 *   D10 balance_bf       D11 deposit_withdrawal D12 realized_pl
 *   D13 mtm_pl           D14 exercise_pl        D15 commission
 *   D16 exercise_fee     D17 delivery_fee       D18 new_fx_pledge
 *   D19 fx_redemption    D20 chg_pledge_amt     D21 premium_received
 *   D22 premium_paid     D23 delivery_pl
 *   K10 initial_margin   K11 balance_cf         K12 pledge_amount
 *   K13 client_equity    K14 fx_pledge_occ      K15 margin_occupied
 *   K16 delivery_margin  K17 mv_long            K18 mv_short
 *   K19 mv_equity        K20 fund_avail         K21 risk_degree
 *   K22 margin_call      K23 chg_fx_pledge
 */

import fs from "fs"
import path from "path"
import * as XLSX from "xlsx"
import { rawQuery, query } from "@/lib/db"
import { listDownloadedFiles } from "@/lib/server/settlement-email"

// ─── Types ───────────────────────────────────────────────────────────────────

export type AccountSummaryRow = {
  client_id: string
  client_name: string
  trade_date: string        // YYYY-MM-DD
  date_range_raw: string    // raw N5 display text
  source_file: string
  // D column
  balance_bf: number | null
  deposit_withdrawal: number | null
  realized_pl: number | null
  mtm_pl: number | null
  exercise_pl: number | null
  commission: number | null
  exercise_fee: number | null
  delivery_fee: number | null
  new_fx_pledge: number | null
  fx_redemption: number | null
  chg_pledge_amt: number | null
  premium_received: number | null
  premium_paid: number | null
  delivery_pl: number | null
  // K column
  initial_margin: number | null
  balance_cf: number | null
  pledge_amount: number | null
  client_equity: number | null
  fx_pledge_occ: number | null
  margin_occupied: number | null
  delivery_margin: number | null
  mv_long: number | null
  mv_short: number | null
  mv_equity: number | null
  fund_avail: number | null
  risk_degree: number | null
  margin_call: number | null
  chg_fx_pledge: number | null
}

export type ETLResult = {
  processed: number
  inserted: number
  updated: number
  skipped: number
  errors: string[]
}

// ─── Table DDL ───────────────────────────────────────────────────────────────

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS guosen_account_summary (
    id                  SERIAL PRIMARY KEY,
    client_id           TEXT NOT NULL,
    client_name         TEXT,
    trade_date          DATE NOT NULL,
    date_range_raw      TEXT,
    source_file         TEXT NOT NULL,
    balance_bf          NUMERIC,
    deposit_withdrawal  NUMERIC,
    realized_pl         NUMERIC,
    mtm_pl              NUMERIC,
    exercise_pl         NUMERIC,
    commission          NUMERIC,
    exercise_fee        NUMERIC,
    delivery_fee        NUMERIC,
    new_fx_pledge       NUMERIC,
    fx_redemption       NUMERIC,
    chg_pledge_amt      NUMERIC,
    premium_received    NUMERIC,
    premium_paid        NUMERIC,
    delivery_pl         NUMERIC,
    initial_margin      NUMERIC,
    balance_cf          NUMERIC,
    pledge_amount       NUMERIC,
    client_equity       NUMERIC,
    fx_pledge_occ       NUMERIC,
    margin_occupied     NUMERIC,
    delivery_margin     NUMERIC,
    mv_long             NUMERIC,
    mv_short            NUMERIC,
    mv_equity           NUMERIC,
    fund_avail          NUMERIC,
    risk_degree         NUMERIC,
    margin_call         NUMERIC,
    chg_fx_pledge       NUMERIC,
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (client_id, trade_date)
  )
`

async function ensureTable(): Promise<void> {
  await rawQuery(CREATE_TABLE_SQL)
}

// ─── Cell helpers ─────────────────────────────────────────────────────────────

function numCell(ws: XLSX.WorkSheet, addr: string): number | null {
  const cell = ws[addr]
  if (!cell) return null
  const v = cell.v
  if (typeof v === "number") return v
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/,/g, ""))
    return isNaN(n) ? null : n
  }
  return null
}

function strCell(ws: XLSX.WorkSheet, addr: string): string {
  const cell = ws[addr]
  if (!cell) return ""
  return String(cell.v ?? "").trim()
}

function parseN5(ws: XLSX.WorkSheet): { tradeDate: string; rawDisplay: string } {
  const cell = ws["N5"]
  if (!cell) return { tradeDate: "", rawDisplay: "" }

  const rawDisplay = String(cell.w ?? cell.v ?? "").trim()
  let tradeDate = ""

  if (cell.v instanceof Date) {
    const y = cell.v.getFullYear()
    const m = String(cell.v.getMonth() + 1).padStart(2, "0")
    const d = String(cell.v.getDate()).padStart(2, "0")
    tradeDate = `${y}-${m}-${d}`
  } else if (typeof cell.v === "number") {
    const d = XLSX.SSF.parse_date_code(cell.v)
    if (d) tradeDate = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`
  } else {
    // String like "2026/04/20至2026/04/20" — extract 8 consecutive digits
    const digits = rawDisplay.replace(/\D/g, "")
    if (digits.length >= 8) {
      const s = digits.slice(0, 8)
      tradeDate = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
    }
  }

  return { tradeDate, rawDisplay }
}

// ─── Parser ──────────────────────────────────────────────────────────────────

export function parseAccountSummary(buf: Buffer, sourceFile: string): AccountSummaryRow | null {
  try {
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true })
    const ws = wb.Sheets[wb.SheetNames[0]]
    if (!ws) return null

    // Gate: A3 must contain 交易结算单 and 盯市
    const a3 = strCell(ws, "A3")
    if (!a3.includes("交易结算单") || !a3.includes("盯市")) return null

    const clientId = strCell(ws, "C5")
    if (!clientId) return null

    const { tradeDate, rawDisplay } = parseN5(ws)
    if (!tradeDate) return null

    return {
      client_id: clientId,
      client_name: strCell(ws, "G5"),
      trade_date: tradeDate,
      date_range_raw: rawDisplay,
      source_file: sourceFile,
      // D column
      balance_bf:          numCell(ws, "D10"),
      deposit_withdrawal:  numCell(ws, "D11"),
      realized_pl:         numCell(ws, "D12"),
      mtm_pl:              numCell(ws, "D13"),
      exercise_pl:         numCell(ws, "D14"),
      commission:          numCell(ws, "D15"),
      exercise_fee:        numCell(ws, "D16"),
      delivery_fee:        numCell(ws, "D17"),
      new_fx_pledge:       numCell(ws, "D18"),
      fx_redemption:       numCell(ws, "D19"),
      chg_pledge_amt:      numCell(ws, "D20"),
      premium_received:    numCell(ws, "D21"),
      premium_paid:        numCell(ws, "D22"),
      delivery_pl:         numCell(ws, "D23"),
      // K column
      initial_margin:      numCell(ws, "K10"),
      balance_cf:          numCell(ws, "K11"),
      pledge_amount:       numCell(ws, "K12"),
      client_equity:       numCell(ws, "K13"),
      fx_pledge_occ:       numCell(ws, "K14"),
      margin_occupied:     numCell(ws, "K15"),
      delivery_margin:     numCell(ws, "K16"),
      mv_long:             numCell(ws, "K17"),
      mv_short:            numCell(ws, "K18"),
      mv_equity:           numCell(ws, "K19"),
      fund_avail:          numCell(ws, "K20"),
      risk_degree:         numCell(ws, "K21"),
      margin_call:         numCell(ws, "K22"),
      chg_fx_pledge:       numCell(ws, "K23"),
    }
  } catch {
    return null
  }
}

// ─── Upsert ──────────────────────────────────────────────────────────────────

const UPSERT_SQL = `
  INSERT INTO guosen_account_summary (
    client_id, client_name, trade_date, date_range_raw, source_file,
    balance_bf, deposit_withdrawal, realized_pl, mtm_pl, exercise_pl,
    commission, exercise_fee, delivery_fee, new_fx_pledge, fx_redemption,
    chg_pledge_amt, premium_received, premium_paid, delivery_pl,
    initial_margin, balance_cf, pledge_amount, client_equity, fx_pledge_occ,
    margin_occupied, delivery_margin, mv_long, mv_short, mv_equity,
    fund_avail, risk_degree, margin_call, chg_fx_pledge, updated_at
  ) VALUES (
    $1,$2,$3,$4,$5,
    $6,$7,$8,$9,$10,
    $11,$12,$13,$14,$15,
    $16,$17,$18,$19,
    $20,$21,$22,$23,$24,
    $25,$26,$27,$28,$29,
    $30,$31,$32,$33, NOW()
  )
  ON CONFLICT (client_id, trade_date)
  DO UPDATE SET
    client_name        = EXCLUDED.client_name,
    date_range_raw     = EXCLUDED.date_range_raw,
    source_file        = EXCLUDED.source_file,
    balance_bf         = EXCLUDED.balance_bf,
    deposit_withdrawal = EXCLUDED.deposit_withdrawal,
    realized_pl        = EXCLUDED.realized_pl,
    mtm_pl             = EXCLUDED.mtm_pl,
    exercise_pl        = EXCLUDED.exercise_pl,
    commission         = EXCLUDED.commission,
    exercise_fee       = EXCLUDED.exercise_fee,
    delivery_fee       = EXCLUDED.delivery_fee,
    new_fx_pledge      = EXCLUDED.new_fx_pledge,
    fx_redemption      = EXCLUDED.fx_redemption,
    chg_pledge_amt     = EXCLUDED.chg_pledge_amt,
    premium_received   = EXCLUDED.premium_received,
    premium_paid       = EXCLUDED.premium_paid,
    delivery_pl        = EXCLUDED.delivery_pl,
    initial_margin     = EXCLUDED.initial_margin,
    balance_cf         = EXCLUDED.balance_cf,
    pledge_amount      = EXCLUDED.pledge_amount,
    client_equity      = EXCLUDED.client_equity,
    fx_pledge_occ      = EXCLUDED.fx_pledge_occ,
    margin_occupied    = EXCLUDED.margin_occupied,
    delivery_margin    = EXCLUDED.delivery_margin,
    mv_long            = EXCLUDED.mv_long,
    mv_short           = EXCLUDED.mv_short,
    mv_equity          = EXCLUDED.mv_equity,
    fund_avail         = EXCLUDED.fund_avail,
    risk_degree        = EXCLUDED.risk_degree,
    margin_call        = EXCLUDED.margin_call,
    chg_fx_pledge      = EXCLUDED.chg_fx_pledge,
    updated_at         = NOW()
  RETURNING (xmax = 0) AS is_insert
`

// ─── Main ETL entry point ─────────────────────────────────────────────────────

/**
 * Run the account summary ETL.
 * - "full":        process every xlsx in the settlement directory (re-upserts).
 * - "incremental": skip files whose source_file name is already in the DB.
 */
export async function runAccountSummaryETL(mode: "full" | "incremental"): Promise<ETLResult> {
  await ensureTable()

  const { files, folder } = listDownloadedFiles()
  const result: ETLResult = { processed: 0, inserted: 0, updated: 0, skipped: 0, errors: [] }

  if (files.length === 0) return result

  // For incremental: get set of source_file names already persisted
  let processedFiles = new Set<string>()
  if (mode === "incremental") {
    const rows = await query<{ source_file: string }>(
      "SELECT DISTINCT source_file FROM guosen_account_summary"
    )
    processedFiles = new Set(rows.map((r) => r.source_file))
  }

  // Process oldest file first (files are sorted newest-first by listDownloadedFiles)
  const sortedFiles = [...files].reverse()

  for (const file of sortedFiles) {
    if (mode === "incremental" && processedFiles.has(file.name)) {
      result.skipped++
      continue
    }

    try {
      const filePath = path.join(folder, file.name)
      const buf = fs.readFileSync(filePath)
      const row = parseAccountSummary(buf, file.name)

      if (!row) {
        result.errors.push(`${file.name}: 无法解析（A3不匹配或缺少客户号/日期）`)
        continue
      }

      const res = await rawQuery(UPSERT_SQL, [
        row.client_id, row.client_name, row.trade_date, row.date_range_raw, row.source_file,
        row.balance_bf, row.deposit_withdrawal, row.realized_pl, row.mtm_pl, row.exercise_pl,
        row.commission, row.exercise_fee, row.delivery_fee, row.new_fx_pledge, row.fx_redemption,
        row.chg_pledge_amt, row.premium_received, row.premium_paid, row.delivery_pl,
        row.initial_margin, row.balance_cf, row.pledge_amount, row.client_equity, row.fx_pledge_occ,
        row.margin_occupied, row.delivery_margin, row.mv_long, row.mv_short, row.mv_equity,
        row.fund_avail, row.risk_degree, row.margin_call, row.chg_fx_pledge,
      ])

      result.processed++
      if (res.rows[0]?.is_insert) {
        result.inserted++
      } else {
        result.updated++
      }
    } catch (e) {
      result.errors.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return result
}
