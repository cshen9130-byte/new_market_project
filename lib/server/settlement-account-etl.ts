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

export type SettlementAnalysisPosition = {
  symbol: string
  productCode: string
  productName: string
  instrument: string
  exchange: string
  sector: string
  longLots: number
  shortLots: number
  longMarketValue: number
  shortMarketValue: number
  grossMarketValue: number
  netMarketValue: number
  mtmPl: number
  marginOccupied: number
}

export type SettlementAnalysisChartItem = {
  label: string
  value: number
  netValue?: number
  mtmPl?: number
}

export type SettlementAnalysisSectorItem = {
  sector: string
  longValue: number
  shortValue: number
  grossValue: number
  netValue: number
  mtmPl: number
}

export type SettlementStrategyInference = {
  primaryStrategy: string
  candidateStrategies: string[]
  confidence: "high" | "medium" | "low"
  bias: "long" | "short" | "neutral"
  signals: string[]
  risks: string[]
}

export type SettlementWorkbookAnalysis = {
  sourceFileName: string
  summary: {
    clientId: string
    clientName: string
    tradeDate: string
    dateRangeRaw: string
    clientEquity: number | null
    balanceCf: number | null
    marginOccupied: number | null
    fundAvailable: number | null
    riskDegreeRatio: number | null
    realizedPl: number | null
    mtmPl: number | null
    longMarketValue: number
    shortMarketValue: number
    grossExposure: number
    netExposure: number
    grossLeverage: number | null
    netExposureRatio: number | null
    positionCount: number
    detailRowCount: number
    sectorCount: number
    topPositionName: string | null
    topPositionShare: number | null
    topSectorName: string | null
    topSectorShare: number | null
  }
  charts: {
    holdings: SettlementAnalysisChartItem[]
    sectors: SettlementAnalysisSectorItem[]
    directions: SettlementAnalysisChartItem[]
    exchanges: SettlementAnalysisChartItem[]
  }
  positions: SettlementAnalysisPosition[]
  strategyInference: SettlementStrategyInference
  warnings: string[]
}

const SETTLEMENT_PRODUCT_NAME_MAP: Record<string, string> = {
  AU: "黄金",
  AG: "白银",
  CU: "沪铜",
  AL: "沪铝",
  ZN: "沪锌",
  PB: "沪铅",
  NI: "沪镍",
  SN: "沪锡",
  AO: "氧化铝",
  I: "铁矿",
  RB: "螺纹钢",
  HC: "热卷",
  SS: "不锈钢",
  JM: "焦煤",
  J: "焦炭",
  FG: "玻璃",
  SF: "硅铁",
  SM: "锰硅",
  ZC: "动力煤",
  SC: "原油",
  FU: "燃料油",
  LU: "低硫燃油",
  PG: "液化气",
  BU: "沥青",
  TA: "PTA",
  EG: "乙二醇",
  MA: "甲醇",
  PP: "聚丙烯",
  L: "塑料",
  V: "PVC",
  RU: "橡胶",
  BR: "丁苯橡胶",
  NR: "20号胶",
  SA: "纯碱",
  UR: "尿素",
  PX: "PX",
  EB: "苯乙烯",
  LC: "碳酸锂",
  SI: "工业硅",
  IF: "沪深300",
  IH: "上证50",
  IC: "中证500",
  IM: "中证1000",
  TS: "2年国债",
  TF: "5年国债",
  T: "10年国债",
  TL: "30年国债",
  C: "玉米",
  CS: "淀粉",
  A: "豆一",
  B: "豆二",
  M: "豆粕",
  Y: "豆油",
  RM: "菜粕",
  OI: "菜油",
  P: "棕榈油",
  SR: "白糖",
  CF: "棉花",
  CY: "棉纱",
  AP: "苹果",
  CJ: "红枣",
  JD: "鸡蛋",
  LH: "生猪",
  EC: "集运指数",
}

