import psycopg2
conn = psycopg2.connect("postgresql://market_user:2026SmartDashboard!@127.0.0.1:5433/market_data")
cur = conn.cursor()

cur.execute("""
WITH
amounts AS (
  SELECT
    "账户", "交易日期", "方向", "说明",
    (NULLIF(REPLACE(REPLACE(COALESCE("最大允许亏损金额",''),',',''),' ',''),''))::numeric AS amount
  FROM mom_daily_report_fund_flows
),
labeled_structural_out AS (
  SELECT DISTINCT lo."账户", lo."交易日期", lo.amount
  FROM amounts lo
  WHERE lo."方向" = '转出'
    AND COALESCE(lo."说明",'') != '【出入金】'
    AND EXISTS (
      SELECT 1 FROM amounts i
      WHERE i."账户" = lo."账户"
        AND i."交易日期" = lo."交易日期"
        AND i."方向" = '转入'
        AND i.amount = lo.amount
    )
),
daily_flow AS (
  SELECT
    a."账户", a."交易日期",
    SUM(CASE WHEN a."方向" = '转入' THEN a.amount ELSE 0 END)
    - SUM(CASE WHEN a."方向" = '转出' AND COALESCE(a."说明",'') = '【出入金】' THEN a.amount ELSE 0 END)
    - COALESCE((
        SELECT SUM(lso.amount) FROM labeled_structural_out lso
        WHERE lso."账户" = a."账户" AND lso."交易日期" = a."交易日期"
      ), 0)
    AS net_amount,
    SUM(CASE WHEN a."方向" = '转出' AND COALESCE(a."说明",'') != '【出入金】' THEN a.amount ELSE 0 END)
    - COALESCE((
        SELECT SUM(lso.amount) FROM labeled_structural_out lso
        WHERE lso."账户" = a."账户" AND lso."交易日期" = a."交易日期"
      ), 0)
    AS real_withdrawal_amount
  FROM amounts a
  GROUP BY a."账户", a."交易日期"
)
SELECT
  "账户" AS account,
  SUM(CASE WHEN net_amount > 0 THEN net_amount ELSE 0 END) AS cum_deposit,
  -SUM(real_withdrawal_amount) AS cum_withdrawal
FROM daily_flow
GROUP BY "账户"
ORDER BY "账户"
""")
print("account | cum_deposit | cum_withdrawal")
for r in cur.fetchall(): print(r)
conn.close()
