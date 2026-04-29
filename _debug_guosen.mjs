import pg from 'pg'
const { Pool } = pg
const pool = new Pool({ connectionString: 'postgresql://market_user:2026SmartDashboard!@127.0.0.1:5433/market_data' })

try {
  const r = await pool.query("SELECT client_id, client_name, trade_date::text, realized_pl, mtm_pl, exercise_pl, commission FROM guosen_account_summary ORDER BY trade_date DESC LIMIT 10")
  console.log("guosen_account_summary rows:", JSON.stringify(r.rows, null, 2))
  console.log("total rows in table:", (await pool.query("SELECT COUNT(*) FROM guosen_account_summary")).rows[0].count)
} catch(e) {
  console.log("ERROR:", e.message)
}
await pool.end()

