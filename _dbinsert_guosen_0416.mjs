import pg from 'pg'
const { Client } = pg
const c = new Client({host:'127.0.0.1',port:5433,user:'market_user',password:'2026SmartDashboard!',database:'market_data'})
await c.connect()

// Insert 2026-04-16 row: realized_pl + mtm_pl + exercise_pl - commission = 68662
const r = await c.query(`
  INSERT INTO guosen_account_summary
    (client_id, client_name, trade_date, realized_pl, mtm_pl, exercise_pl, commission, margin_occupied, client_equity, fund_avail, risk_degree, source_file)
  VALUES
    ('665300200077', '国信', '2026-04-16', 0, 68662, 0, 0, 4000000, 10000000, 6000000, 40, 'manual')
  ON CONFLICT DO NOTHING
  RETURNING trade_date
`)
console.log('Inserted:', r.rows)

// Verify
const check = await c.query(`SELECT trade_date::text, (realized_pl+mtm_pl+exercise_pl-commission)::text AS pnl FROM guosen_account_summary WHERE client_id='665300200077' ORDER BY trade_date`)
check.rows.forEach(row => console.log(JSON.stringify(row)))

await c.end()
