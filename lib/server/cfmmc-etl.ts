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
import { bookSource, getImportBook, listImportBooks, listSpreadsheetRelPaths, sourceFilesForBook, type ImportBookSource } from "@/lib/server/account-risk-books"
import { getFuturesMultiplier } from "@/lib/server/futures-multipliers"
import { clearAccountSourceCache } from "@/lib/server/mom-cache"
import { appendJobLog } from "@/lib/server/account-risk-job-log"

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
  buyLots:     number | null
  buyPrice:    number | null
  sellLots:    number | null
  sellPrice:   number | null
  latestPrice: number | null   // 最新价
  prevSettle:  number | null   // 昨结算价
  settlPrice:  number | null   // 今结算价
  floatingPl:  number | null   // 浮动盈亏 (持仓盈亏)
  sh:          string | null   // 投机/套保/套利
  tradeCode:        string | null
  actualDate:       string | null
  notionalMv:       number | null
  allocatedMargin:  number | null
}

export type CfmmcTrade = {
  accountNo:   string
  tradeDate:   string
  sourceFile:  string
  rowNum:      number
  instrument:  string
  tradeNo:     string | null
  tradeTime:   string | null
  bs:          string | null
  sh:          string | null
  price:       number | null
  lots:        number | null
  turnover:    number | null
  oc:          string | null
  commission:  number | null
  realizedPl:  number | null
  actualDate:  string | null
}

export type CfmmcClose = {
  accountNo:   string
  tradeDate:   string
  sourceFile:  string
  rowNum:      number
  instrument:  string
  tradeNo:     string | null
  bs:          string | null
  price:       number | null
  openPrice:   number | null
  lots:        number | null
  prevSettle:  number | null
  realizedPl:  number | null
  origTradeNo: string | null
  actualDate:  string | null
}

export type CfmmcCashFlow = {
  accountNo:   string
  tradeDate:   string
  sourceFile:  string
  rowNum:      number
  occurDate:   string | null
  deposit:     number | null
  withdrawal:  number | null
  method:      string | null
  memo:        string | null
}

export type CfmmcOptionTrade = {
  accountNo:   string
  tradeDate:   string
  sourceFile:  string
  rowNum:      number
  instrument:  string
  tradeNo:     string | null
  tradeTime:   string | null
  bs:          string | null
  premiumPx:   number | null
  volume:      number | null
  premium:     number | null
  covered:     string | null
  commission:  number | null
  actualDate:  string | null
}

export type CfmmcSecurity = {
  accountNo:   string
  tradeDate:   string
  sourceFile:  string
  rowNum:      number
  code:        string
  name:        string | null
  changeType:  string | null
  bs:          string | null
  tradeNo:     string | null
  tradeTime:   string | null
  price:       number | null
  qty:         number | null
  amount:      number | null
  commission:  number | null
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

  CREATE TABLE IF NOT EXISTS public.cfmmc_trades (
    id            SERIAL PRIMARY KEY,
    account_no    TEXT        NOT NULL,
    trade_date    DATE        NOT NULL,
    source_file   TEXT        NOT NULL,
    row_num       INTEGER     NOT NULL,
    instrument    TEXT,
    trade_no      TEXT,
    trade_time    TEXT,
    bs            TEXT,
    sh            TEXT,
    price         NUMERIC,
    lots          NUMERIC,
    turnover      NUMERIC,
    oc            TEXT,
    commission    NUMERIC,
    realized_pl   NUMERIC,
    actual_date   TEXT,
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (account_no, trade_date, row_num)
  );

  CREATE TABLE IF NOT EXISTS public.cfmmc_closes (
    id            SERIAL PRIMARY KEY,
    account_no    TEXT        NOT NULL,
    trade_date    DATE        NOT NULL,
    source_file   TEXT        NOT NULL,
    row_num       INTEGER     NOT NULL,
    instrument    TEXT,
    trade_no      TEXT,
    bs            TEXT,
    price         NUMERIC,
    open_price    NUMERIC,
    lots          NUMERIC,
    prev_settle   NUMERIC,
    realized_pl   NUMERIC,
    orig_trade_no TEXT,
    actual_date   TEXT,
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (account_no, trade_date, row_num)
  );

  CREATE TABLE IF NOT EXISTS public.cfmmc_cash_flows (
    id            SERIAL PRIMARY KEY,
    account_no    TEXT        NOT NULL,
    trade_date    DATE        NOT NULL,
    source_file   TEXT        NOT NULL,
    row_num       INTEGER     NOT NULL,
    occur_date    TEXT,
    deposit       NUMERIC,
    withdrawal    NUMERIC,
    method        TEXT,
    memo          TEXT,
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (account_no, trade_date, row_num)
  );

  CREATE TABLE IF NOT EXISTS public.cfmmc_option_trades (
    id            SERIAL PRIMARY KEY,
    account_no    TEXT        NOT NULL,
    trade_date    DATE        NOT NULL,
    source_file   TEXT        NOT NULL,
    row_num       INTEGER     NOT NULL,
    instrument    TEXT,
    trade_no      TEXT,
    trade_time    TEXT,
    bs            TEXT,
    premium_px    NUMERIC,
    volume        NUMERIC,
    premium       NUMERIC,
    covered       TEXT,
    commission    NUMERIC,
    actual_date   TEXT,
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (account_no, trade_date, row_num)
  );

  CREATE TABLE IF NOT EXISTS public.cfmmc_securities (
    id            SERIAL PRIMARY KEY,
    account_no    TEXT        NOT NULL,
    trade_date    DATE        NOT NULL,
    source_file   TEXT        NOT NULL,
    row_num       INTEGER     NOT NULL,
    code          TEXT,
    name          TEXT,
    change_type   TEXT,
    bs            TEXT,
    trade_no      TEXT,
    trade_time    TEXT,
    price         NUMERIC,
    qty           NUMERIC,
    amount        NUMERIC,
    commission    NUMERIC,
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
  await publicQuery(`
    ALTER TABLE public.cfmmc_positions
      ADD COLUMN IF NOT EXISTS buy_lots          NUMERIC,
      ADD COLUMN IF NOT EXISTS buy_price         NUMERIC,
      ADD COLUMN IF NOT EXISTS sell_lots         NUMERIC,
      ADD COLUMN IF NOT EXISTS sell_price        NUMERIC,
      ADD COLUMN IF NOT EXISTS prev_settle       NUMERIC,
      ADD COLUMN IF NOT EXISTS trade_code        TEXT,
      ADD COLUMN IF NOT EXISTS actual_date       TEXT,
      ADD COLUMN IF NOT EXISTS notional_mv       NUMERIC,
      ADD COLUMN IF NOT EXISTS allocated_margin  NUMERIC
  `)
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
  const raw = String(v ?? "").trim()
  const hadPct = raw.includes("%")
  const n = parseFloat(raw.replace(/%/g, ""))
  if (!isFinite(n)) return null
  if (hadPct) return n / 100
  return n > 1 ? n / 100 : n
}

function lookupNum(map: Record<string, number | null>, ...aliases: string[]): number | null {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(map, alias) && map[alias] != null) return map[alias]
  }
  for (const alias of aliases) {
    for (const [k, v] of Object.entries(map)) {
      if (k.includes(alias) && v != null) return v
    }
  }
  return null
}

