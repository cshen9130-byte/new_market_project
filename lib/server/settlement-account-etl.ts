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

export type SettlementETLResult = {
  accountSummary: ETLResult
  transactions: ETLResult
  positions: ETLResult
  positionSummary: ETLResult
  positionClosed: ETLResult
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

// ─── Transaction Records ──────────────────────────────────────────────────────
// Fixed typed columns matching the sheet layout:
// 成交日期, 投资单元, 交易所, 交易编码, 品种, 合约, 买/卖, 投/保,
// 成交价, 成交量, 成交额, 开平, 手续费, 平仓盈亏, 权利金收支, 成交编号

const TRANSACTION_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS guosen_transaction_records (
    id              SERIAL PRIMARY KEY,
    source_file     TEXT NOT NULL,
    client_id       TEXT,
    client_name     TEXT,
    settlement_date DATE,
    row_num         INTEGER NOT NULL,
    trade_date      DATE,
    invest_unit     TEXT,
    exchange        TEXT,
    trading_code    TEXT,
    product         TEXT,
    instrument      TEXT,
    bs              TEXT,
    sh              TEXT,
    price           NUMERIC,
    lots            INTEGER,
    turnover        NUMERIC,
    oc              TEXT,
    fee             NUMERIC,
    realized_pl     NUMERIC,
    premium_rp      NUMERIC,
    trans_no        TEXT,
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (source_file, row_num)
  )
`

async function ensureTransactionTable(): Promise<void> {
  await rawQuery(TRANSACTION_TABLE_SQL)
}

// Column index → DB field name + converter
// The sheet English header row maps positionally to these fields.
// We identify columns by matching the English header text.
const EN_HEADER_MAP: Record<string, string> = {
  "Date":          "trade_date",
  "InvestUnit":    "invest_unit",
  "Exchange":      "exchange",
  "TradingCode":   "trading_code",
  "Product":       "product",
  "Instrument":    "instrument",
  "B/S":           "bs",
  "S/H":           "sh",
  "Price":         "price",
  "Lots":          "lots",
  "Turnover":      "turnover",
  "O/C":           "oc",
  "Fee":           "fee",
  "RealizedP/L":   "realized_pl",
  "PremiumR/P":    "premium_rp",
  "Trans.No.":     "trans_no",
}

type ParsedTransactionRow = {
  rowNum:       number
  trade_date:   string | null
  invest_unit:  string | null
  exchange:     string | null
  trading_code: string | null
  product:      string | null
  instrument:   string | null
  bs:           string | null
  sh:           string | null
  price:        number | null
  lots:         number | null
  turnover:     number | null
  oc:           string | null
  fee:          number | null
  realized_pl:  number | null
  premium_rp:   number | null
  trans_no:     string | null
}

function cellStr(ws: XLSX.WorkSheet, r: number, c: number): string | null {
  const cell = ws[XLSX.utils.encode_cell({ r, c })]
  if (!cell) return null
  const v = cell.v
  if (v instanceof Date) {
    const y = v.getFullYear()
    const m = String(v.getMonth() + 1).padStart(2, "0")
    const d = String(v.getDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
  }
  const s = String(v ?? "").trim()
  return s === "" ? null : s
}

function cellNum(ws: XLSX.WorkSheet, r: number, c: number): number | null {
  const cell = ws[XLSX.utils.encode_cell({ r, c })]
  if (!cell) return null
  const v = cell.v
  if (typeof v === "number") return v
  const n = parseFloat(String(v ?? "").replace(/,/g, ""))
  return isFinite(n) ? n : null
}

function parseTransactionRecords(
  ws: XLSX.WorkSheet,
  range: XLSX.Range,
): ParsedTransactionRow[] | null {
  // ── Find the 成交记录 header row ──────────────────────────────────────
  let sectionRow = -1
  for (let r = range.s.r; r <= range.e.r; r++) {
    const aVal = String(ws[XLSX.utils.encode_cell({ r, c: range.s.c })]?.v ?? "").trim()
    if (aVal.includes("成交记录")) { sectionRow = r; break }
  }
  if (sectionRow === -1) return null

  const enRow = sectionRow + 2
  const dataStart = sectionRow + 3
  if (enRow > range.e.r) return []

  // ── Map column index → field name ────────────────────────────────────
  const colMap: { c: number; field: string }[] = []
  for (let c = range.s.c; c <= range.e.c; c++) {
    const en = String(ws[XLSX.utils.encode_cell({ r: enRow, c })]?.v ?? "").trim()
    const field = EN_HEADER_MAP[en]
    if (field) colMap.push({ c, field })
  }
  if (colMap.length === 0) return []

  // ── Read data rows ────────────────────────────────────────────────────
  const rows: ParsedTransactionRow[] = []
  for (let r = dataStart; r <= range.e.r; r++) {
    const aVal = String(ws[XLSX.utils.encode_cell({ r, c: range.s.c })]?.v ?? "").trim()
    if ((aVal.startsWith("总计") && aVal.includes("行")) || /^总计\d+行/.test(aVal)) break

    // Build flat row object
    const raw: Record<string, string | number | null> = {}
    for (const { c, field } of colMap) {
      const numericFields = new Set(["price","lots","turnover","fee","realized_pl","premium_rp"])
      raw[field] = numericFields.has(field) ? cellNum(ws, r, c) : cellStr(ws, r, c)
    }

    // Skip fully empty rows
    if (Object.values(raw).every(v => v === null)) continue

    rows.push({
      rowNum:       r - dataStart,
      trade_date:   (raw["trade_date"] as string | null) ?? null,
      invest_unit:  (raw["invest_unit"] as string | null) ?? null,
      exchange:     (raw["exchange"] as string | null) ?? null,
      trading_code: (raw["trading_code"] as string | null) ?? null,
      product:      (raw["product"] as string | null) ?? null,
      instrument:   (raw["instrument"] as string | null) ?? null,
      bs:           (raw["bs"] as string | null) ?? null,
      sh:           (raw["sh"] as string | null) ?? null,
      price:        (raw["price"] as number | null) ?? null,
      lots:         raw["lots"] != null ? Math.round(raw["lots"] as number) : null,
      turnover:     (raw["turnover"] as number | null) ?? null,
      oc:           (raw["oc"] as string | null) ?? null,
      fee:          (raw["fee"] as number | null) ?? null,
      realized_pl:  (raw["realized_pl"] as number | null) ?? null,
      premium_rp:   (raw["premium_rp"] as number | null) ?? null,
      trans_no:     (raw["trans_no"] as string | null) ?? null,
    })
  }
  return rows
}

const TRANSACTION_UPSERT_SQL = `
  INSERT INTO guosen_transaction_records
    (source_file, client_id, client_name, settlement_date, row_num,
     trade_date, invest_unit, exchange, trading_code, product, instrument,
     bs, sh, price, lots, turnover, oc, fee, realized_pl, premium_rp, trans_no,
     updated_at)
  VALUES
    ($1,$2,$3,$4,$5, $6,$7,$8,$9,$10,$11, $12,$13,$14,$15,$16,$17,$18,$19,$20,$21, NOW())
  ON CONFLICT (source_file, row_num)
  DO UPDATE SET
    client_id       = EXCLUDED.client_id,
    client_name     = EXCLUDED.client_name,
    settlement_date = EXCLUDED.settlement_date,
    trade_date      = EXCLUDED.trade_date,
    invest_unit     = EXCLUDED.invest_unit,
    exchange        = EXCLUDED.exchange,
    trading_code    = EXCLUDED.trading_code,
    product         = EXCLUDED.product,
    instrument      = EXCLUDED.instrument,
    bs              = EXCLUDED.bs,
    sh              = EXCLUDED.sh,
    price           = EXCLUDED.price,
    lots            = EXCLUDED.lots,
    turnover        = EXCLUDED.turnover,
    oc              = EXCLUDED.oc,
    fee             = EXCLUDED.fee,
    realized_pl     = EXCLUDED.realized_pl,
    premium_rp      = EXCLUDED.premium_rp,
    trans_no        = EXCLUDED.trans_no,
    updated_at      = NOW()
  RETURNING (xmax = 0) AS is_insert
`

export async function runTransactionRecordsETL(mode: "full" | "incremental"): Promise<ETLResult> {
  await ensureTransactionTable()

  const { files, folder } = listDownloadedFiles()
  const result: ETLResult = { processed: 0, inserted: 0, updated: 0, skipped: 0, errors: [] }

  if (files.length === 0) return result

  let processedFiles = new Set<string>()
  if (mode === "incremental") {
    const rows = await query<{ source_file: string }>(
      "SELECT DISTINCT source_file FROM guosen_transaction_records"
    )
    processedFiles = new Set(rows.map((r) => r.source_file))
  }

  for (const file of [...files].reverse()) {
    if (mode === "incremental" && processedFiles.has(file.name)) {
      result.skipped++
      continue
    }

    try {
      const filePath = path.join(folder, file.name)
      const buf = fs.readFileSync(filePath)

      const summary = parseAccountSummary(buf, file.name)
      const clientId = summary?.client_id ?? ""
      const clientName = summary?.client_name ?? ""
      const settlementDate = summary?.trade_date ?? ""

      const wb = XLSX.read(buf, { type: "buffer", cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      if (!ws || !ws["!ref"]) {
        result.errors.push(`${file.name}: 无法读取工作表`)
        continue
      }
      const range = XLSX.utils.decode_range(ws["!ref"]!)

      const rows = parseTransactionRecords(ws, range)
      if (rows === null) {
        result.errors.push(`${file.name}: 未找到成交记录区域`)
        continue
      }
      if (rows.length === 0) {
        result.processed++
        continue
      }

      for (const row of rows) {
        const res = await rawQuery(TRANSACTION_UPSERT_SQL, [
          file.name, clientId, clientName, settlementDate || null, row.rowNum,
          row.trade_date, row.invest_unit, row.exchange, row.trading_code, row.product, row.instrument,
          row.bs, row.sh, row.price, row.lots, row.turnover, row.oc, row.fee, row.realized_pl, row.premium_rp, row.trans_no,
        ])
        if (res.rows[0]?.is_insert) result.inserted++
        else result.updated++
      }

      result.processed++
    } catch (e) {
      result.errors.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return result
}

// ─── Position Detail (持仓明细) ───────────────────────────────────────────────
// Actual English headers from the sheet:
// InvestUnit, Exchange, TradingCode, Product, Instrument, OpenDate, S/H, B/S,
// Positon (sic), OpenPrice, Prev.Sttl, SttlToday, Accum.P/L, MTMP/L, Margin, MarketVal

const POSITION_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS guosen_position_detail (
    id              SERIAL PRIMARY KEY,
    source_file     TEXT NOT NULL,
    client_id       TEXT,
    client_name     TEXT,
    settlement_date DATE,
    date_range_raw  TEXT,
    row_num         INTEGER NOT NULL,
    invest_unit     TEXT,
    exchange        TEXT,
    trading_code    TEXT,
    product         TEXT,
    instrument      TEXT,
    open_date       DATE,
    sh              TEXT,
    bs              TEXT,
    position_lots   NUMERIC,
    open_price      NUMERIC,
    prev_settl      NUMERIC,
    settl_today     NUMERIC,
    accum_pl        NUMERIC,
    mtm_pl          NUMERIC,
    margin          NUMERIC,
    market_val      NUMERIC,
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (source_file, row_num)
  )
`

async function ensurePositionTable(): Promise<void> {
  // If old schema (pre-refactor) exists, drop and recreate with correct columns
  const oldCols = await rawQuery(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'guosen_position_detail' AND column_name = 'prev_lots'
    LIMIT 1
  `)
  if (oldCols.rows.length > 0) {
    await rawQuery("DROP TABLE IF EXISTS guosen_position_detail")
  }
  await rawQuery(POSITION_TABLE_SQL)
}

const EN_POSITION_HEADER_MAP: Record<string, string> = {
  "InvestUnit":  "invest_unit",
  "Exchange":    "exchange",
  "TradingCode": "trading_code",
  "Product":     "product",
  "Instrument":  "instrument",
  "OpenDate":    "open_date",
  "S/H":         "sh",
  "B/S":         "bs",
  "Positon":     "position_lots",   // typo in actual sheet header
  "Position":    "position_lots",   // also handle correct spelling
  "OpenPrice":   "open_price",
  "Prev.Sttl":   "prev_settl",
  "SttlToday":   "settl_today",
  "Accum.P/L":   "accum_pl",
  "MTMP/L":      "mtm_pl",
  "Margin":      "margin",
  "MarketVal":   "market_val",
}

const POSITION_NUM_FIELDS = new Set([
  "position_lots", "open_price", "prev_settl", "settl_today",
  "accum_pl", "mtm_pl", "margin", "market_val",
])

type ParsedPositionRow = {
  rowNum:        number
  invest_unit:   string | null
  exchange:      string | null
  trading_code:  string | null
  product:       string | null
  instrument:    string | null
  open_date:     string | null   // stored as "YYYY-MM-DD"
  sh:            string | null
  bs:            string | null
  position_lots: number | null
  open_price:    number | null
  prev_settl:    number | null
  settl_today:   number | null
  accum_pl:      number | null
  mtm_pl:        number | null
  margin:        number | null
  market_val:    number | null
}

/** Convert YYYYMMDD number/string → "YYYY-MM-DD", or pass through if already ISO */
function toIsoDate(raw: string | number | null): string | null {
  if (raw === null) return null
  const s = String(raw).replace(/\D/g, "")
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  return null
}

function parsePositionDetail(
  ws: XLSX.WorkSheet,
  range: XLSX.Range,
): ParsedPositionRow[] | null {
  // ── Find 持仓明细 header row ──────────────────────────────────────────
  let sectionRow = -1
  for (let r = range.s.r; r <= range.e.r; r++) {
    const aVal = String(ws[XLSX.utils.encode_cell({ r, c: range.s.c })]?.v ?? "").trim()
    if (aVal.includes("持仓明细")) { sectionRow = r; break }
  }
  if (sectionRow === -1) return null

  const enRow = sectionRow + 2
  const dataStart = sectionRow + 3
  if (enRow > range.e.r) return []

  // ── Map column index → field name ────────────────────────────────────
  const colMap: { c: number; field: string }[] = []
  for (let c = range.s.c; c <= range.e.c; c++) {
    const en = String(ws[XLSX.utils.encode_cell({ r: enRow, c })]?.v ?? "").trim()
    const field = EN_POSITION_HEADER_MAP[en]
    if (field) colMap.push({ c, field })
  }
  if (colMap.length === 0) return []

  // ── Read data rows ────────────────────────────────────────────────────
  const rows: ParsedPositionRow[] = []
  for (let r = dataStart; r <= range.e.r; r++) {
    const aVal = String(ws[XLSX.utils.encode_cell({ r, c: range.s.c })]?.v ?? "").trim()
    if ((aVal.startsWith("总计") && aVal.includes("行")) || /^总计\d+行/.test(aVal)) break

    const raw: Record<string, string | number | null> = {}
    for (const { c, field } of colMap) {
      raw[field] = POSITION_NUM_FIELDS.has(field) ? cellNum(ws, r, c) : cellStr(ws, r, c)
    }

    if (Object.values(raw).every(v => v === null)) continue

    rows.push({
      rowNum:        r - dataStart,
      invest_unit:   (raw["invest_unit"]   as string | null) ?? null,
      exchange:      (raw["exchange"]       as string | null) ?? null,
      trading_code:  (raw["trading_code"]   as string | null) ?? null,
      product:       (raw["product"]        as string | null) ?? null,
      instrument:    (raw["instrument"]     as string | null) ?? null,
      open_date:     toIsoDate(raw["open_date"] as string | number | null),
      sh:            (raw["sh"]             as string | null) ?? null,
      bs:            (raw["bs"]             as string | null) ?? null,
      position_lots: (raw["position_lots"]  as number | null) ?? null,
      open_price:    (raw["open_price"]     as number | null) ?? null,
      prev_settl:    (raw["prev_settl"]     as number | null) ?? null,
      settl_today:   (raw["settl_today"]    as number | null) ?? null,
      accum_pl:      (raw["accum_pl"]       as number | null) ?? null,
      mtm_pl:        (raw["mtm_pl"]         as number | null) ?? null,
      margin:        (raw["margin"]         as number | null) ?? null,
      market_val:    (raw["market_val"]     as number | null) ?? null,
    })
  }
  return rows
}

const POSITION_UPSERT_SQL = `
  INSERT INTO guosen_position_detail
    (source_file, client_id, client_name, settlement_date, date_range_raw, row_num,
     invest_unit, exchange, trading_code, product, instrument, open_date, sh, bs,
     position_lots, open_price, prev_settl, settl_today, accum_pl, mtm_pl, margin, market_val,
     updated_at)
  VALUES
    ($1,$2,$3,$4,$5,$6, $7,$8,$9,$10,$11,$12,$13,$14, $15,$16,$17,$18,$19,$20,$21,$22, NOW())
  ON CONFLICT (source_file, row_num)
  DO UPDATE SET
    client_id       = EXCLUDED.client_id,
    client_name     = EXCLUDED.client_name,
    settlement_date = EXCLUDED.settlement_date,
    date_range_raw  = EXCLUDED.date_range_raw,
    invest_unit     = EXCLUDED.invest_unit,
    exchange        = EXCLUDED.exchange,
    trading_code    = EXCLUDED.trading_code,
    product         = EXCLUDED.product,
    instrument      = EXCLUDED.instrument,
    open_date       = EXCLUDED.open_date,
    sh              = EXCLUDED.sh,
    bs              = EXCLUDED.bs,
    position_lots   = EXCLUDED.position_lots,
    open_price      = EXCLUDED.open_price,
    prev_settl      = EXCLUDED.prev_settl,
    settl_today     = EXCLUDED.settl_today,
    accum_pl        = EXCLUDED.accum_pl,
    mtm_pl          = EXCLUDED.mtm_pl,
    margin          = EXCLUDED.margin,
    market_val      = EXCLUDED.market_val,
    updated_at      = NOW()
  RETURNING (xmax = 0) AS is_insert
`

export async function runPositionDetailETL(mode: "full" | "incremental"): Promise<ETLResult> {
  await ensurePositionTable()

  const { files, folder } = listDownloadedFiles()
  const result: ETLResult = { processed: 0, inserted: 0, updated: 0, skipped: 0, errors: [] }

  if (files.length === 0) return result

  let processedFiles = new Set<string>()
  if (mode === "incremental") {
    const rows = await query<{ source_file: string }>(
      "SELECT DISTINCT source_file FROM guosen_position_detail"
    )
    processedFiles = new Set(rows.map((r) => r.source_file))
  }

  for (const file of [...files].reverse()) {
    if (mode === "incremental" && processedFiles.has(file.name)) {
      result.skipped++
      continue
    }

    try {
      const filePath = path.join(folder, file.name)
      const buf = fs.readFileSync(filePath)

      const summary = parseAccountSummary(buf, file.name)
      const clientId = summary?.client_id ?? ""
      const clientName = summary?.client_name ?? ""
      const settlementDate = summary?.trade_date ?? ""
      const dateRangeRaw = summary?.date_range_raw ?? ""

      const wb = XLSX.read(buf, { type: "buffer", cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      if (!ws || !ws["!ref"]) {
        result.errors.push(`${file.name}: 无法读取工作表`)
        continue
      }
      const range = XLSX.utils.decode_range(ws["!ref"]!)

      const rows = parsePositionDetail(ws, range)
      if (rows === null) {
        result.errors.push(`${file.name}: 未找到持仓明细区域`)
        continue
      }
      if (rows.length === 0) {
        result.processed++
        continue
      }

      for (const row of rows) {
        const res = await rawQuery(POSITION_UPSERT_SQL, [
          file.name, clientId, clientName, settlementDate || null, dateRangeRaw, row.rowNum,
          row.invest_unit, row.exchange, row.trading_code, row.product, row.instrument,
          row.open_date, row.sh, row.bs,
          row.position_lots, row.open_price, row.prev_settl, row.settl_today,
          row.accum_pl, row.mtm_pl, row.margin, row.market_val,
        ])
        if (res.rows[0]?.is_insert) result.inserted++
        else result.updated++
      }

      result.processed++
    } catch (e) {
      result.errors.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return result
}

// ─── Position Summary (持仓汇总) ─────────────────────────────────────────────
// English headers from the sheet:
// InvestUnit, Exchange, TradingCode, Product, Instrument,
// LongPos., AvgBuyPrice, SPos., AvgSellPrice, Prev.Sttl, SttlToday,
// MTMP/L, MarginOccupied, S/H, MarketValue(Long), MarketValue(Short)

const POSITION_SUMMARY_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS guosen_position_summary (
    id               SERIAL PRIMARY KEY,
    source_file      TEXT NOT NULL,
    client_id        TEXT,
    client_name      TEXT,
    settlement_date  DATE,
    date_range_raw   TEXT,
    row_num          INTEGER NOT NULL,
    invest_unit      TEXT,
    exchange         TEXT,
    trading_code     TEXT,
    product          TEXT,
    instrument       TEXT,
    long_pos         NUMERIC,
    avg_buy_price    NUMERIC,
    short_pos        NUMERIC,
    avg_sell_price   NUMERIC,
    prev_settl       NUMERIC,
    settl_today      NUMERIC,
    mtm_pl           NUMERIC,
    margin_occupied  NUMERIC,
    sh               TEXT,
    market_val_long  NUMERIC,
    market_val_short NUMERIC,
    updated_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (source_file, row_num)
  )
`

async function ensurePositionSummaryTable(): Promise<void> {
  await rawQuery(POSITION_SUMMARY_TABLE_SQL)
}

const EN_POSITION_SUMMARY_HEADER_MAP: Record<string, string> = {
  "InvestUnit":          "invest_unit",
  "Exchange":            "exchange",
  "TradingCode":         "trading_code",
  "Product":             "product",
  "Instrument":          "instrument",
  "LongPos.":            "long_pos",
  "AvgBuyPrice":         "avg_buy_price",
  "SPos.":               "short_pos",
  "AvgSellPrice":        "avg_sell_price",
  "Prev.Sttl":           "prev_settl",
  "SttlToday":           "settl_today",
  "MTMP/L":              "mtm_pl",
  "MarginOccupied":      "margin_occupied",
  "S/H":                 "sh",
  "MarketValue(Long)":   "market_val_long",
  "MarketValue(Short)":  "market_val_short",
}

const POSITION_SUMMARY_NUM_FIELDS = new Set([
  "long_pos", "avg_buy_price", "short_pos", "avg_sell_price",
  "prev_settl", "settl_today", "mtm_pl", "margin_occupied",
  "market_val_long", "market_val_short",
])

type ParsedPositionSummaryRow = {
  rowNum:           number
  invest_unit:      string | null
  exchange:         string | null
  trading_code:     string | null
  product:          string | null
  instrument:       string | null
  long_pos:         number | null
  avg_buy_price:    number | null
  short_pos:        number | null
  avg_sell_price:   number | null
  prev_settl:       number | null
  settl_today:      number | null
  mtm_pl:           number | null
  margin_occupied:  number | null
  sh:               string | null
  market_val_long:  number | null
  market_val_short: number | null
}

function parsePositionSummary(
  ws: XLSX.WorkSheet,
  range: XLSX.Range,
): ParsedPositionSummaryRow[] | null {
  // ── Find 持仓汇总 header row ──────────────────────────────────────────
  let sectionRow = -1
  for (let r = range.s.r; r <= range.e.r; r++) {
    const aVal = String(ws[XLSX.utils.encode_cell({ r, c: range.s.c })]?.v ?? "").trim()
    if (aVal.includes("持仓汇总")) { sectionRow = r; break }
  }
  if (sectionRow === -1) return null

  const enRow = sectionRow + 2
  const dataStart = sectionRow + 3
  if (enRow > range.e.r) return []

  // ── Map column index → field name ────────────────────────────────────
  const colMap: { c: number; field: string }[] = []
  for (let c = range.s.c; c <= range.e.c; c++) {
    const en = String(ws[XLSX.utils.encode_cell({ r: enRow, c })]?.v ?? "").trim()
    const field = EN_POSITION_SUMMARY_HEADER_MAP[en]
    if (field) colMap.push({ c, field })
  }
  if (colMap.length === 0) return []

  // ── Read data rows; stop at first 总计 xx 行 ─────────────────────────
  const rows: ParsedPositionSummaryRow[] = []
  for (let r = dataStart; r <= range.e.r; r++) {
    const aVal = String(ws[XLSX.utils.encode_cell({ r, c: range.s.c })]?.v ?? "").trim()
    if ((aVal.startsWith("总计") && aVal.includes("行")) || /^总计\d+行/.test(aVal)) break

    const raw: Record<string, string | number | null> = {}
    for (const { c, field } of colMap) {
      raw[field] = POSITION_SUMMARY_NUM_FIELDS.has(field) ? cellNum(ws, r, c) : cellStr(ws, r, c)
    }

    if (Object.values(raw).every(v => v === null)) continue

    rows.push({
      rowNum:           r - dataStart,
      invest_unit:      (raw["invest_unit"]      as string | null) ?? null,
      exchange:         (raw["exchange"]          as string | null) ?? null,
      trading_code:     (raw["trading_code"]      as string | null) ?? null,
      product:          (raw["product"]           as string | null) ?? null,
      instrument:       (raw["instrument"]        as string | null) ?? null,
      long_pos:         (raw["long_pos"]          as number | null) ?? null,
      avg_buy_price:    (raw["avg_buy_price"]     as number | null) ?? null,
      short_pos:        (raw["short_pos"]         as number | null) ?? null,
      avg_sell_price:   (raw["avg_sell_price"]    as number | null) ?? null,
      prev_settl:       (raw["prev_settl"]        as number | null) ?? null,
      settl_today:      (raw["settl_today"]       as number | null) ?? null,
      mtm_pl:           (raw["mtm_pl"]            as number | null) ?? null,
      margin_occupied:  (raw["margin_occupied"]   as number | null) ?? null,
      sh:               (raw["sh"]               as string | null) ?? null,
      market_val_long:  (raw["market_val_long"]   as number | null) ?? null,
      market_val_short: (raw["market_val_short"]  as number | null) ?? null,
    })
  }
  return rows
}

const POSITION_SUMMARY_UPSERT_SQL = `
  INSERT INTO guosen_position_summary
    (source_file, client_id, client_name, settlement_date, date_range_raw, row_num,
     invest_unit, exchange, trading_code, product, instrument,
     long_pos, avg_buy_price, short_pos, avg_sell_price,
     prev_settl, settl_today, mtm_pl, margin_occupied, sh,
     market_val_long, market_val_short, updated_at)
  VALUES
    ($1,$2,$3,$4,$5,$6, $7,$8,$9,$10,$11, $12,$13,$14,$15, $16,$17,$18,$19,$20, $21,$22, NOW())
  ON CONFLICT (source_file, row_num)
  DO UPDATE SET
    client_id        = EXCLUDED.client_id,
    client_name      = EXCLUDED.client_name,
    settlement_date  = EXCLUDED.settlement_date,
    date_range_raw   = EXCLUDED.date_range_raw,
    invest_unit      = EXCLUDED.invest_unit,
    exchange         = EXCLUDED.exchange,
    trading_code     = EXCLUDED.trading_code,
    product          = EXCLUDED.product,
    instrument       = EXCLUDED.instrument,
    long_pos         = EXCLUDED.long_pos,
    avg_buy_price    = EXCLUDED.avg_buy_price,
    short_pos        = EXCLUDED.short_pos,
    avg_sell_price   = EXCLUDED.avg_sell_price,
    prev_settl       = EXCLUDED.prev_settl,
    settl_today      = EXCLUDED.settl_today,
    mtm_pl           = EXCLUDED.mtm_pl,
    margin_occupied  = EXCLUDED.margin_occupied,
    sh               = EXCLUDED.sh,
    market_val_long  = EXCLUDED.market_val_long,
    market_val_short = EXCLUDED.market_val_short,
    updated_at       = NOW()
  RETURNING (xmax = 0) AS is_insert
`

export async function runPositionSummaryETL(mode: "full" | "incremental"): Promise<ETLResult> {
  await ensurePositionSummaryTable()

  const { files, folder } = listDownloadedFiles()
  const result: ETLResult = { processed: 0, inserted: 0, updated: 0, skipped: 0, errors: [] }

  if (files.length === 0) return result

  let processedFiles = new Set<string>()
  if (mode === "incremental") {
    const rows = await query<{ source_file: string }>(
      "SELECT DISTINCT source_file FROM guosen_position_summary"
    )
    processedFiles = new Set(rows.map((r) => r.source_file))
  }

  for (const file of [...files].reverse()) {
    if (mode === "incremental" && processedFiles.has(file.name)) {
      result.skipped++
      continue
    }

    try {
      const filePath = path.join(folder, file.name)
      const buf = fs.readFileSync(filePath)

      const summary = parseAccountSummary(buf, file.name)
      const clientId = summary?.client_id ?? ""
      const clientName = summary?.client_name ?? ""
      const settlementDate = summary?.trade_date ?? ""
      const dateRangeRaw = summary?.date_range_raw ?? ""

      const wb = XLSX.read(buf, { type: "buffer", cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      if (!ws || !ws["!ref"]) {
        result.errors.push(`${file.name}: 无法读取工作表`)
        continue
      }
      const range = XLSX.utils.decode_range(ws["!ref"]!)

      const rows = parsePositionSummary(ws, range)
      if (rows === null) {
        result.errors.push(`${file.name}: 未找到持仓汇总区域`)
        continue
      }
      if (rows.length === 0) {
        result.processed++
        continue
      }

      for (const row of rows) {
        const res = await rawQuery(POSITION_SUMMARY_UPSERT_SQL, [
          file.name, clientId, clientName, settlementDate || null, dateRangeRaw, row.rowNum,
          row.invest_unit, row.exchange, row.trading_code, row.product, row.instrument,
          row.long_pos, row.avg_buy_price, row.short_pos, row.avg_sell_price,
          row.prev_settl, row.settl_today, row.mtm_pl, row.margin_occupied, row.sh,
          row.market_val_long, row.market_val_short,
        ])
        if (res.rows[0]?.is_insert) result.inserted++
        else result.updated++
      }

      result.processed++
    } catch (e) {
      result.errors.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return result
}

// ─── Position Closed (平仓明细) ────────────────────────────────────────────────
// English headers from the sheet:
// CloseDate, InvestUnit, Exchange, TradingCode, Product, Instrument,
// OpenDate, S/H, B/S, Lots, Pos.OpenPrice, Prev.Sttl, Trans.Price,
// RealizedP/L, PremiumR/P

const POSITION_CLOSED_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS guosen_position_closed (
    id               SERIAL PRIMARY KEY,
    source_file      TEXT NOT NULL,
    client_id        TEXT,
    client_name      TEXT,
    settlement_date  DATE,
    date_range_raw   TEXT,
    row_num          INTEGER NOT NULL,
    close_date       TEXT,
    invest_unit      TEXT,
    exchange         TEXT,
    trading_code     TEXT,
    product          TEXT,
    instrument       TEXT,
    open_date        TEXT,
    sh               TEXT,
    bs               TEXT,
    lots             NUMERIC,
    pos_open_price   NUMERIC,
    prev_settl       NUMERIC,
    trans_price      NUMERIC,
    realized_pl      NUMERIC,
    premium_rp       NUMERIC,
    updated_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (source_file, row_num)
  )
`

async function ensurePositionClosedTable(): Promise<void> {
  await rawQuery(POSITION_CLOSED_TABLE_SQL)
}

const EN_POSITION_CLOSED_HEADER_MAP: Record<string, string> = {
  "CloseDate":     "close_date",
  "InvestUnit":    "invest_unit",
  "Exchange":      "exchange",
  "TradingCode":   "trading_code",
  "Product":       "product",
  "Instrument":    "instrument",
  "OpenDate":      "open_date",
  "S/H":           "sh",
  "B/S":           "bs",
  "Lots":          "lots",
  "Pos.OpenPrice": "pos_open_price",
  "Prev.Sttl":     "prev_settl",
  "Trans.Price":   "trans_price",
  "RealizedP/L":   "realized_pl",
  "PremiumR/P":    "premium_rp",
}

const POSITION_CLOSED_NUM_FIELDS = new Set([
  "lots", "pos_open_price", "prev_settl", "trans_price", "realized_pl", "premium_rp",
])

type ParsedPositionClosedRow = {
  rowNum:         number
  close_date:     string | null
  invest_unit:    string | null
  exchange:       string | null
  trading_code:   string | null
  product:        string | null
  instrument:     string | null
  open_date:      string | null
  sh:             string | null
  bs:             string | null
  lots:           number | null
  pos_open_price: number | null
  prev_settl:     number | null
  trans_price:    number | null
  realized_pl:    number | null
  premium_rp:     number | null
}

function parsePositionClosed(
  ws: XLSX.WorkSheet,
  range: XLSX.Range,
): ParsedPositionClosedRow[] | null {
  // ── Find 平仓明细 header row ──────────────────────────────────────────
  let sectionRow = -1
  for (let r = range.s.r; r <= range.e.r; r++) {
    const aVal = String(ws[XLSX.utils.encode_cell({ r, c: range.s.c })]?.v ?? "").trim()
    if (aVal.includes("平仓明细")) { sectionRow = r; break }
  }
  if (sectionRow === -1) return null

  const enRow = sectionRow + 2
  const dataStart = sectionRow + 3
  if (enRow > range.e.r) return []

  // ── Map column index → field name ────────────────────────────────────
  const colMap: { c: number; field: string }[] = []
  for (let c = range.s.c; c <= range.e.c; c++) {
    const en = String(ws[XLSX.utils.encode_cell({ r: enRow, c })]?.v ?? "").trim()
    const field = EN_POSITION_CLOSED_HEADER_MAP[en]
    if (field) colMap.push({ c, field })
  }
  if (colMap.length === 0) return []

  // ── Read data rows; stop at first 总计 xx 行 ─────────────────────────
  const rows: ParsedPositionClosedRow[] = []
  for (let r = dataStart; r <= range.e.r; r++) {
    const aVal = String(ws[XLSX.utils.encode_cell({ r, c: range.s.c })]?.v ?? "").trim()
    if ((aVal.startsWith("总计") && aVal.includes("行")) || /^总计\d+行/.test(aVal)) break

    const raw: Record<string, string | number | null> = {}
    for (const { c, field } of colMap) {
      raw[field] = POSITION_CLOSED_NUM_FIELDS.has(field) ? cellNum(ws, r, c) : cellStr(ws, r, c)
    }

    if (Object.values(raw).every(v => v === null)) continue

    rows.push({
      rowNum:         r - dataStart,
      close_date:     (raw["close_date"]     as string | null) ?? null,
      invest_unit:    (raw["invest_unit"]     as string | null) ?? null,
      exchange:       (raw["exchange"]        as string | null) ?? null,
      trading_code:   (raw["trading_code"]    as string | null) ?? null,
      product:        (raw["product"]         as string | null) ?? null,
      instrument:     (raw["instrument"]      as string | null) ?? null,
      open_date:      (raw["open_date"]       as string | null) ?? null,
      sh:             (raw["sh"]             as string | null) ?? null,
      bs:             (raw["bs"]             as string | null) ?? null,
      lots:           (raw["lots"]           as number | null) ?? null,
      pos_open_price: (raw["pos_open_price"] as number | null) ?? null,
      prev_settl:     (raw["prev_settl"]     as number | null) ?? null,
      trans_price:    (raw["trans_price"]    as number | null) ?? null,
      realized_pl:    (raw["realized_pl"]    as number | null) ?? null,
      premium_rp:     (raw["premium_rp"]     as number | null) ?? null,
    })
  }
  return rows
}

const POSITION_CLOSED_UPSERT_SQL = `
  INSERT INTO guosen_position_closed
    (source_file, client_id, client_name, settlement_date, date_range_raw, row_num,
     close_date, invest_unit, exchange, trading_code, product, instrument,
     open_date, sh, bs, lots, pos_open_price, prev_settl, trans_price,
     realized_pl, premium_rp, updated_at)
  VALUES
    ($1,$2,$3,$4,$5,$6, $7,$8,$9,$10,$11,$12, $13,$14,$15,$16,$17,$18,$19, $20,$21, NOW())
  ON CONFLICT (source_file, row_num)
  DO UPDATE SET
    client_id       = EXCLUDED.client_id,
    client_name     = EXCLUDED.client_name,
    settlement_date = EXCLUDED.settlement_date,
    date_range_raw  = EXCLUDED.date_range_raw,
    close_date      = EXCLUDED.close_date,
    invest_unit     = EXCLUDED.invest_unit,
    exchange        = EXCLUDED.exchange,
    trading_code    = EXCLUDED.trading_code,
    product         = EXCLUDED.product,
    instrument      = EXCLUDED.instrument,
    open_date       = EXCLUDED.open_date,
    sh              = EXCLUDED.sh,
    bs              = EXCLUDED.bs,
    lots            = EXCLUDED.lots,
    pos_open_price  = EXCLUDED.pos_open_price,
    prev_settl      = EXCLUDED.prev_settl,
    trans_price     = EXCLUDED.trans_price,
    realized_pl     = EXCLUDED.realized_pl,
    premium_rp      = EXCLUDED.premium_rp,
    updated_at      = NOW()
  RETURNING (xmax = 0) AS is_insert
`

export async function runPositionClosedETL(mode: "full" | "incremental"): Promise<ETLResult> {
  await ensurePositionClosedTable()

  const { files, folder } = listDownloadedFiles()
  const result: ETLResult = { processed: 0, inserted: 0, updated: 0, skipped: 0, errors: [] }

  if (files.length === 0) return result

  let processedFiles = new Set<string>()
  if (mode === "incremental") {
    const rows = await query<{ source_file: string }>(
      "SELECT DISTINCT source_file FROM guosen_position_closed"
    )
    processedFiles = new Set(rows.map((r) => r.source_file))
  }

  for (const file of [...files].reverse()) {
    if (mode === "incremental" && processedFiles.has(file.name)) {
      result.skipped++
      continue
    }

    try {
      const filePath = path.join(folder, file.name)
      const buf = fs.readFileSync(filePath)

      const summary = parseAccountSummary(buf, file.name)
      const clientId = summary?.client_id ?? ""
      const clientName = summary?.client_name ?? ""
      const settlementDate = summary?.trade_date ?? ""
      const dateRangeRaw = summary?.date_range_raw ?? ""

      const wb = XLSX.read(buf, { type: "buffer", cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      if (!ws || !ws["!ref"]) {
        result.errors.push(`${file.name}: 无法读取工作表`)
        continue
      }
      const range = XLSX.utils.decode_range(ws["!ref"]!)

      const rows = parsePositionClosed(ws, range)
      if (rows === null) {
        result.errors.push(`${file.name}: 未找到平仓明细区域`)
        continue
      }
      if (rows.length === 0) {
        result.processed++
        continue
      }

      for (const row of rows) {
        const res = await rawQuery(POSITION_CLOSED_UPSERT_SQL, [
          file.name, clientId, clientName, settlementDate || null, dateRangeRaw, row.rowNum,
          row.close_date, row.invest_unit, row.exchange, row.trading_code, row.product, row.instrument,
          row.open_date, row.sh, row.bs, row.lots, row.pos_open_price, row.prev_settl, row.trans_price,
          row.realized_pl, row.premium_rp,
        ])
        if (res.rows[0]?.is_insert) result.inserted++
        else result.updated++
      }

      result.processed++
    } catch (e) {
      result.errors.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return result
}

// ─── Combined entry point ─────────────────────────────────────────────────────

export async function runSettlementFilesETL(mode: "full" | "incremental"): Promise<SettlementETLResult> {
  const [accountSummary, transactions, positions, positionSummary, positionClosed] = await Promise.all([
    runAccountSummaryETL(mode),
    runTransactionRecordsETL(mode),
    runPositionDetailETL(mode),
    runPositionSummaryETL(mode),
    runPositionClosedETL(mode),
  ])
  return { accountSummary, transactions, positions, positionSummary, positionClosed }
}
