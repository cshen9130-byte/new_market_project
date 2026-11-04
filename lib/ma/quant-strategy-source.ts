import { quantStrategyAccount, type QuantStrategySource } from "@/lib/ma/quant-accounts"

/**
 * Table sources for 量化策略分析.
 * MOM accounts keep the bare public.mom_* names so existing SQL is unchanged.
 * Broker accounts project public.cfmmc_* into those same column names.
 * 逐笔对冲 stores 浮动盈亏 as the open-to-settle level, not that day's gain.
 * Only the last day in the window is passed through as 持仓盈亏, so summing
 * it across dates does not turn a stock into hundreds of millions of profit.
 * The projection never mentions mom_* tables, so the MOM sub-account wrapper
 * does not rewrite it and the two books cannot fall through into each other.
 */
export type QuantStrategyBooks = {
  source: QuantStrategySource
  daily: string
  close: string
  trade: string
  pos: string
}

const MOM_BOOKS: QuantStrategyBooks = {
  source: "mom",
  daily: "mom_daily_reports",
  close: "mom_close_details",
  trade: "mom_futures_trade_details",
  pos: "mom_position_details",
}

function cfmmcBooks(): QuantStrategyBooks {
  const openDate = `CASE
    WHEN actual_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN LEFT(actual_date, 10)
    WHEN actual_date ~ '^[0-9]{8}' THEN LEFT(actual_date, 8)
    ELSE NULL
  END`
  return {
    source: "cfmmc",
    daily: `(
      SELECT
        account_no AS "账户",
        trade_date AS "交易日期",
        (COALESCE(daily_pnl, 0) + COALESCE(commission, 0))::text AS "当日盈亏",
        COALESCE(commission, 0)::text AS "当日手续费",
        '0' AS "权利金收入",
        '0' AS "权利金支出",
        COALESCE(client_equity, 0)::text AS "客户权益",
        COALESCE(margin_occupied, 0)::text AS "保证金占用",
        CASE
          WHEN risk_ratio IS NOT NULL THEN round(risk_ratio * 100, 4)::text || '%'
          ELSE '0.00%'
        END AS "风险度"
      FROM public.cfmmc_daily_summary
      WHERE account_no = $1
        AND trade_date BETWEEN $2::date AND $3::date
    ) cfmmc_daily`,
    close: `(
      SELECT
        account_no AS "账户",
        trade_date AS "交易日期",
        instrument AS "合约",
        bs AS "买/卖",
        ${openDate} AS "开仓日期",
        COALESCE(lots, 0)::text AS "手数",
        COALESCE(realized_pl, 0)::text AS "平仓盈亏",
        COALESCE(realized_pl, 0)::text AS "逐笔平仓盈亏"
      FROM public.cfmmc_closes
      WHERE account_no = $1
        AND trade_date BETWEEN $2::date AND $3::date
    ) cfmmc_close`,
    trade: `(
      SELECT
        account_no AS "账户",
        trade_date AS "交易日期",
        instrument AS "合约",
        trade_time AS "成交时间",
        bs AS "买/卖",
        oc AS "开/平",
        COALESCE(lots, 0)::text AS "手数",
        COALESCE(commission, 0)::text AS "手续费",
        COALESCE(realized_pl, 0)::text AS "平仓盈亏"
      FROM public.cfmmc_trades
      WHERE account_no = $1
        AND trade_date BETWEEN $2::date AND $3::date
    ) cfmmc_trade`,
    pos: `(
      SELECT
        account_no AS "账户",
        trade_date AS "交易日期",
        instrument AS "合约",
        COALESCE(buy_lots, CASE WHEN bs = '买' THEN lots ELSE 0 END, 0)::text AS "买持仓",
        COALESCE(sell_lots, CASE WHEN bs = '卖' THEN lots ELSE 0 END, 0)::text AS "卖持仓",
        ABS(COALESCE(notional_mv, 0))::text AS "持仓市値",
        CASE
          WHEN trade_date = MAX(trade_date) OVER ()
          THEN COALESCE(floating_pl, 0)
          ELSE 0
        END::text AS "持仓盈亏"
      FROM public.cfmmc_positions
      WHERE account_no = $1
        AND trade_date BETWEEN $2::date AND $3::date
    ) cfmmc_pos`,
  }
}

export function quantStrategyBooks(accountId: string): QuantStrategyBooks {
  const spec = quantStrategyAccount(accountId)
  if (spec?.source === "cfmmc") return cfmmcBooks()
  return MOM_BOOKS
}
