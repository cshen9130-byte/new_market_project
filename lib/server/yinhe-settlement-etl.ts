/**
 * 银河期货结算单 → PostgreSQL ETL
 */

import fs from "fs"
import path from "path"
import { rawQuery, query } from "@/lib/db"
import { getYinheDownloadDir, listYinheDownloadedFiles } from "@/lib/server/yinhe-settlement-email"
import {
  mergeDayBundles,
  parseYinheStatementTxt,
  parseYinheXls,
  type YinheDayBundle,
} from "@/lib/server/yinhe-settlement-parse"

export type YinheETLResult = {
  days: number
  accountUpserts: number
  tradeRows: number
  positionRows: number
  closedRows: number
  warnings: string[]
  log: string[]
}

const DDL = `
CREATE TABLE IF NOT EXISTS yinhe_account_summary (
  id                  SERIAL PRIMARY KEY,
  client_id           TEXT NOT NULL,
  client_name         TEXT,
  trade_date          DATE NOT NULL,
  source_file         TEXT NOT NULL,
  balance_bf          NUMERIC,
  deposit_withdrawal  NUMERIC,
  realized_pl         NUMERIC,
  mtm_pl              NUMERIC,
  commission          NUMERIC,
  balance_cf          NUMERIC,
  client_equity       NUMERIC,
  fund_avail          NUMERIC,
  risk_degree         NUMERIC,
  margin_occupied     NUMERIC,
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_id, trade_date)
);

CREATE TABLE IF NOT EXISTS yinhe_transaction_records (
  id               SERIAL PRIMARY KEY,
  trade_date       DATE,
  settlement_date  DATE,
  product          TEXT,
  instrument       TEXT,
  bs               TEXT,
  oc               TEXT,
  lots             NUMERIC,
  price            NUMERIC,
  turnover         NUMERIC,
  fee              NUMERIC,
  realized_pl      NUMERIC,
  source_file      TEXT NOT NULL,
  row_num          INT NOT NULL,
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (source_file, row_num)
);

CREATE TABLE IF NOT EXISTS yinhe_position_summary (
  id                SERIAL PRIMARY KEY,
  settlement_date   DATE,
  product           TEXT,
  instrument        TEXT,
  long_pos          NUMERIC,
  short_pos         NUMERIC,
  avg_buy_price     NUMERIC,
  avg_sell_price    NUMERIC,
  prev_settl        NUMERIC,
  settl_today       NUMERIC,
  mtm_pl            NUMERIC,
  margin_occupied   NUMERIC,
  source_file       TEXT NOT NULL,
  row_num           INT NOT NULL,
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (source_file, row_num)
);

CREATE TABLE IF NOT EXISTS yinhe_position_closed (
  id                SERIAL PRIMARY KEY,
  settlement_date   DATE,
  product           TEXT,
  instrument        TEXT,
  bs                TEXT,
  lots              NUMERIC,
  pos_open_price    NUMERIC,
  prev_settl        NUMERIC,
  trans_price       NUMERIC,
  realized_pl       NUMERIC,
  source_file       TEXT NOT NULL,
  row_num           INT NOT NULL,
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (source_file, row_num)
);
`

async function ensureTables(): Promise<void> {
  await rawQuery(DDL)
}

function parseLocalFile(filePath: string, name: string): YinheDayBundle {
  const buf = fs.readFileSync(filePath)
  const lower = name.toLowerCase()
  const dateHint = name.match(/(\d{8})/)?.[1]
  if (lower.endsWith(".txt") || lower.includes("daily account statement")) {
    return parseYinheStatementTxt(buf, name)
  }
  return parseYinheXls(buf, name, dateHint)
}

