import pg from 'pg'
const { Client } = pg
const c = new Client({host:'127.0.0.1',port:5433,user:'market_user',password:'2026SmartDashboard!',database:'market_data'})
await c.connect()
const r = await c.query(`SELECT trade_date::text,realized_pl,mtm_pl,exercise_pl,commission,client_equity,margin_occupied FROM guosen_account_summary WHERE client_id='665300200077' ORDER BY trade_date`)
r.rows.forEach(row=>console.log(JSON.stringify(row)))
await c.end()
