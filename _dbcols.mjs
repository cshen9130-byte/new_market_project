import pg from 'pg'
const pool = new pg.Pool({ connectionString: 'postgresql://market_user:2026SmartDashboard!@127.0.0.1:5433/market_data' })
// Test exact product-nav formula (net of fees)
const r = await pool.query(`
  WITH daily_pnl AS (
    SELECT
      "交易日期"::date AS date,
      SUM(
        COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("当日盈亏",''),',',''),' ',''),'')::numeric, 0)
        - COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("当日手续费",''),',',''),' ',''),'')::numeric, 0)
        + COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("权利金收入",''),',',''),' ',''),'')::numeric, 0)
        - COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("权利金支出",''),',',''),' ',''),'')::numeric, 0)
      ) AS day_pnl
    FROM mom_daily_reports
    GROUP BY "交易日期"::date
  ),
  fund_flows AS (
    SELECT
      confirmation_date::date AS date,
      SUM(CASE
        WHEN transaction_type IN ('认购确认','申购确认') THEN
          COALESCE(confirmed_amount,0) - COALESCE(handling_fee,0) - COALESCE(performance_fee,0)
        WHEN transaction_type = '赎回确认' THEN
          -(COALESCE(confirmed_amount,0) - COALESCE(handling_fee,0) - COALESCE(performance_fee,0))
        ELSE 0
      END) AS net_flow
    FROM mom_fund_transactions
    WHERE transaction_type IN ('认购确认','申购确认','赎回确认')
    GROUP BY confirmation_date::date
  ),
  all_dates AS (SELECT date FROM daily_pnl UNION SELECT date FROM fund_flows),
  combined AS (
    SELECT d.date,
      COALESCE(p.day_pnl, 0) AS day_pnl,
      COALESCE(f.net_flow, 0) AS net_flow
    FROM all_dates d
    LEFT JOIN daily_pnl p ON p.date = d.date
    LEFT JOIN fund_flows f ON f.date = d.date
  ),
  running AS (
    SELECT date,
      SUM(net_flow + day_pnl) OVER (ORDER BY date ROWS UNBOUNDED PRECEDING) AS fund_nav
    FROM combined
  )
  SELECT date::text, ROUND(fund_nav) AS fund_nav FROM running ORDER BY date DESC LIMIT 5
`)
console.log(r.rows)
await pool.end()