export async function runYinheSettlementETL(): Promise<YinheETLResult> {
  await ensureTables()
  const { files, folder } = listYinheDownloadedFiles()
  const log: string[] = [`扫描目录 ${folder}，共 ${files.length} 个附件`]
  const warnings: string[] = []

  if (files.length === 0) {
    throw new Error(`银河期货结算附件目录为空：${folder}。请先拉取邮件。`)
  }

  const bundles: YinheDayBundle[] = []
  for (const f of files) {
    try {
      const b = parseLocalFile(path.join(folder, f.name), f.name)
      bundles.push(b)
      log.push(
        `${f.name}: date=${b.tradeDate || "?"} account=${b.account ? "Y" : "N"} trades=${b.trades.length} pos=${b.positions.length} closed=${b.closed.length}`,
      )
      warnings.push(...b.warnings)
    } catch (e) {
      warnings.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const days = mergeDayBundles(bundles)
  if (days.length === 0) {
    throw new Error("未能从附件中解析出任何结算日数据，请检查 TXT/XLS 格式。")
  }

  let accountUpserts = 0
  let tradeRows = 0
  let positionRows = 0
  let closedRows = 0

  for (const day of days) {
    if (day.account) {
      await query(
        `INSERT INTO yinhe_account_summary (
           client_id, client_name, trade_date, source_file,
           balance_bf, deposit_withdrawal, realized_pl, mtm_pl, commission,
           balance_cf, client_equity, fund_avail, risk_degree, margin_occupied, updated_at
         ) VALUES (
           $1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW()
         )
         ON CONFLICT (client_id, trade_date) DO UPDATE SET
           client_name = EXCLUDED.client_name,
           source_file = EXCLUDED.source_file,
           balance_bf = EXCLUDED.balance_bf,
           deposit_withdrawal = EXCLUDED.deposit_withdrawal,
           realized_pl = EXCLUDED.realized_pl,
           mtm_pl = EXCLUDED.mtm_pl,
           commission = EXCLUDED.commission,
           balance_cf = EXCLUDED.balance_cf,
           client_equity = EXCLUDED.client_equity,
           fund_avail = EXCLUDED.fund_avail,
           risk_degree = EXCLUDED.risk_degree,
           margin_occupied = EXCLUDED.margin_occupied,
           updated_at = NOW()`,
        [
          day.account.clientId,
          day.account.clientName,
          day.account.tradeDate,
          day.account.sourceFile,
          day.account.balanceBf,
          day.account.depositWithdrawal,
          day.account.realizedPl,
          day.account.mtmPl,
          day.account.commission,
          day.account.balanceCf,
          day.account.clientEquity,
          day.account.fundAvail,
          day.account.riskDegree,
          day.account.marginOccupied,
        ],
      )
      accountUpserts += 1
    }

    // Replace detail rows for this settlement date to avoid duplicates across TXT/XLS
    await query(`DELETE FROM yinhe_transaction_records WHERE settlement_date = $1::date`, [day.tradeDate])
    await query(`DELETE FROM yinhe_position_summary WHERE settlement_date = $1::date`, [day.tradeDate])
    await query(`DELETE FROM yinhe_position_closed WHERE settlement_date = $1::date`, [day.tradeDate])

    for (const t of day.trades) {
      await query(
        `INSERT INTO yinhe_transaction_records (
           trade_date, settlement_date, product, instrument, bs, oc,
           lots, price, turnover, fee, realized_pl, source_file, row_num, updated_at
         ) VALUES (
           $1::date,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()
         )
         ON CONFLICT (source_file, row_num) DO UPDATE SET
           trade_date = EXCLUDED.trade_date,
           settlement_date = EXCLUDED.settlement_date,
           product = EXCLUDED.product,
           instrument = EXCLUDED.instrument,
           bs = EXCLUDED.bs,
           oc = EXCLUDED.oc,
           lots = EXCLUDED.lots,
           price = EXCLUDED.price,
           turnover = EXCLUDED.turnover,
           fee = EXCLUDED.fee,
           realized_pl = EXCLUDED.realized_pl,
           updated_at = NOW()`,
        [
          t.tradeDate,
          t.settlementDate,
          t.product,
          t.instrument,
          t.bs,
          t.oc,
          t.lots,
          t.price,
          t.turnover,
          t.fee,
          t.realizedPl,
          `${day.tradeDate}:${t.sourceFile}`,
          t.rowNum,
        ],
      )
      tradeRows += 1
    }

    for (const p of day.positions) {
      await query(
        `INSERT INTO yinhe_position_summary (
           settlement_date, product, instrument, long_pos, short_pos,
           avg_buy_price, avg_sell_price, prev_settl, settl_today, mtm_pl,
           margin_occupied, source_file, row_num, updated_at
         ) VALUES (
           $1::date,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()
         )
         ON CONFLICT (source_file, row_num) DO UPDATE SET
           product = EXCLUDED.product,
           instrument = EXCLUDED.instrument,
           long_pos = EXCLUDED.long_pos,
           short_pos = EXCLUDED.short_pos,
           avg_buy_price = EXCLUDED.avg_buy_price,
           avg_sell_price = EXCLUDED.avg_sell_price,
           prev_settl = EXCLUDED.prev_settl,
           settl_today = EXCLUDED.settl_today,
           mtm_pl = EXCLUDED.mtm_pl,
           margin_occupied = EXCLUDED.margin_occupied,
           updated_at = NOW()`,
        [
          p.settlementDate,
          p.product,
          p.instrument,
          p.longPos,
          p.shortPos,
          p.avgBuyPrice,
          p.avgSellPrice,
          p.prevSettl,
          p.settlToday,
          p.mtmPl,
          p.marginOccupied,
          `${day.tradeDate}:${p.sourceFile}`,
          p.rowNum,
        ],
      )
      positionRows += 1
    }

    for (const c of day.closed) {
      await query(
        `INSERT INTO yinhe_position_closed (
           settlement_date, product, instrument, bs, lots,
           pos_open_price, prev_settl, trans_price, realized_pl,
           source_file, row_num, updated_at
         ) VALUES (
           $1::date,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW()
         )
         ON CONFLICT (source_file, row_num) DO UPDATE SET
           product = EXCLUDED.product,
           instrument = EXCLUDED.instrument,
           bs = EXCLUDED.bs,
           lots = EXCLUDED.lots,
           pos_open_price = EXCLUDED.pos_open_price,
           prev_settl = EXCLUDED.prev_settl,
           trans_price = EXCLUDED.trans_price,
           realized_pl = EXCLUDED.realized_pl,
           updated_at = NOW()`,
        [
          c.settlementDate,
          c.product,
          c.instrument,
          c.bs,
          c.lots,
          c.posOpenPrice,
          c.prevSettl,
          c.transPrice,
          c.realizedPl,
          `${day.tradeDate}:${c.sourceFile}`,
          c.rowNum,
        ],
      )
      closedRows += 1
    }
  }

  log.push(
    `入库完成: ${days.length} 个交易日, account=${accountUpserts}, trades=${tradeRows}, positions=${positionRows}, closed=${closedRows}`,
  )

  return {
    days: days.length,
    accountUpserts,
    tradeRows,
    positionRows,
    closedRows,
    warnings,
    log,
  }
}