const SETTLEMENT_SECTOR_RULES: Record<string, Set<string>> = {
  农产: new Set(["C", "CS", "A", "B", "M", "Y", "RM", "OI", "P", "SR", "CF", "CY", "AP", "CJ", "JD", "LH", "WH", "PM", "RI", "JR", "LR", "GN", "PK"]),
  贵金属: new Set(["AU", "AG"]),
  有色: new Set(["CU", "AL", "ZN", "PB", "NI", "SN", "AO", "BC"]),
  新能源: new Set(["LC", "SI", "PS"]),
  黑色: new Set(["I", "RB", "HC", "SS", "JM", "J", "FG", "SF", "SM", "ZC"]),
  能源化工: new Set(["SC", "FU", "LU", "PG", "BU", "TA", "EG", "MA", "PP", "L", "V", "RU", "BR", "NR", "SA", "UR", "PX", "EB", "SP", "PF"]),
  股指: new Set(["IF", "IH", "IC", "IM"]),
  国债: new Set(["TS", "TF", "T", "TL"]),
  航运: new Set(["EC", "SW"]),
}

// Chinese product name → standard exchange product code
// Used as fallback when TradingCode is numeric (e.g., internal contract IDs)
const CHINESE_PRODUCT_NAME_TO_CODE: Record<string, string> = {
  // 农产
  "玉米": "C", "淀粉": "CS", "玉米淀粉": "CS",
  "大豆": "A", "大豆一号": "A", "黄大豆一号": "A", "大豆二号": "B", "黄大豆二号": "B",
  "豆粕": "M", "豆油": "Y", "菜粕": "RM", "菜籽粕": "RM", "菜油": "OI", "菜籽油": "OI",
  "棕榈油": "P", "白糖": "SR", "棉花": "CF", "棉纱": "CY",
  "苹果": "AP", "红枣": "CJ", "鸡蛋": "JD", "鲜鸡蛋": "JD", "生猪": "LH", "花生": "PK", "花生仁": "PK",
  "强麦": "WH", "硬冬小麦": "WH", "普麦": "PM",
  "早籼稻": "RI", "粳稻": "JR", "晚籼稻": "LR",
  // 贵金属
  "黄金": "AU", "白银": "AG",
  // 有色
  "铜": "CU", "铝": "AL", "锌": "ZN", "铅": "PB",
  "镍": "NI", "锡": "SN", "氧化铝": "AO",
  // 新能源
  "碳酸锂": "LC", "工业硅": "SI", "多晶硅": "PS",
  // 黑色
  "铁矿石": "I", "铁矿": "I", "螺纹钢": "RB", "热轧卷板": "HC", "不锈钢": "SS",
  "焦煤": "JM", "焦炭": "J", "玻璃": "FG", "硅铁": "SF", "锰硅": "SM", "动力煤": "ZC",
  // 能源化工
  "原油": "SC", "燃料油": "FU", "低硫燃料油": "LU",
  "液化石油气": "PG", "LPG": "PG", "沥青": "BU",
  "精对苯二甲酸": "TA", "PTA": "TA",
  "乙二醇": "EG", "甲醇": "MA", "聚丙烯": "PP",
  "线型低密度聚乙烯": "L", "聚乙烯": "L",
  "聚氯乙烯": "V", "PVC": "V",
  "天然橡胶": "RU", "合成橡胶": "BR", "20号胶": "NR",
  "纯碱": "SA", "尿素": "UR",
  "对二甲苯": "PX", "苯乙烯": "EB",
  "纸浆": "SP", "短纤": "PF", "涤纶短纤": "PF",
  // 股指
  "沪深300": "IF", "上证50": "IH", "中证500": "IC", "中证1000": "IM",
  // 国债
  "2年期国债": "TS", "5年期国债": "TF", "10年期国债": "T", "30年期国债": "TL",
  // 航运
  "集运指数": "EC", "集运欧线": "EC",
}

function finiteNumber(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function absNumber(value: number | null | undefined): number {
  return Math.abs(finiteNumber(value))
}

function normalizeRiskDegree(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null
  if (value > 1 && value <= 100) return value / 100
  if (value < 0) return null
  return value
}

function formatPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}