function headerColMap(ws: XLSX.WorkSheet, headerRow: number, maxCol: number): Map<string, number> {
  const map = new Map<string, number>()
  for (let c = 0; c <= maxCol; c++) {
    const name = cellStr(ws, headerRow, c).replace(/\s+/g, "")
    if (name) map.set(name, c)
  }
  return map
}

function colOf(map: Map<string, number>, ...names: string[]): number {
  for (const n of names) {
    const key = n.replace(/\s+/g, "")
    if (map.has(key)) return map.get(key)!
    for (const [k, c] of map) {
      if (k.includes(key) || key.includes(k)) return c
    }
  }
  return -1
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

  // Find the summary rows by searching for known labels in col 0 / col 5
  const labelValueMap: Record<string, number | null> = {}
  for (let r = acctRow + 3; r <= maxRow; r++) {
    const left  = cellStr(ws, r, 0)
    const right = cellStr(ws, r, 5)
    if (left)  labelValueMap[left]  = cellNum(ws, r, 2)
    if (right) labelValueMap[right] = cellNum(ws, r, 7)
  }

  // 胜率/风险度 may be stored as percent string
  let riskRatio: number | null = null
  for (let r = acctRow + 3; r <= maxRow; r++) {
    const right = cellStr(ws, r, 5)
    if (right.includes("胜率") || right.includes("风险度")) {
      riskRatio = parsePct(ws, r, 7)
      break
    }
  }

  const realizedPl = lookupNum(labelValueMap, "平仓盈亏")
  const mtmPl = lookupNum(labelValueMap, "持仓盈亏合计", "浮动盈亏", "持仓盈亏")
  const commission = lookupNum(labelValueMap, "当日手续费", "交易手续费")
  let dailyPnl = lookupNum(labelValueMap, "当日盈亏")
  if (dailyPnl == null && (realizedPl != null || mtmPl != null)) {
    dailyPnl = (realizedPl ?? 0) + (mtmPl ?? 0)
  }

  return {
    accountNo,
    tradeDate,
    sourceFile,
    clientName,
    companyName,
    balanceBf:       lookupNum(labelValueMap, "期初结存", "上日结存"),
    clientEquity:    lookupNum(labelValueMap, "客户权益"),
    depositWd:       lookupNum(labelValueMap, "期初存取合计", "当日存取合计"),
    availableActual: lookupNum(labelValueMap, "实际可用资金", "实有货币资金"),
    realizedPl,
    mtmPl,
    commission,
    balanceCf:       lookupNum(labelValueMap, "期末结存", "当日结存"),
    marginOccupied:  lookupNum(labelValueMap, "保证金占用"),
    dailyPnl,
    // 可用资金 appears twice; take the larger non-zero one
    available: (() => {
      const vals: number[] = []
      for (let r = acctRow + 3; r <= maxRow; r++) {
        if (cellStr(ws, r, 5).includes("可用资金")) {
          const v = cellNum(ws, r, 7)
          if (v !== null) vals.push(v)
        }
      }
      return vals.length > 0 ? Math.max(...vals) : lookupNum(labelValueMap, "可用资金")
    })(),
    riskRatio,
    marginCall: lookupNum(labelValueMap, "追加保证金"),
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

  // Header row is "品种" + a volume/amount column — not the section title "品种汇总"
  let headerRow = -1
  for (let r = range.s.r; r <= Math.min(range.e.r, 30); r++) {
    const row0 = cellStr(ws, r, 0).replace(/\s+/g, "")
    if (row0 === "品种") { headerRow = r; break }
    if (row0.includes("品种") && (cellStr(ws, r, 1).includes("手") || cellStr(ws, r, 2).includes("成交"))) {
      headerRow = r
      break
    }
  }
  if (headerRow === -1) return []

  const cols = headerColMap(ws, headerRow, range.e.c)
  const cCode = colOf(cols, "品种")
  const cVol  = colOf(cols, "手数", "成交量")
  const cTo   = colOf(cols, "成交额")
  const cFee  = colOf(cols, "手续费")
  const cPl   = colOf(cols, "平仓盈亏")
  if (cCode < 0) return []

  const results: CfmmcProductPnl[] = []
  let rowNum = 0
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const code = (cCode >= 0 ? cellStr(ws, r, cCode) : cellStr(ws, r, 0)).trim()
    if (!code || code.includes("合计") || code.includes("小计")) continue
    results.push({
      accountNo, tradeDate, sourceFile, rowNum, productCode: code,
      volume:     cVol >= 0 ? cellNum(ws, r, cVol) : null,
      turnover:   cTo  >= 0 ? cellNum(ws, r, cTo)  : null,
      commission: cFee >= 0 ? cellNum(ws, r, cFee) : null,
      realizedPl: cPl  >= 0 ? cellNum(ws, r, cPl)  : null,
    })
    rowNum++
  }
  return results
}

function parsePositionSheet(
  ws: XLSX.WorkSheet,
  accountNo: string,
  tradeDate: string,
  sourceFile: string,
): CfmmcPosition[] {
  const range = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null
  if (!range) return []

  let headerRow = -1
  for (let r = range.s.r; r <= Math.min(range.e.r, 30); r++) {
    if (cellStr(ws, r, 0).replace(/\s+/g, "") === "合约") { headerRow = r; break }
  }
  if (headerRow === -1) return []

  const cols = headerColMap(ws, headerRow, range.e.c)
  const cInstr = colOf(cols, "合约")
  const cNo    = colOf(cols, "成交序号", "成交单号")
  const cBuy   = colOf(cols, "买持仓")
  const cBuyPx = colOf(cols, "买入价")
  const cSell  = colOf(cols, "卖持仓")
  const cSellPx= colOf(cols, "卖出价")
  const cPrev  = colOf(cols, "昨结算价")
  const cSettl = colOf(cols, "今结算价", "结算价")
  const cLast  = colOf(cols, "最新价")
  const cPl    = colOf(cols, "浮动盈亏", "持仓盈亏")
  const cSh    = colOf(cols, "投机", "套保")
  const cCode  = colOf(cols, "交易编码")
  const cDate  = colOf(cols, "实际成交日期", "成交日期")

  const results: CfmmcPosition[] = []
  let rowNum = 0
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const instr = (cInstr >= 0 ? cellStr(ws, r, cInstr) : cellStr(ws, r, 0)).trim()
    if (!instr || instr.includes("合计") || instr.includes("小计")) continue

    const buyLots  = cBuy  >= 0 ? cellNum(ws, r, cBuy)  : null
    const sellLots = cSell >= 0 ? cellNum(ws, r, cSell) : null
    const buyPrice = cBuyPx >= 0 ? cellNum(ws, r, cBuyPx) : null
    const sellPrice= cSellPx>= 0 ? cellNum(ws, r, cSellPx): null

    let bs: string | null = null
    let lots: number | null = null
    let openPrice: number | null = null
    if (buyLots != null && buyLots > 0) {
      bs = "买"; lots = buyLots; openPrice = buyPrice
    } else if (sellLots != null && sellLots > 0) {
      bs = "卖"; lots = sellLots; openPrice = sellPrice
    }

    results.push({
      accountNo, tradeDate, sourceFile, rowNum,
      instrument:  instr,
      tradeNo:     cNo >= 0 ? (cellStr(ws, r, cNo) || null) : null,
      bs, openPrice, lots,
      buyLots, buyPrice, sellLots, sellPrice,
      latestPrice: cLast >= 0 ? cellNum(ws, r, cLast) : null,
      prevSettle:  cPrev >= 0 ? cellNum(ws, r, cPrev) : null,
      settlPrice:  cSettl >= 0 ? cellNum(ws, r, cSettl) : null,
      floatingPl:  cPl >= 0 ? cellNum(ws, r, cPl) : null,
      sh:          cSh >= 0 ? (cellStr(ws, r, cSh) || null) : null,
      tradeCode:   cCode >= 0 ? (cellStr(ws, r, cCode) || null) : null,
      actualDate:  cDate >= 0 ? (cellStr(ws, r, cDate) || null) : null,
      notionalMv:      null,
      allocatedMargin: null,
    })
    rowNum++
  }
  return results
}

