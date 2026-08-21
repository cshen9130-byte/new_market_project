/**
 * cfmmc-etl.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Parses 中国期货市场监控中心「客户交易结算日报」.xls files and upserts into
 * three dedicated tables that are COMPLETELY SEPARATE from any MOM tables:
 *
 *   cfmmc_daily_summary  – per-account, per-day headline figures
 *   cfmmc_product_pnl    – per-day product (品种) P&L breakdown
 *   cfmmc_positions      – per-day open position detail (持仓明细)
 *
 * These tables live in the PUBLIC schema (not account_risk / mom schemas).
 */

import fs from "fs"
import path from "path"
import * as XLSX from "xlsx"
import { publicQuery, ensureAccountRiskSchema } from "@/lib/db"
import { accountRiskImportDir } from "@/lib/server/account-risk-import"

// ─── Types ────────────────────────────────────────────────────────────────────

export type CfmmcDailySummary = {
  accountNo:      string
  tradeDate:      string   // YYYY-MM-DD
  sourceFile:     string
  clientName:     string
  companyName:    string
  balanceBf:      number | null  // 期初结存
  clientEquity:   number | null  // 客户权益
  depositWd:      number | null  // 期初存取合计
  availableActual: number | null // 实际可用资金
  realizedPl:     number | null  // 平仓盈亏
  mtmPl:          number | null  // 持仓盈亏合计
  commission:     number | null  // 交易手续费
  balanceCf:      number | null  // 期末结存
  marginOccupied: number | null  // 保证金占用
  dailyPnl:       number | null  // 当日盈亏
  available:      number | null  // 可用资金
  riskRatio:      number | null  // 胜率/风险度 (stored as fraction, e.g. 0.009)
  marginCall:     number | null  // 追加保证金
}

export type CfmmcProductPnl = {
  accountNo:   string
  tradeDate:   string
  sourceFile:  string
  rowNum:      number
  productCode: string   // 品种
  volume:      number | null  // 成交量
  turnover:    number | null  // 成交额
  commission:  number | null  // 手续费
  realizedPl:  number | null  // 平仓盈亏
}

export type CfmmcPosition = {
  accountNo:   string
  tradeDate:   string
  sourceFile:  string
  rowNum:      number
  instrument:  string          // 合约 (e.g. BZ2610)
  tradeNo:     string | null   // 成交单号
  bs:          string | null   // 买/卖
  openPrice:   number | null   // 开仓价
  lots:        number | null   // 持仓量
  latestPrice: number | null   // 最新价
  settlPrice:  number | null   // 结算价
  floatingPl:  number | null   // 浮动盈亏 (持仓盈亏)
  sh:          string | null   // 投机/套保/套利
}

export type CfmmcETLResult = {
  processed:      number
  inserted:       number
  updated:        number
  skipped:        number
  errors:         string[]
  syncedDaily?:   number
  syncedPositions?: number
}

// ─── Table DDL ────────────────────────────────────────────────────────────────

const DDL = `
  CREATE TABLE IF NOT EXISTS public.cfmmc_daily_summary (
    id               SERIAL PRIMARY KEY,
    account_no       TEXT        NOT NULL,
    trade_date       DATE        NOT NULL,
    source_file      TEXT        NOT NULL,
    client_name      TEXT,
    company_name     TEXT,
    balance_bf       NUMERIC,
    client_equity    NUMERIC,
    deposit_wd       NUMERIC,
    available_actual NUMERIC,
    realized_pl      NUMERIC,
    mtm_pl           NUMERIC,
    commission       NUMERIC,
    balance_cf       NUMERIC,
    margin_occupied  NUMERIC,
    daily_pnl        NUMERIC,
    available        NUMERIC,
    risk_ratio       NUMERIC,
    margin_call      NUMERIC,
    updated_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (account_no, trade_date)
  );

  CREATE TABLE IF NOT EXISTS public.cfmmc_product_pnl (
    id           SERIAL PRIMARY KEY,
    account_no   TEXT        NOT NULL,
    trade_date   DATE        NOT NULL,
    source_file  TEXT        NOT NULL,
    row_num      INTEGER     NOT NULL,
    product_code TEXT,
    volume       NUMERIC,
    turnover     NUMERIC,
    commission   NUMERIC,
    realized_pl  NUMERIC,
    updated_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (account_no, trade_date, row_num)
  );

  CREATE TABLE IF NOT EXISTS public.cfmmc_positions (
    id            SERIAL PRIMARY KEY,
    account_no    TEXT        NOT NULL,
    trade_date    DATE        NOT NULL,
    source_file   TEXT        NOT NULL,
    row_num       INTEGER     NOT NULL,
    instrument    TEXT,
    trade_no      TEXT,
    bs            TEXT,
    open_price    NUMERIC,
    lots          NUMERIC,
    latest_price  NUMERIC,
    settl_price   NUMERIC,
    floating_pl   NUMERIC,
    sh            TEXT,
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (account_no, trade_date, row_num)
  );
`