export function extractSettlementProductCode(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const raw = String(candidate ?? "").trim()
    if (!raw) continue
    // Try leading ASCII letters (e.g., "RU2506" → "RU", "rb2506" → "RB")
    const upper = raw.toUpperCase()
    const match = upper.match(/^[A-Z]{1,3}/)
    if (match) return match[0]
    // Try Chinese product name lookup (e.g., 品种 column value like "天然橡胶")
    const byName = CHINESE_PRODUCT_NAME_TO_CODE[raw]
    if (byName) return byName
  }
  return ""
}

export function getSettlementSector(productCode: string, instrument: string, productName?: string): string {
  const code = productCode.toUpperCase()

  // 1. Direct product code lookup (works for both futures AND options on that commodity)
  if (code) {
    for (const [sector, codes] of Object.entries(SETTLEMENT_SECTOR_RULES)) {
      if (codes.has(code)) return sector
    }
  }

  // 2. Partial Chinese name match — handles "天然橡胶期权".includes("天然橡胶") → RU → 能源化工
  const nameCandidates = [productName, instrument].filter(Boolean) as string[]
  for (const name of nameCandidates) {
    for (const [cn, code2] of Object.entries(CHINESE_PRODUCT_NAME_TO_CODE)) {
      if (name.includes(cn)) {
        for (const [sector, codes] of Object.entries(SETTLEMENT_SECTOR_RULES)) {
          if (codes.has(code2)) return sector
        }
      }
    }
  }

  // 3. If still unclassified and clearly an option with no identifiable underlying → generic bucket
  const allText = [productName, instrument].filter(Boolean).join(" ")
  if (/期权/.test(allText)) return "期权"

  return "其他"
}

export function getSettlementProductName(productCode: string, instrument: string, symbol: string): string {
  if (SETTLEMENT_PRODUCT_NAME_MAP[productCode]) return SETTLEMENT_PRODUCT_NAME_MAP[productCode]
  if (instrument.trim()) return instrument.trim()
  if (symbol.trim()) return symbol.trim()
  return productCode || "未识别品种"
}