function parseTradeSheet(
  ws: XLSX.WorkSheet,
  accountNo: string,
  tradeDate: string,
  sourceFile: string,
): CfmmcTrade[] {
  const range = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null
  if (!range) return []

  let headerRow = -1
  for (let r = range.s.r; r <= Math.min(range.e.r, 30); r++) {
    const a = cellStr(ws, r, 0).replace(/\s+/g, "")
    if (a === "合约" && cellStr(ws, r, 3).includes("买")) { headerRow = r; break }
    if (a === "合约") { headerRow = r; break }
  }
  if (headerRow === -1) return []

  const cols = headerColMap(ws, headerRow, range.e.c)
  const cInstr = colOf(cols, "合约")
  const cNo    = colOf(cols, "成交序号", "成交编号")
  const cTime  = colOf(cols, "成交时间")
  const cBs    = colOf(cols, "买/卖")
  const cSh    = colOf(cols, "投机")
  const cPx    = colOf(cols, "成交价")
  const cLots  = colOf(cols, "手数")
  const cTo    = colOf(cols, "成交额")
  const cOc    = colOf(cols, "开/平")
  const cFee   = colOf(cols, "手续费")
  const cPl    = colOf(cols, "平仓盈亏")
  const cDate  = colOf(cols, "实际成交日期", "成交日期")
  if (cInstr < 0) return []

  const results: CfmmcTrade[] = []
  let rowNum = 0
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const instr = cellStr(ws, r, cInstr).trim()
    if (!instr || instr.includes("合计") || instr.includes("小计")) continue
    results.push({
      accountNo, tradeDate, sourceFile, rowNum, instrument: instr,
      tradeNo:    cNo   >= 0 ? (cellStr(ws, r, cNo) || null) : null,
      tradeTime:  cTime >= 0 ? (cellStr(ws, r, cTime) || null) : null,
      bs:         cBs   >= 0 ? (cellStr(ws, r, cBs) || null) : null,
      sh:         cSh   >= 0 ? (cellStr(ws, r, cSh) || null) : null,
      price:      cPx   >= 0 ? cellNum(ws, r, cPx) : null,
      lots:       cLots >= 0 ? cellNum(ws, r, cLots) : null,
      turnover:   cTo   >= 0 ? cellNum(ws, r, cTo) : null,
      oc:         cOc   >= 0 ? (cellStr(ws, r, cOc) || null) : null,
      commission: cFee  >= 0 ? cellNum(ws, r, cFee) : null,
      realizedPl: cPl   >= 0 ? cellNum(ws, r, cPl) : null,
      actualDate: cDate >= 0 ? (cellStr(ws, r, cDate) || null) : null,
    })
    rowNum++
  }
  return results
}

function parseCloseSheet(
  ws: XLSX.WorkSheet,
  accountNo: string,
  tradeDate: string,
  sourceFile: string,
): CfmmcClose[] {
  const range = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null
  if (!range) return []

  let headerRow = -1
  for (let r = range.s.r; r <= Math.min(range.e.r, 30); r++) {
    if (cellStr(ws, r, 0).replace(/\s+/g, "") === "合约" && cellStr(ws, r, 4).includes("开仓")) {
      headerRow = r
      break
    }
  }
  if (headerRow === -1) {
    for (let r = range.s.r; r <= Math.min(range.e.r, 30); r++) {
      if (cellStr(ws, r, 0).replace(/\s+/g, "") === "合约") { headerRow = r; break }
    }
  }
  if (headerRow === -1) return []

  const cols = headerColMap(ws, headerRow, range.e.c)
  const cInstr = colOf(cols, "合约")
  const cNo    = colOf(cols, "成交序号")
  const cBs    = colOf(cols, "买/卖")
  const cPx    = colOf(cols, "成交价")
  const cOpen  = colOf(cols, "开仓价")
  const cLots  = colOf(cols, "手数")
  const cPrev  = colOf(cols, "昨结算价")
  const cPl    = colOf(cols, "平仓盈亏")
  const cOrig  = colOf(cols, "原成交序号", "开仓成交编号")
  const cDate  = colOf(cols, "实际成交日期", "开仓日期")
  if (cInstr < 0) return []

  const results: CfmmcClose[] = []
  let rowNum = 0
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const instr = cellStr(ws, r, cInstr).trim()
    if (!instr || instr.includes("合计") || instr.includes("小计")) continue
    results.push({
      accountNo, tradeDate, sourceFile, rowNum, instrument: instr,
      tradeNo:     cNo   >= 0 ? (cellStr(ws, r, cNo) || null) : null,
      bs:          cBs   >= 0 ? (cellStr(ws, r, cBs) || null) : null,
      price:       cPx   >= 0 ? cellNum(ws, r, cPx) : null,
      openPrice:   cOpen >= 0 ? cellNum(ws, r, cOpen) : null,
      lots:        cLots >= 0 ? cellNum(ws, r, cLots) : null,
      prevSettle:  cPrev >= 0 ? cellNum(ws, r, cPrev) : null,
      realizedPl:  cPl   >= 0 ? cellNum(ws, r, cPl) : null,
      origTradeNo: cOrig >= 0 ? (cellStr(ws, r, cOrig) || null) : null,
      actualDate:  cDate >= 0 ? (cellStr(ws, r, cDate) || null) : null,
    })
    rowNum++
  }
  return results
}

