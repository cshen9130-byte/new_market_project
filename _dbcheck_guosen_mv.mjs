import pg from 'pg'
const { Client } = pg
const c = new Client({ connectionString: 'postgresql://market_user:2026SmartDashboard!@127.0.0.1:5433/market_data' })
await c.connect()
const r = await c.query(`
  SELECT settlement_date::text AS date, UPPER(TRIM(instrument)) AS contract,
    SUM(CASE WHEN bs='买' THEN COALESCE(position_lots,0)*COALESCE(settl_today,0)
             ELSE -COALESCE(position_lots,0)*COALESCE(settl_today,0) END)::text AS mv
  FROM guosen_position_detail
  GROUP BY settlement_date, UPPER(TRIM(instrument))
  ORDER BY 1 LIMIT 10
`)
console.log(JSON.stringify(r.rows, null, 2))
await c.end()