export function inferSettlementStrategy(params: {
  grossExposure: number
  netExposure: number
  longExposure: number
  shortExposure: number
  grossLeverage: number | null
  riskDegreeRatio: number | null
  fundAvailable: number | null
  clientEquity: number | null
  topPositionShare: number
  topSectorShare: number
  topSectorName: string | null
  hedgedSectorCount: number
  commodityShare: number
  equityIndexShare: number
  treasuryShare: number
  optionShare: number
}): SettlementStrategyInference {
  const {
    grossExposure,
    netExposure,
    longExposure,
    shortExposure,
    grossLeverage,
    riskDegreeRatio,
    fundAvailable,
    clientEquity,
    topPositionShare,
    topSectorShare,
    topSectorName,
    hedgedSectorCount,
    commodityShare,
    equityIndexShare,
    treasuryShare,
    optionShare,
  } = params

  if (grossExposure <= 0) {
    return {
      primaryStrategy: "空仓 / 低持仓观察",
      candidateStrategies: ["空仓 / 低持仓观察"],
      confidence: "medium",
      bias: "neutral",
      signals: ["结算单中未识别到有效持仓敞口，当前更接近空仓或轻仓状态。"],
      risks: ["若这是盘后结算单但页面为空仓，需确认文件是否为完整版本。"],
    }
  }

  const netRatio = grossExposure > 0 ? Math.abs(netExposure) / grossExposure : 0
  const bias: "long" | "short" | "neutral" = netExposure > grossExposure * 0.15
    ? "long"
    : netExposure < -grossExposure * 0.15
      ? "short"
      : "neutral"

  let primaryStrategy = "多品种配置 / 混合交易"
  let confidence: "high" | "medium" | "low" = "low"
  const candidates: string[] = []
  const signals: string[] = [
    `总敞口 ${grossExposure.toFixed(0)}，净敞口 ${netExposure.toFixed(0)}，净敞口占总敞口 ${formatPct(netRatio)}。`,
  ]
  const risks: string[] = []

  if (grossLeverage != null) {
    signals.push(`总敞口约为客户权益的 ${grossLeverage.toFixed(2)}x。`)
  }
  if (topSectorName) {
    signals.push(`最大板块为 ${topSectorName}，占总敞口 ${formatPct(topSectorShare)}。`)
  }
  if (hedgedSectorCount > 0) {
    signals.push(`存在 ${hedgedSectorCount} 个同时持有多空头寸的板块。`)
  }

  if (treasuryShare >= 0.55) {
    primaryStrategy = "利率方向 / 国债期货策略"
    confidence = treasuryShare >= 0.75 ? "high" : "medium"
    candidates.push(primaryStrategy, "宏观利率交易", "久期管理 / 对冲")
  } else if (equityIndexShare >= 0.45 && shortExposure > longExposure * 1.1) {
    primaryStrategy = "股指对冲 / 贝塔保护"
    confidence = equityIndexShare >= 0.65 ? "high" : "medium"
    candidates.push(primaryStrategy, "指数择时", "股票套保")
  } else if (optionShare >= 0.25) {
    primaryStrategy = "期权波动率 / 保护性策略"
    confidence = optionShare >= 0.45 ? "high" : "medium"
    candidates.push(primaryStrategy, "保护性对冲", "波动率交易")
  } else if (netRatio <= 0.2 && longExposure > 0 && shortExposure > 0 && hedgedSectorCount >= 2) {
    primaryStrategy = "跨品种对冲 / 市场中性"
    confidence = hedgedSectorCount >= 3 ? "high" : "medium"
    candidates.push(primaryStrategy, "价差 / 对冲交易", "板块内对冲")
  } else if (commodityShare >= 0.6 && netRatio >= 0.45) {
    primaryStrategy = `商品趋势 CTA（${bias === "short" ? "偏空" : "偏多"}）`
    confidence = commodityShare >= 0.8 ? "high" : "medium"
    candidates.push(primaryStrategy, "商品事件驱动", `${topSectorName ?? "商品"}方向交易`)
  } else if (topSectorShare >= 0.45 && topSectorName) {
    primaryStrategy = `${topSectorName}板块主题交易`
    confidence = topSectorShare >= 0.6 ? "high" : "medium"
    candidates.push(primaryStrategy, "集中仓位交易", "主题轮动")
  } else if (grossLeverage != null && grossLeverage >= 2 && netRatio >= 0.35) {
    primaryStrategy = `高杠杆方向交易（${bias === "short" ? "偏空" : "偏多"}）`
    confidence = grossLeverage >= 3 ? "high" : "medium"
    candidates.push(primaryStrategy, "方向性交易")
  } else if (netRatio >= 0.35) {
    primaryStrategy = `方向性多品种交易（${bias === "short" ? "偏空" : "偏多"}）`
    confidence = "medium"
    candidates.push(primaryStrategy, "宏观主观交易")
  } else {
    candidates.push(primaryStrategy, "多板块配置")
  }

  if (commodityShare >= 0.4) candidates.push("商品配置 / CTA")
  if (equityIndexShare >= 0.25) candidates.push("股指管理 / 对冲")
  if (treasuryShare >= 0.25) candidates.push("利率交易")
  if (hedgedSectorCount >= 1) candidates.push("板块对冲")

  if (grossLeverage != null && grossLeverage >= 2) {
    risks.push(`总敞口已达客户权益的 ${grossLeverage.toFixed(2)}x，杠杆敏感度偏高。`)
  }
  if (riskDegreeRatio != null && riskDegreeRatio >= 0.75) {
    risks.push(`风险度约 ${formatPct(riskDegreeRatio)}，需关注保证金与波动冲击。`)
  }
  if (topSectorShare >= 0.35 && topSectorName) {
    risks.push(`${topSectorName} 板块集中度达到 ${formatPct(topSectorShare)}，板块单边波动会显著影响组合。`)
  }
  if (topPositionShare >= 0.18) {
    risks.push(`最大单合约敞口占总敞口 ${formatPct(topPositionShare)}，单一持仓集中度偏高。`)
  }
  if (clientEquity != null && fundAvailable != null && clientEquity > 0 && fundAvailable / clientEquity <= 0.12) {
    risks.push("可用资金占客户权益比例偏低，后续追保和加仓弹性有限。")
  }
  if (risks.length === 0) {
    risks.push("当前仓位结构未出现单一极端风险，但仍需结合成交记录与历史净值进一步验证策略稳定性。")
  }

  return {
    primaryStrategy,
    candidateStrategies: Array.from(new Set(candidates.filter(Boolean))),
    confidence,
    bias,
    signals,
    risks,
  }
}

