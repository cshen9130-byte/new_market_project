import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"

loadProjectEnvFiles()

const TO_ADD = [
  "笃熙禀泰文艺复兴16号",
  "富善投资星牛1号B类",
  "格上安盈2号私募",
  "古曲祥辰5号",
  "衡颐海岳1号",
  "君得安星牛1号B类",
  "明汯中性6号1期",
  "天戈钻选CTA1号",
  "致邃投资-优孚1号A类",
  "纵贯白马成长2号",
]

async function main() {
  const pool = await query<{ product_name: string; register_number: string }>(
    `SELECT product_name, register_number FROM user_custom_pool WHERE pool_key = 'custom_email_nav'`,
  )
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase()
  const inPool = new Set(pool.map((r) => norm(r.product_name)))

  console.log("Pool count:", pool.length)
  for (const name of TO_ADD) {
    const hit = pool.find((r) => norm(r.product_name) === norm(name))
    console.log(hit ? `OK  ${name} (${hit.register_number})` : `MISS ${name}`)
  }
}

main().catch(console.error)
