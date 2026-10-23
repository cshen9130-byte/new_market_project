/**
 * Export 投资 → FOF底层 (私募、持仓中) strategy tags.
 *
 * Usage:
 *   npx tsx scripts/ma/export_fof_underlying_strategy_tags.ts
 *   npx tsx scripts/ma/export_fof_underlying_strategy_tags.ts --no-tunnel
 *
 * Out: data/FOF底层_策略标签_YYYY-MM-DD.xlsx
 */
import fs from "fs"
import net from "net"
import path from "path"
import { spawn, type ChildProcess } from "child_process"
import * as XLSX from "xlsx"
import { strategyLevel3FromDatabase } from "@/lib/ma/strategy-level3"
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "@/lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

const SSH_HOST = "root@8.154.33.143"
const LOCAL_PORT = 5433
const REMOTE_DB = "127.0.0.1:5432"
const DEFAULT_DB_URL = `postgresql://market_user:2026SmartDashboard%21@127.0.0.1:${LOCAL_PORT}/market_data`

const HEADERS = [
  "序号",
  "产品名称",
  "备案号",
  "一级策略",
  "二级策略",
  "三级策略",
  "策略分类",
  "平台一级策略",
  "平台二级策略",
  "平台三级策略",
] as const

/**
 * Checkbox list from the 策略分类 form:
 * 股票多头 / 指数增强 / 股票多空 / 市场中性 / 股票定增 / 参与新股发行 /
 * 套利 / 日内回转 / 信用债 / 高收益债 / 可转债 / 利率债 / 现金管理 /
 * 宏观 / 组合基金 / 事件驱动 / 期货管理 / 期权 / 可持续投资 / 其他.
 * Team 一级/二级/三级 decide the bucket. Product name is used only when those tags are empty.
 */
function officialStrategyCategory(input: {
  productName: string
  l1: string | null
  l2: string | null
  l3: string | null
  platformL1: string | null
  platformL2: string | null
}): string {
  const l1 = (input.l1 || "").trim()
  const l2 = (input.l2 || "").trim()
  const l3 = (input.l3 || "").trim()
  const name = input.productName || ""
  const text = `${l1} ${l2} ${l3}`

  if (l1 === "期权策略" || l2.includes("期权")) return "期权策略"
  if (l2 === "股票市场中性") return "市场中性策略"
  if (l2 === "股票多空") return "股票多空策略"
  if (l2 === "股票T0" || /T0/.test(text)) return "日内回转策略"
  if (l1 === "股票多头" && (l2 === "指数增强" || /指增/.test(text))) return "指数增强策略"
  if (l1 === "股票多头") return "股票多头策略"
  if (l2 === "打板" || l3.includes("打板")) return "股票多头策略"
  if (l1 === "股票对冲") return "股票多头策略"
  if (l1 === "套利策略" || l2.includes("套利")) return "套利策略"
  if (l1 === "期货策略") return "期货管理策略"
  if (l2.includes("高收益债") || l1.includes("高收益债")) return "高收益债策略"
  if (l2.includes("可转债") || l1.includes("可转债")) return "可转债策略"
  if (l2.includes("利率债") || l1.includes("利率债")) return "利率债策略"
  if (l1 === "债券策略" || l2.includes("信用债")) return "信用债策略"
  if (l1.includes("现金管理")) return "现金管理类策略"
  if (/定增/.test(text)) return "股票定增策略"
  if (/打新|新股发行/.test(text)) return "参与新股发行策略"
  if (/事件驱动/.test(text)) return "事件驱动策略"
  if (/可持续|ESG/.test(text)) return "可持续投资策略"
  if (l1 === "多资产策略" || l2 === "宏观策略") return "宏观策略"
  if (/FOF|母基金/.test(name) || l2 === "FOF") return "组合基金策略"

  if (!l1 && !l2 && !l3) {
    if (/CTA/.test(name)) return "期货管理策略"
    if (/套利/.test(name)) return "套利策略"
    if (/指增|指数增强/.test(name)) return "指数增强策略"
    if (/中性/.test(name)) return "市场中性策略"
    if (/期权/.test(name)) return "期权策略"
    if (/宏观/.test(name)) return "宏观策略"
    if (/君翊驭风/.test(name)) return "股票多头策略"
    if (input.platformL1 === "期货策略") return "期货管理策略"
    if (input.platformL1 === "套利策略") return "套利策略"
    if (input.platformL2 === "指数增强" || /指增/.test(input.platformL2 || "")) return "指数增强策略"
    if (input.platformL1 === "股票多头") return "股票多头策略"
    if (input.platformL2 === "宏观策略") return "宏观策略"
  }
  return "其他"
}

function level3(value: string | null): string | null {
  const text = (value || "").trim()
  if (!text) return null
  return strategyLevel3FromDatabase(text)
}

async function waitForPort(port: number, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1")
        socket.once("connect", () => {
          socket.destroy()
          resolve()
        })
        socket.once("error", reject)
      })
      return true
    } catch {
      await new Promise((r) => setTimeout(r, 400))
    }
  }
  return false
}

async function startSshTunnel(): Promise<ChildProcess> {
  const keyPath = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".ssh", "id_ed25519_server")
  if (!fs.existsSync(keyPath)) {
    throw new Error(`SSH key not found: ${keyPath}`)
  }

  const child = spawn(
    "ssh",
    [
      "-i",
      keyPath,
      "-L",
      `${LOCAL_PORT}:${REMOTE_DB}`,
      "-N",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ExitOnForwardFailure=yes",
      SSH_HOST,
    ],
    { stdio: "ignore", windowsHide: true },
  )

  child.on("error", (err) => {
    console.error("SSH process error:", err.message)
  })

  const ready = await waitForPort(LOCAL_PORT)
  if (!ready) {
    child.kill()
    throw new Error(`SSH tunnel did not open localhost:${LOCAL_PORT} within 20s`)
  }

  console.log(`SSH tunnel ready on localhost:${LOCAL_PORT}`)
  return child
}

