import pg from 'pg'
const { Client } = pg
const c = new Client({ connectionString: 'postgresql://market_user:2026SmartDashboard!@127.0.0.1:5433/market_data' })
await c.connect()
// Check columns and sample data
const r = await c.query(`SELECT settlement_date, instrument, bs, market_val, position_lots FROM guosen_position_detail LIMIT 10`)
console.log('sample rows:', JSON.stringify(r.rows, null, 2))
// Check distinct dates
const r2 = await c.query(`SELECT DISTINCT settlement_date FROM guosen_position_detail ORDER BY settlement_date`)
console.log('dates:', r2.rows.map(r=>r.settlement_date))
await c.end()