let tablesReady = false

/** Drop wrongly-placed cfmmc tables from account_risk schema (one-time migration). */
async function migrateCfmmcToPublic(): Promise<void> {
  try {
    await publicQuery(`
      DO $$
      BEGIN
        DROP TABLE IF EXISTS account_risk.cfmmc_positions;
        DROP TABLE IF EXISTS account_risk.cfmmc_product_pnl;
        DROP TABLE IF EXISTS account_risk.cfmmc_daily_summary;
      END $$
    `)
  } catch { /* ignore */ }
}

async function ensureTables(): Promise<void> {
  if (tablesReady) return
  await migrateCfmmcToPublic()
  await publicQuery(DDL)
  tablesReady = true
}

// ─── Cell helpers ─────────────────────────────────────────────────────────────

function cellStr(ws: XLSX.WorkSheet, r: number, c: number): string {
  const cell = ws[XLSX.utils.encode_cell({ r, c })]
  if (!cell) return ""
  return String(cell.v ?? "").trim()
}

function cellNum(ws: XLSX.WorkSheet, r: number, c: number): number | null {
  const cell = ws[XLSX.utils.encode_cell({ r, c })]
  if (!cell) return null
  const v = cell.v
  if (typeof v === "number") return v
  const n = parseFloat(String(v ?? "").replace(/,/g, "").replace(/%$/, ""))
  return isFinite(n) ? n : null
}

/** Parse "0.90%" or 0.009 → fraction (0–1) */
function parsePct(ws: XLSX.WorkSheet, r: number, c: number): number | null {
  const cell = ws[XLSX.utils.encode_cell({ r, c })]
  if (!cell) return null
  const v = cell.v
  if (typeof v === "number") {
    // XLSX sometimes stores % as decimal already; >1 means raw percent string was parsed
    return v > 1 ? v / 100 : v
  }
  const s = String(v ?? "").trim().replace(/%$/, "")
  const n = parseFloat(s)
  if (!isFinite(n)) return null
  // if string was "0.90" (percent) → /100
  return n > 1 ? n / 100 : n
}

/** Search rows [startRow, endRow) col c for label text; return row index or -1 */
function findLabelRow(
  ws: XLSX.WorkSheet,
  labelSubstr: string,
  startRow: number,
  endRow: number,
  col = 0,
): number {
  for (let r = startRow; r < endRow; r++) {
    if (cellStr(ws, r, col).includes(labelSubstr)) return r
  }
  return -1
}

// ─── Sheet 1 Parser: 客户交易结算日报 ─────────────────────────────────────────