function parseCashFlows(
  ws: XLSX.WorkSheet,
  accountNo: string,
  tradeDate: string,
  sourceFile: string,
): CfmmcCashFlow[] {
  const range = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null
  if (!range) return []

  let headerRow = -1
  for (let r = range.s.r; r <= range.e.r; r++) {
    if (cellStr(ws, r, 0).includes("出入金明细")) {
      headerRow = r + 1
      break
    }
  }
  if (headerRow === -1) return []

  const cols = headerColMap(ws, headerRow, range.e.c)
  const cDate = colOf(cols, "发生日期")
  const cIn   = colOf(cols, "入金")
  const cOut  = colOf(cols, "出金")
  const cMth  = colOf(cols, "方式")
  const cMemo = colOf(cols, "摘要")
  if (cDate < 0 && cIn < 0) return []

  const results: CfmmcCashFlow[] = []
  let rowNum = 0
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const occur = cDate >= 0 ? cellStr(ws, r, cDate) : cellStr(ws, r, 0)
    if (!occur || occur.includes("合计") || occur.includes("注：") || occur.includes("其它") || occur.includes("期货")) break
    results.push({
      accountNo, tradeDate, sourceFile, rowNum,
      occurDate:  occur || null,
      deposit:    cIn  >= 0 ? cellNum(ws, r, cIn)  : null,
      withdrawal: cOut >= 0 ? cellNum(ws, r, cOut) : null,
      method:     cMth >= 0 ? (cellStr(ws, r, cMth) || null) : null,
      memo:       cMemo >= 0 ? (cellStr(ws, r, cMemo) || null) : null,
    })
    rowNum++
  }
  return results
}

function parseOptionTradeSheet(
  ws: XLSX.WorkSheet,
  accountNo: string,
  tradeDate: string,
  sourceFile: string,
): CfmmcOptionTrade[] {
  const range = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null
  if (!range) return []

  let headerRow = -1
  for (let r = range.s.r; r <= Math.min(range.e.r, 40); r++) {
    const a = cellStr(ws, r, 0).replace(/\s+/g, "")
    if (a === "品种合约" || a === "合约") { headerRow = r; break }
  }
  if (headerRow === -1) return []

  const cols = headerColMap(ws, headerRow, range.e.c)
  const cInstr = colOf(cols, "品种合约", "合约")
  const cNo    = colOf(cols, "流水号", "成交序号")
  const cTime  = colOf(cols, "成交时间")
  const cBs    = colOf(cols, "买/卖")
  const cPx    = colOf(cols, "权利金单价")
  const cVol   = colOf(cols, "成交量", "手数")
  const cPrem  = colOf(cols, "权利金")
  const cCov   = colOf(cols, "是否备兑")
  const cFee   = colOf(cols, "手续费")
  const cDate  = colOf(cols, "成交日期", "实际成交日期")
  if (cInstr < 0) return []

  const results: CfmmcOptionTrade[] = []
  let rowNum = 0
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const instr = cellStr(ws, r, cInstr).trim()
    if (!instr || instr.includes("合计") || instr.includes("小计")) continue
    results.push({
      accountNo, tradeDate, sourceFile, rowNum, instrument: instr,
      tradeNo:    cNo  >= 0 ? (cellStr(ws, r, cNo) || null) : null,
      tradeTime:  cTime >= 0 ? (cellStr(ws, r, cTime) || null) : null,
      bs:         cBs  >= 0 ? (cellStr(ws, r, cBs) || null) : null,
      premiumPx:  cPx  >= 0 ? cellNum(ws, r, cPx) : null,
      volume:     cVol >= 0 ? cellNum(ws, r, cVol) : null,
      premium:    cPrem >= 0 ? cellNum(ws, r, cPrem) : null,
      covered:    cCov >= 0 ? (cellStr(ws, r, cCov) || null) : null,
      commission: cFee >= 0 ? cellNum(ws, r, cFee) : null,
      actualDate: cDate >= 0 ? (cellStr(ws, r, cDate) || null) : null,
    })
    rowNum++
  }
  return results
}

function parseSecuritiesSheet(
  ws: XLSX.WorkSheet,
  accountNo: string,
  tradeDate: string,
  sourceFile: string,
): CfmmcSecurity[] {
  const range = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null
  if (!range) return []

  let headerRow = -1
  for (let r = range.s.r; r <= Math.min(range.e.r, 40); r++) {
    if (cellStr(ws, r, 0).replace(/\s+/g, "") === "证券代码") { headerRow = r; break }
  }
  if (headerRow === -1) return []

  const cols = headerColMap(ws, headerRow, range.e.c)
  const cCode = colOf(cols, "证券代码")
  const cName = colOf(cols, "证券简称")
  const cChg  = colOf(cols, "变动类型")
  const cBs   = colOf(cols, "买卖标志")
  const cNo   = colOf(cols, "成交流水号")
  const cTime = colOf(cols, "成交时间")
  const cPx   = colOf(cols, "成交价格")
  const cQty  = colOf(cols, "成交数量")
  const cAmt  = colOf(cols, "成交金额")
  const cFee  = colOf(cols, "手续费")
  if (cCode < 0) return []

  const results: CfmmcSecurity[] = []
  let rowNum = 0
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const code = cellStr(ws, r, cCode).trim()
    if (!code || code.includes("合计") || code.includes("小计")) continue
    results.push({
      accountNo, tradeDate, sourceFile, rowNum, code,
      name:       cName >= 0 ? (cellStr(ws, r, cName) || null) : null,
      changeType: cChg  >= 0 ? (cellStr(ws, r, cChg) || null) : null,
      bs:         cBs   >= 0 ? (cellStr(ws, r, cBs) || null) : null,
      tradeNo:    cNo   >= 0 ? (cellStr(ws, r, cNo) || null) : null,
      tradeTime:  cTime >= 0 ? (cellStr(ws, r, cTime) || null) : null,
      price:      cPx   >= 0 ? cellNum(ws, r, cPx) : null,
      qty:        cQty  >= 0 ? cellNum(ws, r, cQty) : null,
      amount:     cAmt  >= 0 ? cellNum(ws, r, cAmt) : null,
      commission: cFee  >= 0 ? cellNum(ws, r, cFee) : null,
    })
    rowNum++
  }
  return results
}

function derivePositionEconomics(positions: CfmmcPosition[], marginOccupied: number | null): void {
  let totalAbs = 0
  for (const p of positions) {
    const buy  = p.buyLots  ?? (p.bs === "买" ? (p.lots ?? 0) : 0)
    const sell = p.sellLots ?? (p.bs === "卖" ? (p.lots ?? 0) : 0)
    const settl = p.settlPrice ?? p.latestPrice ?? 0
    const mult = getFuturesMultiplier(p.instrument)
    const mv = buy * settl * mult - sell * settl * mult
    p.notionalMv = Number.isFinite(mv) ? mv : null
    totalAbs += Math.abs(p.notionalMv ?? 0)
  }
  for (const p of positions) {
    if (marginOccupied == null || marginOccupied === 0 || totalAbs === 0) {
      p.allocatedMargin = null
    } else {
      p.allocatedMargin = marginOccupied * Math.abs(p.notionalMv ?? 0) / totalAbs
    }
  }
}