async function main() {
  const noTunnel = process.argv.includes("--no-tunnel")
  let tunnel: ChildProcess | null = null

  try {
    if (!process.env.DATABASE_URL?.includes(`:${LOCAL_PORT}/`)) {
      process.env.DATABASE_URL = DEFAULT_DB_URL
    }

    if (noTunnel) {
      const ready = await waitForPort(LOCAL_PORT, 3_000)
      if (!ready) {
        throw new Error(
          `--no-tunnel was passed but nothing is listening on localhost:${LOCAL_PORT}. Start the tunnel first.`,
        )
      }
    } else {
      const already = await waitForPort(LOCAL_PORT, 800)
      if (already) {
        console.log(`Using existing listener on localhost:${LOCAL_PORT}`)
      } else {
        tunnel = await startSshTunnel()
      }
    }

    const { query } = await import("@/lib/db")
    const { sqlExcludeFofUnderlyingProduct, sqlFofUnderlyingFundClassFilter } = await import(
      "@/lib/server/fund-holding-code"
    )
    const { sqlFofUnderlyingIdentityKey, sqlFofUnderlyingIdentityTiebreak } = await import(
      "@/lib/server/fof-underlying-query"
    )

    const exclude = sqlExcludeFofUnderlyingProduct("f.product_name", "cache.beian_hao")
    const fundClass = sqlFofUnderlyingFundClassFilter("private", "f.product_name", "cache.beian_hao")
    const identityKey = sqlFofUnderlyingIdentityKey("cache.beian_hao", "f.id")
    const identityTie = sqlFofUnderlyingIdentityTiebreak("f.product_name", "f.id")
    const displayNameExpr = `CASE
      WHEN cache.short_name IS NOT NULL
        AND f.product_name ~ '[ABC]类'
        AND COALESCE(cache.short_name, '') !~ '[ABC]类'
      THEN f.product_name
      ELSE COALESCE(cache.short_name, f.product_name)
    END`

    const rows = await query<{
      product_name: string
      beian_hao: string | null
      company_l1: string | null
      company_l2: string | null
      company_l3: string | null
      platform_l1: string | null
      platform_l2: string | null
      platform_l3: string | null
    }>(
      `SELECT
         product_name,
         beian_hao,
         company_l1,
         company_l2,
         company_l3,
         platform_l1,
         platform_l2,
         platform_l3
       FROM (
         SELECT DISTINCT ON (${identityKey})
           ${displayNameExpr} AS product_name,
           cache.beian_hao,
           NULLIF(BTRIM(cache.company_strategy_l1), '') AS company_l1,
           NULLIF(BTRIM(cache.company_strategy_l2), '') AS company_l2,
           NULLIF(BTRIM(cache.company_strategy_l3), '') AS company_l3,
           NULLIF(BTRIM(cache.platform_strategy_l1), '') AS platform_l1,
           NULLIF(BTRIM(cache.platform_strategy_l2), '') AS platform_l2,
           NULLIF(BTRIM(cache.platform_strategy_l3), '') AS platform_l3,
           f.sequence_no,
           MIN((f.imported_at AT TIME ZONE 'Asia/Shanghai')::date) OVER (PARTITION BY ${identityKey}) AS first_entry_date
         FROM fof_underlying_summary f
         LEFT JOIN ops_fof_overview_list_cache cache ON cache.fof_underlying_id = f.id
         WHERE f.product_name <> '合计'
           AND ${exclude}
           AND ${fundClass}
           AND COALESCE(cache.market_value, 0) > 0
         ORDER BY ${identityKey}, ${identityTie}
       ) rows
       ORDER BY first_entry_date DESC NULLS LAST, sequence_no ASC`,
    )

    console.log(`FOF底层持仓私募: ${rows.length}`)

    const aoa: (string | number | null)[][] = [Array.from(HEADERS)]
    const categoryCounts = new Map<string, number>()
    let tagged = 0
    rows.forEach((row, index) => {
      const l1 = row.company_l1
      const l2 = row.company_l2
      const l3 = level3(row.company_l3)
      if (l1 || l2 || l3) tagged++
      const category = officialStrategyCategory({
        productName: row.product_name,
        l1,
        l2,
        l3,
        platformL1: row.platform_l1,
        platformL2: row.platform_l2,
      })
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1)
      aoa.push([
        index + 1,
        row.product_name,
        (row.beian_hao || "").trim() || null,
        l1,
        l2,
        l3,
        category,
        row.platform_l1,
        row.platform_l2,
        level3(row.platform_l3),
      ])
    })

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws["!cols"] = [
      { wch: 6 },
      { wch: 42 },
      { wch: 14 },
      { wch: 16 },
      { wch: 18 },
      { wch: 28 },
      { wch: 16 },
      { wch: 16 },
      { wch: 18 },
      { wch: 28 },
    ]
    XLSX.utils.book_append_sheet(wb, ws, "策略标签")

    const outDir = path.join(process.cwd(), "data")
    fs.mkdirSync(outDir, { recursive: true })
    const outName = `FOF底层_策略标签_${new Date().toISOString().slice(0, 10)}.xlsx`
    const outPath = path.join(outDir, outName)
    XLSX.writeFile(wb, outPath)

    console.log(`有团队策略: ${tagged}  未填写: ${rows.length - tagged}`)
    for (const [category, count] of [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${category}: ${count}`)
    }
    console.log(`Wrote ${outPath}`)
  } finally {
    if (tunnel && !tunnel.killed) {
      tunnel.kill()
      console.log("SSH tunnel closed.")
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