function parseSummarySheet(ws: XLSX.WorkSheet, sourceFile: string): CfmmcDailySummary | null {
  // Gate: first sheet must contain "结算日报" or "客户交易" somewhere in early rows
  const range = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null
  if (!range) return null
  const maxRow = Math.min(range.e.r, 80)

  // Find the account info row: look for a row whose col-0 contains "账户" or "资金账户"
  const acctRow = findLabelRow(ws, "资金账户", 2, 10) !== -1
    ? findLabelRow(ws, "资金账户", 2, 10)
    : findLabelRow(ws, "账户", 2, 10)
  if (acctRow === -1) return null

  const accountNo = cellStr(ws, acctRow, 2)
  if (!accountNo) return null

  // Date is at same row, col 5 label + col 7 value
  let tradeDate = cellStr(ws, acctRow, 7)
  if (!tradeDate) {
    // try numeric date cell
    const cell = ws[XLSX.utils.encode_cell({ r: acctRow, c: 7 })]
    if (cell && typeof cell.v === "number") {
      const d = XLSX.SSF.parse_date_code(cell.v)
      if (d) tradeDate = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`
    }
  }
  // normalise "2026-08-20" formats
  tradeDate = tradeDate.replace(/\//g, "-").split(" ")[0]
  if (!tradeDate || tradeDate.length < 8) return null

  const clientName  = cellStr(ws, acctRow + 1, 2)
  const companyName = cellStr(ws, acctRow + 2, 2)

  // Find the summary rows by searching for known labels in col 0
  const labelValueMap: Record<string, number | null> = {}
  for (let r = acctRow + 3; r <= maxRow; r++) {
    const left  = cellStr(ws, r, 0)
    const right = cellStr(ws, r, 5)
    if (left)  labelValueMap[left]  = cellNum(ws, r, 2)
    if (right) labelValueMap[right] = cellNum(ws, r, 7)
  }

  // 胜率/风险度 may be stored as percent string at (acctRow+12, 7) or similar
  let riskRatio: number | null = null
  for (let r = acctRow + 3; r <= maxRow; r++) {
    const right = cellStr(ws, r, 5)
    if (right.includes("胜率") || right.includes("风险度")) {
      riskRatio = parsePct(ws, r, 7)
      break
    }
  }

  return {
    accountNo,
    tradeDate,
    sourceFile,
    clientName,
    companyName,
    balanceBf:       labelValueMap["期初结存"]      ?? null,
    clientEquity:    labelValueMap["客户权益"]      ?? null,
    depositWd:       labelValueMap["期初存取合计"]  ?? null,
    availableActual: labelValueMap["实际可用资金"]  ?? null,
    realizedPl:      labelValueMap["平仓盈亏"]      ?? null,
    mtmPl:           labelValueMap["持仓盈亏合计"]  ?? null,
    commission:      labelValueMap["交易手续费"]    ?? null,
    balanceCf:       labelValueMap["期末结存"]      ?? null,
    marginOccupied:  labelValueMap["保证金占用"]    ?? null,
    dailyPnl:        labelValueMap["当日盈亏"]      ?? null,
    // 可用资金 appears twice; take the larger non-zero one
    available: (() => {
      const vals: number[] = []
      for (let r = acctRow + 3; r <= maxRow; r++) {
        if (cellStr(ws, r, 5).includes("可用资金")) {
          const v = cellNum(ws, r, 7)
          if (v !== null) vals.push(v)
        }
      }
      return vals.length > 0 ? Math.max(...vals) : null
    })(),
    riskRatio,
    marginCall: labelValueMap["追加保证金"] ?? null,
  }
}

// ─── Sheet 2 Parser: 品种汇总 ─────────────────────────────────────────────────

function parseProductSheet(
  ws: XLSX.WorkSheet,
  accountNo: string,
  tradeDate: string,
  sourceFile: string,
): CfmmcProductPnl[] {
  const range = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null
  if (!range) return []

  // Find header row containing "品种" and "平仓盈亏"
  let headerRow = -1
  for (let r = range.s.r; r <= Math.min(range.e.r, 20); r++) {
    const row0 = cellStr(ws, r, 0)
    if (row0.includes("品种") || row0 === "品种") { headerRow = r; break }
  }
  if (headerRow === -1) return []

  // Map column indices from header row
  // Expected: 品种(0), 成交量(1), 成交额(2), [skip](3), 手续费(4), 平仓盈亏(5)
  const results: CfmmcProductPnl[] = []
  let rowNum = 0
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const code = cellStr(ws, r, 0)
    if (!code || code.includes("合计") || code.includes("小计")) break
    const volume    = cellNum(ws, r, 1)
    const turnover  = cellNum(ws, r, 2)
    // col 3 may be empty spacer; hand‑fee is col 4, realized_pl is col 5
    const commission = cellNum(ws, r, 4)
    const realizedPl = cellNum(ws, r, 5)
    results.push({ accountNo, tradeDate, sourceFile, rowNum, productCode: code, volume, turnover, commission, realizedPl })
    rowNum++
  }
  return results
}

// ─── Sheet 5 Parser: 持仓明细 ─────────────────────────────────────────────────

function parsePositionSheet(
  ws: XLSX.WorkSheet,
  accountNo: string,
  tradeDate: string,
  sourceFile: string,
): CfmmcPosition[] {
  const range = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null
  if (!range) return []

  // Find header row containing "合约"
  let headerRow = -1
  for (let r = range.s.r; r <= Math.min(range.e.r, 20); r++) {
    if (cellStr(ws, r, 0).includes("合约")) { headerRow = r; break }
  }
  if (headerRow === -1) return []

  // CFMMC 持仓明细 columns (0-indexed):
  // 0:合约, 1:成交单号, 2:开仓(long qty), 3:开仓价(or blank), 4:持仓(short qty or total),
  // 5:最新价, 6:结算价, 7:浮动盈亏(or settl price), 8:持仓盈亏(floating pl), 9:投机类型, 10:保证金, 11:成交日期
  // The layout differs between long and short rows:
  // Long (买): col2 has lots, col3 has open_price, col4 blank
  // Short (卖): col2 blank, col3 blank, col4 has lots
  // We infer direction from which column has the lot count.

  const results: CfmmcPosition[] = []
  let rowNum = 0
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const instr = cellStr(ws, r, 0)
    if (!instr || instr.includes("合计") || instr.includes("小计")) continue

    const col2 = cellNum(ws, r, 2)
    const col4 = cellNum(ws, r, 4)

    let bs: string | null = null
    let lots: number | null = null
    let openPrice: number | null = null

    if (col2 !== null && col2 > 0) {
      bs = "买"
      lots = col2
      openPrice = cellNum(ws, r, 3)
    } else if (col4 !== null && col4 > 0) {
      bs = "卖"
      lots = col4
      // short open price appears in a different position; skip for now
    }

    results.push({
      accountNo,
      tradeDate,
      sourceFile,
      rowNum,
      instrument:  instr,
      tradeNo:     cellStr(ws, r, 1) || null,
      bs,
      openPrice,
      lots,
      latestPrice: cellNum(ws, r, 5),
      settlPrice:  cellNum(ws, r, 6),
      floatingPl:  cellNum(ws, r, 8),  // 持仓盈亏
      sh:          cellStr(ws, r, 9) || null,
    })
    rowNum++
  }
  return results
}

// ─── Upsert helpers ───────────────────────────────────────────────────────────

const SUMMARY_UPSERT = `
  INSERT INTO public.cfmmc_daily_summary
    (account_no, trade_date, source_file, client_name, company_name,
     balance_bf, client_equity, deposit_wd, available_actual,
     realized_pl, mtm_pl, commission, balance_cf, margin_occupied,
     daily_pnl, available, risk_ratio, margin_call, updated_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
  ON CONFLICT (account_no, trade_date) DO UPDATE SET
    source_file      = EXCLUDED.source_file,
    client_name      = EXCLUDED.client_name,
    company_name     = EXCLUDED.company_name,
    balance_bf       = EXCLUDED.balance_bf,
    client_equity    = EXCLUDED.client_equity,
    deposit_wd       = EXCLUDED.deposit_wd,
    available_actual = EXCLUDED.available_actual,
    realized_pl      = EXCLUDED.realized_pl,
    mtm_pl           = EXCLUDED.mtm_pl,
    commission       = EXCLUDED.commission,
    balance_cf       = EXCLUDED.balance_cf,
    margin_occupied  = EXCLUDED.margin_occupied,
    daily_pnl        = EXCLUDED.daily_pnl,
    available        = EXCLUDED.available,
    risk_ratio       = EXCLUDED.risk_ratio,
    margin_call      = EXCLUDED.margin_call,
    updated_at       = NOW()
  RETURNING (xmax = 0) AS is_insert
`

const PRODUCT_UPSERT = `
  INSERT INTO public.cfmmc_product_pnl
    (account_no, trade_date, source_file, row_num, product_code,
     volume, turnover, commission, realized_pl, updated_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
  ON CONFLICT (account_no, trade_date, row_num) DO UPDATE SET
    source_file  = EXCLUDED.source_file,
    product_code = EXCLUDED.product_code,
    volume       = EXCLUDED.volume,
    turnover     = EXCLUDED.turnover,
    commission   = EXCLUDED.commission,
    realized_pl  = EXCLUDED.realized_pl,
    updated_at   = NOW()
  RETURNING (xmax = 0) AS is_insert
`

const POSITION_UPSERT = `
  INSERT INTO public.cfmmc_positions
    (account_no, trade_date, source_file, row_num,
     instrument, trade_no, bs, open_price, lots,
     latest_price, settl_price, floating_pl, sh, updated_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
  ON CONFLICT (account_no, trade_date, row_num) DO UPDATE SET
    source_file  = EXCLUDED.source_file,
    instrument   = EXCLUDED.instrument,
    trade_no     = EXCLUDED.trade_no,
    bs           = EXCLUDED.bs,
    open_price   = EXCLUDED.open_price,
    lots         = EXCLUDED.lots,
    latest_price = EXCLUDED.latest_price,
    settl_price  = EXCLUDED.settl_price,
    floating_pl  = EXCLUDED.floating_pl,
    sh           = EXCLUDED.sh,
    updated_at   = NOW()
  RETURNING (xmax = 0) AS is_insert
`

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runCfmmcETL(mode: "full" | "incremental" = "incremental"): Promise<CfmmcETLResult> {
  await ensureTables()

  const dir = accountRiskImportDir()
  const allFiles = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => /\.(xls|xlsx|xlsm)$/i.test(f)).sort()
    : []

  const result: CfmmcETLResult = { processed: 0, inserted: 0, updated: 0, skipped: 0, errors: [] }
  if (allFiles.length === 0) return result

  let processedFiles = new Set<string>()
  if (mode === "incremental") {
    const res = await publicQuery("SELECT DISTINCT source_file FROM public.cfmmc_daily_summary")
    processedFiles = new Set((res.rows as { source_file: string }[]).map(r => r.source_file))
  }

  for (const fileName of allFiles) {
    if (mode === "incremental" && processedFiles.has(fileName)) {
      result.skipped++
      continue
    }

    try {
      const buf = fs.readFileSync(path.join(dir, fileName))
      const wb  = XLSX.read(buf, { type: "buffer", cellDates: false })

      // Sheet 0: summary
      const ws0 = wb.Sheets[wb.SheetNames[0]]
      if (!ws0) {
        result.errors.push(`${fileName}: 无法读取第一工作表`)
        continue
      }
      const summary = parseSummarySheet(ws0, fileName)
      if (!summary) {
        result.errors.push(`${fileName}: 未识别为监控中心结算日报格式`)
        continue
      }

      // Upsert summary
      const sumRes = await publicQuery(SUMMARY_UPSERT, [
        summary.accountNo, summary.tradeDate, summary.sourceFile,
        summary.clientName, summary.companyName,
        summary.balanceBf, summary.clientEquity, summary.depositWd,
        summary.availableActual, summary.realizedPl, summary.mtmPl,
        summary.commission, summary.balanceCf, summary.marginOccupied,
        summary.dailyPnl, summary.available, summary.riskRatio, summary.marginCall,
      ])
      if (sumRes.rows[0]?.is_insert) result.inserted++
      else result.updated++

      // Sheet 1: 品种汇总
      if (wb.SheetNames.length > 1) {
        const ws1 = wb.Sheets[wb.SheetNames[1]]
        if (ws1) {
          const products = parseProductSheet(ws1, summary.accountNo, summary.tradeDate, fileName)
          for (const p of products) {
            await publicQuery(PRODUCT_UPSERT, [
              p.accountNo, p.tradeDate, p.sourceFile, p.rowNum, p.productCode,
              p.volume, p.turnover, p.commission, p.realizedPl,
            ])
          }
        }
      }

      // Sheet 4: 持仓明细 (index 4 = the 5th sheet)
      const posSheetIdx = wb.SheetNames.findIndex(n =>
        n.includes("持仓明细") || n.includes("仓位明细")
      )
      const posSheet = posSheetIdx >= 0
        ? wb.Sheets[wb.SheetNames[posSheetIdx]]
        : (wb.SheetNames.length > 4 ? wb.Sheets[wb.SheetNames[4]] : undefined)

      if (posSheet) {
        const positions = parsePositionSheet(posSheet, summary.accountNo, summary.tradeDate, fileName)
        for (const p of positions) {
          await publicQuery(POSITION_UPSERT, [
            p.accountNo, p.tradeDate, p.sourceFile, p.rowNum,
            p.instrument, p.tradeNo, p.bs, p.openPrice, p.lots,
            p.latestPrice, p.settlPrice, p.floatingPl, p.sh,
          ])
        }
      }

      result.processed++
    } catch (e) {
      result.errors.push(`${fileName}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Sync parsed CFMMC data into the account_risk schema so RiskReportApp charts work
  if (result.processed > 0 || mode === "full") {
    try {
      const sync = await syncCfmmcToAccountRisk()
      result.syncedDaily     = sync.daily
      result.syncedPositions = sync.positions
    } catch (e) {
      result.errors.push(`sync: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return result
}

// ─── Chart data queries ───────────────────────────────────────────────────────

export type DailySummaryRow = {
  account_no:      string
  trade_date:      string
  client_equity:   number | null
  daily_pnl:       number | null
  margin_occupied: number | null
  risk_ratio:      number | null
  realized_pl:     number | null
  commission:      number | null
}

export async function queryDailySummary(from?: string, to?: string): Promise<DailySummaryRow[]> {
  const conds: string[] = []
  const params: unknown[] = []
  if (from) { params.push(from); conds.push(`trade_date >= $${params.length}::date`) }
  if (to)   { params.push(to);   conds.push(`trade_date <= $${params.length}::date`) }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : ""
  const res = await publicQuery(
    `SELECT account_no, trade_date::text AS trade_date,
            client_equity, daily_pnl, margin_occupied, risk_ratio, realized_pl, commission
     FROM public.cfmmc_daily_summary
     ${where}
     ORDER BY trade_date ASC, account_no ASC`,
    params.length ? params : undefined,
  )
  return res.rows as DailySummaryRow[]
}

export type ProductPnlRow = {
  trade_date:   string
  account_no:   string
  product_code: string
  volume:       number | null
  commission:   number | null
  realized_pl:  number | null
}

export async function queryProductPnl(tradeDate?: string): Promise<ProductPnlRow[]> {
  const params: unknown[] = []
  const where = tradeDate ? (params.push(tradeDate), "WHERE trade_date = $1::date") : ""
  const res = await publicQuery(
    `SELECT trade_date::text AS trade_date, account_no, product_code, volume, commission, realized_pl
     FROM public.cfmmc_product_pnl
     ${where}
     ORDER BY trade_date DESC, ABS(COALESCE(realized_pl,0)) DESC`,
    params.length ? params : undefined,
  )
  return res.rows as ProductPnlRow[]
}

export type PositionRow = {
  trade_date:   string
  account_no:   string
  instrument:   string
  bs:           string | null
  lots:         number | null
  latest_price: number | null
  settl_price:  number | null
  floating_pl:  number | null
  sh:           string | null
}

export async function queryLatestPositions(): Promise<PositionRow[]> {
  const res = await publicQuery(`
    SELECT p.trade_date::text AS trade_date, p.account_no, p.instrument,
           p.bs, p.lots, p.latest_price, p.settl_price, p.floating_pl, p.sh
    FROM public.cfmmc_positions p
    INNER JOIN (
      SELECT account_no, MAX(trade_date) AS max_date
      FROM public.cfmmc_daily_summary
      GROUP BY account_no
    ) latest ON latest.account_no = p.account_no AND p.trade_date = latest.max_date
    WHERE p.lots IS NOT NULL AND p.lots > 0
    ORDER BY ABS(COALESCE(p.floating_pl, 0)) DESC
  `)
  return res.rows as PositionRow[]
}

// ─── Sync CFMMC data → account_risk schema (mirrors MOM table layout) ─────────

/**
 * After the CFMMC ETL populates cfmmc_* tables, this function copies the data
 * into account_risk.mom_daily_reports and account_risk.mom_futures_position_details
 * using the same column layout as the MOM tables.  This allows the existing
 * RiskReportApp (variant="account") + search_path mechanism to render charts
 * from CFMMC data without touching any public.mom_* tables.
 */
export async function syncCfmmcToAccountRisk(): Promise<{ daily: number; positions: number }> {
  await ensureAccountRiskSchema()

  // ── Daily summary → account_risk.mom_daily_reports ────────────────────────
  const dailyRes = await publicQuery(`
    INSERT INTO account_risk.mom_daily_reports
      ("账户", "交易日期",
       "上日结存", "客户权益", "当日存取合计", "实有货币资金",
       "当日盈亏", "非货币充抖金额", "当日总权利金", "货币充抖金额",
       "当日手续费", "冻结资金", "当日结存", "保证金占用", "可用资金",
       "风险度", "追加保证金", "市値权益", "多头期权市値", "空头期权市値",
       "权利金收入", "权利金支出", "行权手续费", "行权盈亏", "申报费",
       "平仓盈亏", "持仓盈亏", source_file_rel)
    SELECT
      account_no,
      trade_date,
      COALESCE(balance_bf::text,       '0'),
      COALESCE(client_equity::text,    '0'),
      COALESCE(deposit_wd::text,       '0'),
      COALESCE(available_actual::text, '0'),
      COALESCE(daily_pnl::text,        '0'),
      '0', '0', '0',
      COALESCE(commission::text,       '0'),
      '0',
      COALESCE(balance_cf::text,       '0'),
      COALESCE(margin_occupied::text,  '0'),
      COALESCE(available::text,        '0'),
      CASE
        WHEN risk_ratio IS NOT NULL
        THEN round(risk_ratio * 100, 4)::text || '%'
        ELSE '0.00%'
      END,
      COALESCE(margin_call::text, '0'),
      '0', '0', '0', '0', '0',
      NULL, NULL, NULL,
      COALESCE(realized_pl::text, '0'),
      COALESCE(mtm_pl::text,      '0'),
      source_file
    FROM public.cfmmc_daily_summary
    ON CONFLICT (source_file_rel) DO UPDATE SET
      "账户"          = EXCLUDED."账户",
      "交易日期"      = EXCLUDED."交易日期",
      "上日结存"      = EXCLUDED."上日结存",
      "客户权益"      = EXCLUDED."客户权益",
      "当日存取合计"  = EXCLUDED."当日存取合计",
      "实有货币资金"  = EXCLUDED."实有货币资金",
      "当日盈亏"      = EXCLUDED."当日盈亏",
      "当日手续费"    = EXCLUDED."当日手续费",
      "当日结存"      = EXCLUDED."当日结存",
      "保证金占用"    = EXCLUDED."保证金占用",
      "可用资金"      = EXCLUDED."可用资金",
      "风险度"        = EXCLUDED."风险度",
      "追加保证金"    = EXCLUDED."追加保证金",
      "平仓盈亏"      = EXCLUDED."平仓盈亏",
      "持仓盈亏"      = EXCLUDED."持仓盈亏"
  `)
  const dailyCount = dailyRes.rowCount ?? 0

  // ── Positions → account_risk.mom_futures_position_details ─────────────────
  const posRes = await publicQuery(`
    INSERT INTO account_risk.mom_futures_position_details
      ("账户", "交易日期",
       "合约", "成交序号",
       "买持仓", "买入价",
       "卖持仓", "卖出价",
       "昨结算价", "今结算价",
       "持仓盈亏", "投机/套保",
       "交易编码", "实际成交日期",
       "期权市値", "多头期权市値", "空头期权市値",
       "持仓市値", "保证金", "交易所",
       source_file_rel, row_hash)
    SELECT
      account_no,
      trade_date,
      instrument,
      COALESCE(trade_no, ''),
      CASE WHEN bs = '买' THEN COALESCE(lots::text, '0') ELSE '0' END,
      CASE WHEN bs = '买' THEN COALESCE(open_price::text, '0') ELSE NULL END,
      CASE WHEN bs = '卖' THEN COALESCE(lots::text, '0') ELSE '0' END,
      NULL,
      NULL,
      COALESCE(settl_price::text, '0'),
      COALESCE(floating_pl::text, '0'),
      COALESCE(sh, '投机'),
      NULL,
      trade_date::text,
      NULL, NULL, NULL, NULL, NULL, NULL,
      source_file || ':' || row_num::text,
      md5(account_no || '_' || trade_date::text || '_' || row_num::text || '_' || source_file)
    FROM public.cfmmc_positions
    WHERE lots IS NOT NULL AND lots > 0
    ON CONFLICT (row_hash) DO UPDATE SET
      "账户"        = EXCLUDED."账户",
      "交易日期"    = EXCLUDED."交易日期",
      "合约"        = EXCLUDED."合约",
      "买持仓"      = EXCLUDED."买持仓",
      "买入价"      = EXCLUDED."买入价",
      "卖持仓"      = EXCLUDED."卖持仓",
      "今结算价"    = EXCLUDED."今结算价",
      "持仓盈亏"    = EXCLUDED."持仓盈亏",
      "投机/套保"   = EXCLUDED."投机/套保"
  `)
  const posCount = posRes.rowCount ?? 0

  return { daily: dailyCount, positions: posCount }
}