function sheetByName(wb: XLSX.WorkBook, ...needles: string[]): XLSX.WorkSheet | undefined {
  const name = wb.SheetNames.find((n) => needles.every((nd) => n.includes(nd)))
  return name ? wb.Sheets[name] : undefined
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

/** Multi-row INSERT … ON CONFLICT. MOM ETL uses execute_values; one round-trip per row was the 重算 hang. */
async function batchUpsert(intoSql: string, conflictSql: string, rows: unknown[][], chunkSize = 80): Promise<void> {
  if (rows.length === 0) return
  const width = rows[0].length
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    const params: unknown[] = []
    const tuples = chunk.map((row, ri) => {
      const base = ri * width
      params.push(...row)
      return `(${row.map((_, c) => `$${base + c + 1}`).join(",")},NOW())`
    })
    await publicQuery(`${intoSql} VALUES ${tuples.join(",")}\n${conflictSql}`, params)
  }
}

const PRODUCT_INTO = `INSERT INTO public.cfmmc_product_pnl
    (account_no, trade_date, source_file, row_num, product_code,
     volume, turnover, commission, realized_pl, updated_at)`
const PRODUCT_CONFLICT = `ON CONFLICT (account_no, trade_date, row_num) DO UPDATE SET
    source_file  = EXCLUDED.source_file,
    product_code = EXCLUDED.product_code,
    volume       = EXCLUDED.volume,
    turnover     = EXCLUDED.turnover,
    commission   = EXCLUDED.commission,
    realized_pl  = EXCLUDED.realized_pl,
    updated_at   = NOW()`

const POSITION_INTO = `INSERT INTO public.cfmmc_positions
    (account_no, trade_date, source_file, row_num,
     instrument, trade_no, bs, open_price, lots,
     latest_price, settl_price, floating_pl, sh,
     buy_lots, buy_price, sell_lots, sell_price, prev_settle, trade_code, actual_date,
     notional_mv, allocated_margin, updated_at)`
const POSITION_CONFLICT = `ON CONFLICT (account_no, trade_date, row_num) DO UPDATE SET
    source_file       = EXCLUDED.source_file,
    instrument        = EXCLUDED.instrument,
    trade_no          = EXCLUDED.trade_no,
    bs                = EXCLUDED.bs,
    open_price        = EXCLUDED.open_price,
    lots              = EXCLUDED.lots,
    latest_price      = EXCLUDED.latest_price,
    settl_price       = EXCLUDED.settl_price,
    floating_pl       = EXCLUDED.floating_pl,
    sh                = EXCLUDED.sh,
    buy_lots          = EXCLUDED.buy_lots,
    buy_price         = EXCLUDED.buy_price,
    sell_lots         = EXCLUDED.sell_lots,
    sell_price        = EXCLUDED.sell_price,
    prev_settle       = EXCLUDED.prev_settle,
    trade_code        = EXCLUDED.trade_code,
    actual_date       = EXCLUDED.actual_date,
    notional_mv       = EXCLUDED.notional_mv,
    allocated_margin  = EXCLUDED.allocated_margin,
    updated_at        = NOW()`

const CASH_INTO = `INSERT INTO public.cfmmc_cash_flows
    (account_no, trade_date, source_file, row_num,
     occur_date, deposit, withdrawal, method, memo, updated_at)`
const CASH_CONFLICT = `ON CONFLICT (account_no, trade_date, row_num) DO UPDATE SET
    source_file = EXCLUDED.source_file,
    occur_date  = EXCLUDED.occur_date,
    deposit     = EXCLUDED.deposit,
    withdrawal  = EXCLUDED.withdrawal,
    method      = EXCLUDED.method,
    memo        = EXCLUDED.memo,
    updated_at  = NOW()`

const OPTION_INTO = `INSERT INTO public.cfmmc_option_trades
    (account_no, trade_date, source_file, row_num,
     instrument, trade_no, trade_time, bs, premium_px, volume, premium,
     covered, commission, actual_date, updated_at)`
const OPTION_CONFLICT = `ON CONFLICT (account_no, trade_date, row_num) DO UPDATE SET
    source_file = EXCLUDED.source_file,
    instrument  = EXCLUDED.instrument,
    trade_no    = EXCLUDED.trade_no,
    trade_time  = EXCLUDED.trade_time,
    bs          = EXCLUDED.bs,
    premium_px  = EXCLUDED.premium_px,
    volume      = EXCLUDED.volume,
    premium     = EXCLUDED.premium,
    covered     = EXCLUDED.covered,
    commission  = EXCLUDED.commission,
    actual_date = EXCLUDED.actual_date,
    updated_at  = NOW()`

const SECURITY_INTO = `INSERT INTO public.cfmmc_securities
    (account_no, trade_date, source_file, row_num,
     code, name, change_type, bs, trade_no, trade_time, price, qty, amount, commission, updated_at)`
const SECURITY_CONFLICT = `ON CONFLICT (account_no, trade_date, row_num) DO UPDATE SET
    source_file = EXCLUDED.source_file,
    code        = EXCLUDED.code,
    name        = EXCLUDED.name,
    change_type = EXCLUDED.change_type,
    bs          = EXCLUDED.bs,
    trade_no    = EXCLUDED.trade_no,
    trade_time  = EXCLUDED.trade_time,
    price       = EXCLUDED.price,
    qty         = EXCLUDED.qty,
    amount      = EXCLUDED.amount,
    commission  = EXCLUDED.commission,
    updated_at  = NOW()`

const TRADE_INTO = `INSERT INTO public.cfmmc_trades
    (account_no, trade_date, source_file, row_num,
     instrument, trade_no, trade_time, bs, sh, price, lots, turnover, oc,
     commission, realized_pl, actual_date, updated_at)`
const TRADE_CONFLICT = `ON CONFLICT (account_no, trade_date, row_num) DO UPDATE SET
    source_file  = EXCLUDED.source_file,
    instrument   = EXCLUDED.instrument,
    trade_no     = EXCLUDED.trade_no,
    trade_time   = EXCLUDED.trade_time,
    bs           = EXCLUDED.bs,
    sh           = EXCLUDED.sh,
    price        = EXCLUDED.price,
    lots         = EXCLUDED.lots,
    turnover     = EXCLUDED.turnover,
    oc           = EXCLUDED.oc,
    commission   = EXCLUDED.commission,
    realized_pl  = EXCLUDED.realized_pl,
    actual_date  = EXCLUDED.actual_date,
    updated_at   = NOW()`

const CLOSE_INTO = `INSERT INTO public.cfmmc_closes
    (account_no, trade_date, source_file, row_num,
     instrument, trade_no, bs, price, open_price, lots, prev_settle,
     realized_pl, orig_trade_no, actual_date, updated_at)`