export function analyzeSettlementWorkbook(buffer: Buffer, sourceFileName: string): SettlementWorkbookAnalysis {
  const summary = parseAccountSummary(buffer, sourceFileName)
  if (!summary) {
    throw new Error("请上传包含“交易结算单(盯市)”内容的国信结算单文件。")
  }

  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true })
  const worksheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!worksheet || !worksheet["!ref"]) {
    throw new Error("无法读取结算单工作表。")
  }

  const range = XLSX.utils.decode_range(worksheet["!ref"])
  const positionSummaryRows = parsePositionSummary(worksheet, range)
  if (positionSummaryRows === null) {
    throw new Error("未找到“持仓汇总”区域。")
  }

  const positionDetailRows = parsePositionDetail(worksheet, range)
  const warnings: string[] = []
  if (positionDetailRows === null) {
    warnings.push("未找到“持仓明细”区域，本次分析仅使用持仓汇总数据。")
  }

  // Build a market-value lookup from detail section (持仓明细).
  // 持仓汇总 leaves MarketValue columns blank for futures rows; the detail
  // section has market_val per individual open position with B/S direction.
  const detailMVMap = new Map<string, { longMV: number; shortMV: number }>()
  if (positionDetailRows) {
    warnings.push(`[DBG] detailRows count=${positionDetailRows.length}`)
    positionDetailRows.slice(0, 5).forEach((drow, i) => {
      warnings.push(`[DBG] drow${i} inst=${drow.instrument} bs=${JSON.stringify(drow.bs)} mv=${drow.market_val}`)
    })
    for (const drow of positionDetailRows) {
      const inst = String(drow.instrument ?? '').trim().toLowerCase()
      const key = inst || String(drow.product ?? '').trim().toLowerCase()
      if (!key) continue
      const mv = finiteNumber(drow.market_val)
      if (mv === 0) continue
      const entry = detailMVMap.get(key) ?? { longMV: 0, shortMV: 0 }
      const isBuy = drow.bs?.includes('\u4e70') || drow.bs === 'B' || drow.bs === 'b'
      if (isBuy) entry.longMV += Math.abs(mv)
      else entry.shortMV += Math.abs(mv)
      detailMVMap.set(key, entry)
    }
    warnings.push(`[DBG] detailMVMap size=${detailMVMap.size} keys=${JSON.stringify([...detailMVMap.keys()].slice(0,5))}`)
  } else {
    warnings.push('[DBG] positionDetailRows is NULL')
  }

  // Debug: show first 3 summary rows to verify long_pos/short_pos/margin data
  positionSummaryRows.slice(0, 3).forEach((r2, i) => {
    warnings.push(`[SUM${i}] inst=${r2.instrument} L=${r2.long_pos} S=${r2.short_pos} margin=${r2.margin_occupied} mvL=${r2.market_val_long} mvS=${r2.market_val_short} settl=${r2.settl_today}`)
  })

  const positions: SettlementAnalysisPosition[] = positionSummaryRows
    .map((row) => {
      const symbol = String(row.trading_code ?? "").trim().toUpperCase()
      const productCode = extractSettlementProductCode(row.trading_code, row.product, row.instrument)
      const instrument = String(row.instrument ?? "").trim()
      const productName = getSettlementProductName(productCode, instrument, symbol)
      const sector = getSettlementSector(productCode, instrument, String(row.product ?? "").trim())
      const longLots = finiteNumber(row.long_pos)
      const shortLots = finiteNumber(row.short_pos)
      const marginOccupied = absNumber(row.margin_occupied)
      // Priority 1: market values from 持仓汇总 (populated for options)
      let longMarketValue = absNumber(row.market_val_long)
      let shortMarketValue = absNumber(row.market_val_short)
      // Priority 2: aggregated market_val from 持仓明细 (if MarketVal column exists)
      if (longMarketValue === 0 && shortMarketValue === 0) {
        const detailKey = String(row.instrument ?? "").trim().toLowerCase() || String(row.product ?? "").trim().toLowerCase()
        const detailMV = detailMVMap.get(detailKey)
        if (detailMV) {
          longMarketValue = detailMV.longMV
          shortMarketValue = detailMV.shortMV
        }
      }
      // Priority 3: settl_today * lots as notional proxy (consistent within each product)
      if (longMarketValue === 0 && shortMarketValue === 0) {
        const settl = finiteNumber(row.settl_today)
        if (settl > 0) {
          longMarketValue = longLots * settl
          shortMarketValue = shortLots * settl
        }
      }
      // Priority 4: margin_occupied split by lot ratio (last resort)
      if (longMarketValue === 0 && shortMarketValue === 0 && marginOccupied > 0) {
        const totalLots = longLots + shortLots
        if (totalLots > 0) {
          longMarketValue = marginOccupied * (longLots / totalLots)
          shortMarketValue = marginOccupied * (shortLots / totalLots)
        } else if (longLots > 0) {
          longMarketValue = marginOccupied
        } else if (shortLots > 0) {
          shortMarketValue = marginOccupied
        }
      }
      const grossMarketValue = longMarketValue + shortMarketValue
      const netMarketValue = longMarketValue - shortMarketValue

      return {
        symbol: symbol || productCode || productName,
        productCode,
        productName,
        instrument,
        exchange: String(row.exchange ?? "").trim() || "\u672a\u77e5\u4ea4\u6613\u6240",
        sector,
        longLots,
        shortLots,
        longMarketValue,
        shortMarketValue,
        grossMarketValue,
        netMarketValue,
        mtmPl: finiteNumber(row.mtm_pl),
        marginOccupied,
      }
    })
    .filter((row) => row.grossMarketValue > 0 || row.longLots > 0 || row.shortLots > 0 || row.mtmPl !== 0)
    .sort((a, b) => b.grossMarketValue - a.grossMarketValue || Math.abs(b.mtmPl) - Math.abs(a.mtmPl))

  const longMarketValue = positions.reduce((sum, row) => sum + row.longMarketValue, 0)
  const shortMarketValue = positions.reduce((sum, row) => sum + row.shortMarketValue, 0)
  const grossExposure = longMarketValue + shortMarketValue
  const netExposure = longMarketValue - shortMarketValue
  const clientEquity = summary.client_equity
  const grossLeverage = clientEquity && clientEquity > 0 ? grossExposure / clientEquity : null
  const netExposureRatio = clientEquity && clientEquity > 0 ? netExposure / clientEquity : null
  const riskDegreeRatio = normalizeRiskDegree(summary.risk_degree)

  const sectorMap = new Map<string, SettlementAnalysisSectorItem>()
  const exchangeMap = new Map<string, number>()

  for (const position of positions) {
    const sectorBucket = sectorMap.get(position.sector) ?? {
      sector: position.sector,
      longValue: 0,
      shortValue: 0,
      grossValue: 0,
      netValue: 0,
      mtmPl: 0,
    }
    sectorBucket.longValue += position.longMarketValue
    sectorBucket.shortValue += position.shortMarketValue
    sectorBucket.grossValue += position.grossMarketValue
    sectorBucket.netValue += position.netMarketValue
    sectorBucket.mtmPl += position.mtmPl
    sectorMap.set(position.sector, sectorBucket)

    const exchangeGross = exchangeMap.get(position.exchange) ?? 0
    exchangeMap.set(position.exchange, exchangeGross + position.grossMarketValue)
  }

  const sectorItems = [...sectorMap.values()].sort((a, b) => b.grossValue - a.grossValue)
  const exchangeItems = [...exchangeMap.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)

  const holdings = positions.slice(0, 12).map((position) => ({
    label: position.symbol || position.productName,
    value: position.grossMarketValue,
    netValue: position.netMarketValue,
    mtmPl: position.mtmPl,
  }))

  const directions = [
    { label: "多头敞口", value: longMarketValue },
    { label: "空头敞口", value: shortMarketValue },
  ].filter((item) => item.value > 0)

  const topPositionShare = grossExposure > 0 && positions[0]
    ? positions[0].grossMarketValue / grossExposure
    : 0
  const topSectorShare = grossExposure > 0 && sectorItems[0]
    ? sectorItems[0].grossValue / grossExposure
    : 0
  const hedgedSectorCount = sectorItems.filter((item) => {
    if (item.longValue <= 0 || item.shortValue <= 0) return false
    const larger = Math.max(item.longValue, item.shortValue)
    const smaller = Math.min(item.longValue, item.shortValue)
    return larger > 0 && smaller / larger >= 0.2
  }).length
  const commodityShare = grossExposure > 0
    ? sectorItems
        .filter((item) => ["农产", "贵金属", "有色", "新能源", "黑色", "能源化工", "航运"].includes(item.sector))
        .reduce((sum, item) => sum + item.grossValue, 0) / grossExposure
    : 0
  const equityIndexShare = grossExposure > 0
    ? sectorItems.filter((item) => item.sector === "股指").reduce((sum, item) => sum + item.grossValue, 0) / grossExposure
    : 0
  const treasuryShare = grossExposure > 0
    ? sectorItems.filter((item) => item.sector === "国债").reduce((sum, item) => sum + item.grossValue, 0) / grossExposure
    : 0
  const optionShare = grossExposure > 0
    ? sectorItems.filter((item) => item.sector === "期权").reduce((sum, item) => sum + item.grossValue, 0) / grossExposure
    : 0

  if (positions.length === 0) {
    warnings.push("持仓汇总区域已识别，但当前结算单未提取到有效持仓。")
  }
  if (riskDegreeRatio == null) {
    warnings.push("风险度字段未识别，风控提示主要依据敞口和权益比。")
  }

  return {
    sourceFileName,
    summary: {
      clientId: summary.client_id,
      clientName: summary.client_name,
      tradeDate: summary.trade_date,
      dateRangeRaw: summary.date_range_raw,
      clientEquity: summary.client_equity,
      balanceCf: summary.balance_cf,
      marginOccupied: summary.margin_occupied,
      fundAvailable: summary.fund_avail,
      riskDegreeRatio,
      realizedPl: summary.realized_pl,
      mtmPl: summary.mtm_pl,
      longMarketValue,
      shortMarketValue,
      grossExposure,
      netExposure,
      grossLeverage,
      netExposureRatio,
      positionCount: positions.length,
      detailRowCount: positionDetailRows?.length ?? 0,
      sectorCount: sectorItems.length,
      topPositionName: positions[0]?.symbol ?? null,
      topPositionShare: positions[0] && grossExposure > 0 ? topPositionShare : null,
      topSectorName: sectorItems[0]?.sector ?? null,
      topSectorShare: sectorItems[0] && grossExposure > 0 ? topSectorShare : null,
    },
    charts: {
      holdings,
      sectors: sectorItems,
      directions,
      exchanges: exchangeItems,
    },
    positions,
    strategyInference: inferSettlementStrategy({
      grossExposure,
      netExposure,
      longExposure: longMarketValue,
      shortExposure: shortMarketValue,
      grossLeverage,
      riskDegreeRatio,
      fundAvailable: summary.fund_avail,
      clientEquity: summary.client_equity,
      topPositionShare,
      topSectorShare,
      topSectorName: sectorItems[0]?.sector ?? null,
      hedgedSectorCount,
      commodityShare,
      equityIndexShare,
      treasuryShare,
      optionShare,
    }),
    warnings,
  }
}