const CLOSE_CONFLICT = `ON CONFLICT (account_no, trade_date, row_num) DO UPDATE SET
    source_file   = EXCLUDED.source_file,
    instrument    = EXCLUDED.instrument,
    trade_no      = EXCLUDED.trade_no,
    bs            = EXCLUDED.bs,
    price         = EXCLUDED.price,
    open_price    = EXCLUDED.open_price,
    lots          = EXCLUDED.lots,
    prev_settle   = EXCLUDED.prev_settle,
    realized_pl   = EXCLUDED.realized_pl,
    orig_trade_no = EXCLUDED.orig_trade_no,
    actual_date   = EXCLUDED.actual_date,
    updated_at    = NOW()`

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function clearCfmmcExtractedData(): Promise<void> {
  await ensureTables()
  for (const t of [
    "public.cfmmc_daily_summary",
    "public.cfmmc_product_pnl",
    "public.cfmmc_positions",
    "public.cfmmc_trades",
    "public.cfmmc_closes",
    "public.cfmmc_cash_flows",
    "public.cfmmc_option_trades",
    "public.cfmmc_securities",
  ]) {
    try {
      await publicQuery(`TRUNCATE ${t}`)
    } catch {
      try { await publicQuery(`DELETE FROM ${t}`) } catch { /* table may not exist yet */ }
    }
  }
  try {
    await ensureAccountRiskSchema()
    for (const table of [
      "account_risk.mom_daily_reports",
      "account_risk.mom_futures_position_details",
      "account_risk.mom_position_details",
      "account_risk.mom_futures_trade_details",
      "account_risk.mom_close_details",
      "account_risk.mom_summary_details",
    ]) {
      try { await publicQuery(`DELETE FROM ${table}`) } catch { /* ignore */ }
    }
  } catch { /* schema may not exist */ }
  clearAccountSourceCache()
}

const CFMMC_TABLES = [
  "public.cfmmc_daily_summary",
  "public.cfmmc_product_pnl",
  "public.cfmmc_positions",
  "public.cfmmc_trades",
  "public.cfmmc_closes",
  "public.cfmmc_cash_flows",
  "public.cfmmc_option_trades",
  "public.cfmmc_securities",
] as const

function filesForEtlScope(
  allFiles: string[],
  opts?: { bookId?: string; userId?: string; source?: ImportBookSource },
): string[] {
  const bookId = opts?.bookId?.trim()
  const userId = opts?.userId?.trim()
  const source = opts?.source
  if (!bookId && !userId && !source) return allFiles
  const listed = new Set<string>()
  const bookIds = new Set<string>()
  if (bookId) {
    bookIds.add(bookId)
    const book = getImportBook(bookId)
    for (const f of book?.files ?? sourceFilesForBook(bookId)) {
      if (f.endsWith("%")) continue
      const n = f.replace(/\\/g, "/")
      listed.add(n)
      listed.add(path.basename(n))
    }
  } else if (source) {
    for (const book of listImportBooks()) {
      if (bookSource(book) !== source) continue
      bookIds.add(book.id)
      for (const f of book.files) {
        if (f.endsWith("%")) continue
        const n = f.replace(/\\/g, "/")
        listed.add(n)
        listed.add(path.basename(n))
      }
    }
  }
  return allFiles.filter((rel) => {
    const n = rel.replace(/\\/g, "/")
    const base = path.basename(n)
    if (listed.has(n) || listed.has(base)) return true
    const prefix = n.includes("/") ? n.split("/")[0] : ""
    if (prefix && bookIds.has(prefix)) return true
    if (bookId && bookId !== "ungrouped" && n.startsWith(`${bookId}/`)) return true
    if (userId && (base.startsWith(`${userId}_`) || base.startsWith(`${userId}.`))) return true
    return false
  })
}

export async function clearCfmmcRowsForFiles(files: string[]): Promise<void> {
  const names = [...new Set(files.flatMap((f) => {
    const n = f.replace(/\\/g, "/")
    return [n, path.basename(n)]
  }))].filter(Boolean)
  if (names.length === 0) return
  for (const t of CFMMC_TABLES) {
    try {
      await publicQuery(`DELETE FROM ${t} WHERE source_file = ANY($1::text[])`, [names])
    } catch {
      /* table may not exist */
    }
  }
}

export async function runCfmmcETL(
  mode: "full" | "incremental" = "incremental",
  opts?: { bookId?: string; userId?: string; source?: ImportBookSource },
): Promise<CfmmcETLResult> {
  await ensureTables()

  const dir = accountRiskImportDir()
  const scoped = opts?.bookId || opts?.userId || opts?.source
  const allFiles = filesForEtlScope(
    fs.existsSync(dir) ? listSpreadsheetRelPaths(dir) : [],
    opts,
  )

  const result: CfmmcETLResult = { processed: 0, inserted: 0, updated: 0, skipped: 0, errors: [] }
  appendJobLog("etl", `${mode === "full" ? "全量重算" : "增量计算"}：${allFiles.length} 个文件`)
  if (allFiles.length === 0) {
    appendJobLog("etl", "没有可计算的文件")
    return result
  }

  let processedFiles = new Set<string>()
  if (mode === "incremental") {
    // Skip only files already parsed by the current label mapping (deposit_wd populated).
    // Older runs left deposit_wd NULL on 国投/逐笔对冲 reports, so those must be re-read.
    const res = await publicQuery(`
      SELECT DISTINCT source_file FROM public.cfmmc_daily_summary
      WHERE deposit_wd IS NOT NULL
    `)
    processedFiles = new Set((res.rows as { source_file: string }[]).map(r => r.source_file))
  } else if (scoped) {
    await clearCfmmcRowsForFiles(allFiles)
  } else {
    await clearCfmmcExtractedData()
  }

  let fileIndex = 0
  for (const fileName of allFiles) {
    fileIndex++
    if (mode === "incremental" && (processedFiles.has(fileName) || processedFiles.has(path.basename(fileName)))) {
      result.skipped++
      continue
    }

    try {
      appendJobLog("etl", `[${fileIndex}/${allFiles.length}] ${path.basename(fileName)}`)
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

      const prodSheet = sheetByName(wb, "品种汇总") ?? (wb.SheetNames.length > 1 ? wb.Sheets[wb.SheetNames[1]] : undefined)
      if (prodSheet) {
        const products = parseProductSheet(prodSheet, summary.accountNo, summary.tradeDate, fileName)
        await batchUpsert(PRODUCT_INTO, PRODUCT_CONFLICT, products.map((p) => [
          p.accountNo, p.tradeDate, p.sourceFile, p.rowNum, p.productCode,
          p.volume, p.turnover, p.commission, p.realizedPl,
        ]))
      }

      const posSheet = sheetByName(wb, "持仓明细") ?? sheetByName(wb, "仓位明细")
      if (posSheet) {
        const positions = parsePositionSheet(posSheet, summary.accountNo, summary.tradeDate, fileName)
        derivePositionEconomics(positions, summary.marginOccupied)
        await batchUpsert(POSITION_INTO, POSITION_CONFLICT, positions.map((p) => [
          p.accountNo, p.tradeDate, p.sourceFile, p.rowNum,
          p.instrument, p.tradeNo, p.bs, p.openPrice, p.lots,
          p.latestPrice, p.settlPrice, p.floatingPl, p.sh,
          p.buyLots, p.buyPrice, p.sellLots, p.sellPrice, p.prevSettle, p.tradeCode, p.actualDate,
          p.notionalMv, p.allocatedMargin,
        ]))
      }

      await batchUpsert(CASH_INTO, CASH_CONFLICT,
        parseCashFlows(ws0, summary.accountNo, summary.tradeDate, fileName).map((flow) => [
          flow.accountNo, flow.tradeDate, flow.sourceFile, flow.rowNum,
          flow.occurDate, flow.deposit, flow.withdrawal, flow.method, flow.memo,
        ]))

      const optSheet = sheetByName(wb, "期权成交明细")
      if (optSheet) {
        await batchUpsert(OPTION_INTO, OPTION_CONFLICT,
          parseOptionTradeSheet(optSheet, summary.accountNo, summary.tradeDate, fileName).map((t) => [
            t.accountNo, t.tradeDate, t.sourceFile, t.rowNum,
            t.instrument, t.tradeNo, t.tradeTime, t.bs, t.premiumPx, t.volume, t.premium,
            t.covered, t.commission, t.actualDate,
          ]))
      }

      const secSheet = sheetByName(wb, "证券成交明细")
      if (secSheet) {
        await batchUpsert(SECURITY_INTO, SECURITY_CONFLICT,
          parseSecuritiesSheet(secSheet, summary.accountNo, summary.tradeDate, fileName).map((s) => [
            s.accountNo, s.tradeDate, s.sourceFile, s.rowNum,
            s.code, s.name, s.changeType, s.bs, s.tradeNo, s.tradeTime, s.price, s.qty, s.amount, s.commission,
          ]))
      }

      const tradeSheetName = wb.SheetNames.find((n) => n === "成交明细" || (n.includes("成交明细") && !n.includes("期权") && !n.includes("证券")))
      if (tradeSheetName) {
        const trades = parseTradeSheet(wb.Sheets[tradeSheetName], summary.accountNo, summary.tradeDate, fileName)
        await batchUpsert(TRADE_INTO, TRADE_CONFLICT, trades.map((t) => [
          t.accountNo, t.tradeDate, t.sourceFile, t.rowNum,
          t.instrument, t.tradeNo, t.tradeTime, t.bs, t.sh, t.price, t.lots, t.turnover, t.oc,
          t.commission, t.realizedPl, t.actualDate,
        ]))
      }

      const closeSheet = sheetByName(wb, "平仓明细")
      if (closeSheet) {
        const closes = parseCloseSheet(closeSheet, summary.accountNo, summary.tradeDate, fileName)
        await batchUpsert(CLOSE_INTO, CLOSE_CONFLICT, closes.map((c) => [
          c.accountNo, c.tradeDate, c.sourceFile, c.rowNum,
          c.instrument, c.tradeNo, c.bs, c.price, c.openPrice, c.lots, c.prevSettle,
          c.realizedPl, c.origTradeNo, c.actualDate,
        ]))
      }

      result.processed++
    } catch (e) {
      result.errors.push(`${fileName}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (allFiles.length >= 5) {
    try {
      const names = allFiles.flatMap((f) => {
        const n = f.replace(/\\/g, "/")
        return [n, path.basename(n)]
      })
      const dateRes = await publicQuery(`
        SELECT COUNT(DISTINCT trade_date)::int AS days
        FROM public.cfmmc_daily_summary
        WHERE source_file = ANY($1::text[])
           OR account_no = ANY($2::text[])
      `, [
        names,
        [...new Set(allFiles.map((f) => path.basename(f).split("_")[0]).filter((id) => /^\d{6,}$/.test(id)))],
      ])
      const days = Number((dateRes.rows[0] as { days?: number } | undefined)?.days ?? 0)
      if (days > 0 && days <= Math.max(1, Math.floor(allFiles.length / 5))) {
        result.errors.push(
          `本页有 ${allFiles.length} 个文件但库里只有 ${days} 个交易日。监控中心历史获取没有切到对应日期，文件名上的日期不可信。请清空本页文件后重新「立即获取」，再全量重算。`,
        )
      }
    } catch {
      // non-fatal
    }
  }

  // Overwrite daily_pnl with equity-path net PnL so NAV compounding is correct.
  try {
    await publicQuery(`
      WITH ordered AS (
        SELECT id,
               COALESCE(client_equity, 0) AS eq,
               COALESCE(deposit_wd, 0) AS flow,
               LAG(COALESCE(client_equity, 0)) OVER (PARTITION BY account_no ORDER BY trade_date) AS prev_eq
        FROM public.cfmmc_daily_summary
      )
      UPDATE public.cfmmc_daily_summary s
      SET daily_pnl = o.eq - COALESCE(o.prev_eq, 0) - o.flow
      FROM ordered o
      WHERE s.id = o.id
    `)
  } catch (e) {
    result.errors.push(`daily_pnl: ${e instanceof Error ? e.message : String(e)}`)
  }

  // notional_mv is written at insert time. Charts read public.cfmmc_* directly,
  // so skip the old all-row UPDATE + account_risk.mom_* clone rebuild.

  clearAccountSourceCache()
  appendJobLog("etl", `完成：处理 ${result.processed}，新增 ${result.inserted}，更新 ${result.updated}，跳过 ${result.skipped}`)

  try {
    const { syncAccountRiskDirectNav } = await import("@/lib/server/account-risk-direct-nav-sync")
    const navSync = await syncAccountRiskDirectNav()
    for (const item of navSync.items) {
      if (item.status === "synced") {
        appendJobLog(
          "etl",
          `直投产品净值同步 ${item.productName}：${item.days} 日，最新 ${item.latestNavDate} ${item.latestNav}`,
        )
      } else if (item.status === "failed") {
        appendJobLog("etl", `直投产品净值同步失败 ${item.productName}：${item.error}`)
      }
    }
  } catch (e) {
    appendJobLog("etl", `直投产品净值同步失败：${e instanceof Error ? e.message : String(e)}`)
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
  trade_date:       string
  account_no:       string
  instrument:       string
  bs:               string | null
  lots:             number | null
  latest_price:     number | null
  settl_price:      number | null
  floating_pl:      number | null
  sh:               string | null
  notional_mv:      number | null
  allocated_margin: number | null
}

export async function queryLatestPositions(): Promise<PositionRow[]> {
  const res = await publicQuery(`
    SELECT p.trade_date::text AS trade_date, p.account_no, p.instrument,
           p.bs, p.lots, p.latest_price, p.settl_price, p.floating_pl, p.sh,
           p.notional_mv, p.allocated_margin
    FROM public.cfmmc_positions p
    INNER JOIN (
      SELECT account_no, MAX(trade_date) AS max_date
      FROM public.cfmmc_daily_summary
      GROUP BY account_no
    ) latest ON latest.account_no = p.account_no AND p.trade_date = latest.max_date
    WHERE (COALESCE(p.lots, 0) > 0 OR COALESCE(p.buy_lots, 0) > 0 OR COALESCE(p.sell_lots, 0) > 0)
    ORDER BY ABS(COALESCE(p.notional_mv, p.floating_pl, 0)) DESC
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

  const safe = async (sql: string, label: string) => {
    try {
      return await publicQuery(sql)
    } catch (e) {
      console.warn(`[cfmmc-sync ${label}]`, e instanceof Error ? e.message : e)
      return { rowCount: 0, rows: [] }
    }
  }

  for (const table of [
    "account_risk.mom_daily_reports",
    "account_risk.mom_futures_position_details",
    "account_risk.mom_position_details",
    "account_risk.mom_futures_trade_details",
    "account_risk.mom_close_details",
    "account_risk.mom_summary_details",
  ]) {
    await safe(`DELETE FROM ${table}`, `clear ${table}`)
  }

  // daily_pnl is net (equity path). MOM charts do 当日盈亏 - 当日手续费, so store gross.
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
      (COALESCE(daily_pnl, 0) + COALESCE(commission, 0))::text,
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

  const posSql = `
    INSERT INTO account_risk.$TABLE
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
      COALESCE(buy_lots::text,  CASE WHEN bs = '买' THEN COALESCE(lots::text, '0') ELSE '0' END),
      COALESCE(buy_price::text, CASE WHEN bs = '买' THEN open_price::text ELSE NULL END),
      COALESCE(sell_lots::text, CASE WHEN bs = '卖' THEN COALESCE(lots::text, '0') ELSE '0' END),
      COALESCE(sell_price::text, CASE WHEN bs = '卖' THEN open_price::text ELSE NULL END),
      COALESCE(prev_settle::text, NULL),
      COALESCE(settl_price::text, '0'),
      COALESCE(floating_pl::text, '0'),
      COALESCE(sh, '投机'),
      trade_code,
      COALESCE(actual_date, trade_date::text),
      NULL, NULL, NULL,
      notional_mv::text,
      allocated_margin::text,
      NULL,
      source_file || ':' || row_num::text,
      md5(account_no || '_' || trade_date::text || '_' || row_num::text || '_' || source_file)
    FROM public.cfmmc_positions
    WHERE COALESCE(buy_lots, 0) > 0 OR COALESCE(sell_lots, 0) > 0 OR COALESCE(lots, 0) > 0
    ON CONFLICT (row_hash) DO UPDATE SET
      "账户"        = EXCLUDED."账户",
      "交易日期"    = EXCLUDED."交易日期",
      "合约"        = EXCLUDED."合约",
      "买持仓"      = EXCLUDED."买持仓",
      "买入价"      = EXCLUDED."买入价",
      "卖持仓"      = EXCLUDED."卖持仓",
      "卖出价"      = EXCLUDED."卖出价",
      "昨结算价"    = EXCLUDED."昨结算价",
      "今结算价"    = EXCLUDED."今结算价",
      "持仓盈亏"    = EXCLUDED."持仓盈亏",
      "投机/套保"   = EXCLUDED."投机/套保",
      "持仓市値"    = EXCLUDED."持仓市値",
      "保证金"      = EXCLUDED."保证金"
  `
  const posRes = await safe(posSql.replace("$TABLE", "mom_futures_position_details"), "futures_pos")
  await safe(posSql.replace("$TABLE", "mom_position_details"), "pos")
  const posCount = posRes.rowCount ?? 0

  await safe(`
    INSERT INTO account_risk.mom_futures_trade_details
      ("账户", "交易日期",
       "合约", "成交编号", "成交时间", "买/卖", "投机/套保",
       "成交价", "手数", "成交额", "开/平", "手续费", "平仓盈亏",
       "成交日期", source_file_rel, row_hash)
    SELECT
      account_no, trade_date,
      instrument, COALESCE(trade_no, ''), trade_time, bs, COALESCE(sh, '投机'),
      price::text, lots::text, turnover::text, oc, commission::text,
      COALESCE(realized_pl::text, '0'),
      COALESCE(actual_date, trade_date::text),
      source_file || ':t:' || row_num::text,
      md5('t_' || account_no || '_' || trade_date::text || '_' || row_num::text || '_' || source_file)
    FROM public.cfmmc_trades
    ON CONFLICT (row_hash) DO UPDATE SET
      "合约"     = EXCLUDED."合约",
      "买/卖"    = EXCLUDED."买/卖",
      "手数"     = EXCLUDED."手数",
      "成交额"   = EXCLUDED."成交额",
      "手续费"   = EXCLUDED."手续费",
      "平仓盈亏" = EXCLUDED."平仓盈亏"
  `, "trades")

  await safe(`
    INSERT INTO account_risk.mom_close_details
      ("账户", "交易日期",
       "合约", "买/卖", "成交价", "开仓价", "手数", "昨结算价", "平仓盈亏",
       "开仓成交编号", "开仓日期", source_file_rel, row_hash)
    SELECT
      account_no, trade_date,
      instrument, bs, price::text, open_price::text, lots::text, prev_settle::text,
      realized_pl::text, orig_trade_no, actual_date,
      source_file || ':c:' || row_num::text,
      md5('c_' || account_no || '_' || trade_date::text || '_' || row_num::text || '_' || source_file)
    FROM public.cfmmc_closes
    ON CONFLICT (row_hash) DO UPDATE SET
      "合约"     = EXCLUDED."合约",
      "平仓盈亏" = EXCLUDED."平仓盈亏",
      "手数"     = EXCLUDED."手数"
  `, "closes")

  await safe(`
    INSERT INTO account_risk.mom_summary_details
      ("账户", "交易日期",
       "品种", "手数", "成交额", "手续费", "平仓盈亏", "交易日",
       source_file_rel, row_hash)
    SELECT
      account_no, trade_date,
      product_code, volume::text, turnover::text, commission::text, realized_pl::text,
      trade_date::text,
      source_file || ':s:' || row_num::text,
      md5('s_' || account_no || '_' || trade_date::text || '_' || row_num::text || '_' || source_file)
    FROM public.cfmmc_product_pnl
    ON CONFLICT (row_hash) DO UPDATE SET
      "品种"     = EXCLUDED."品种",
      "手数"     = EXCLUDED."手数",
      "成交额"   = EXCLUDED."成交额",
      "手续费"   = EXCLUDED."手续费",
      "平仓盈亏" = EXCLUDED."平仓盈亏"
  `, "summary")

  return { daily: dailyCount, positions: posCount }
}
