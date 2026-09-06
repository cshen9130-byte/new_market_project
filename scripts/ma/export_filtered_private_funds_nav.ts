/**
 * Export the 私募基金 table (净值日期=6个月以内, same filter as the 12,196-row view)
 * plus each product's NAV history, classified into:
 *   股票/股票多头, 股票/股票对冲, 商品/主观期货, 商品/CTA, 套利
 *
 * Usage:
 *   npx tsx scripts/ma/export_filtered_private_funds_nav.ts
 *   npx tsx scripts/ma/export_filtered_private_funds_nav.ts --probe-only
 *   npx tsx scripts/ma/export_filtered_private_funds_nav.ts --no-tunnel
 */
import fs from "fs"
import net from "net"
import path from "path"
import { spawn, type ChildProcess } from "child_process"
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "@/lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

const SSH_HOST = "root@8.154.33.143"
const LOCAL_PORT = 5433
const REMOTE_DB = "127.0.0.1:5432"
const DEFAULT_DB_URL = `postgresql://market_user:2026SmartDashboard%21@127.0.0.1:${LOCAL_PORT}/market_data`

const STAMP = new Date().toISOString().slice(0, 10)
const OUT_ROOT = path.join(process.cwd(), "data", "exports", `private-funds-nav6m-${STAMP}`)

type Bucket =
  | "股票/股票多头"
  | "股票/股票对冲"
  | "商品/主观期货"
  | "商品/CTA"
  | "套利"
  | "未分类"

type FundRow = {
  beian_hao: string
  product_name: string
  manager: string | null
  inception_date: string | null
  latest_nav: string | null
  latest_nav_date: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y: string | null
  sharpe_1y: string | null
  calmar_1y: string | null
  page_strategy: string | null
  info_l1: string | null
  info_l2: string | null
  team_l1: string | null
  team_l2: string | null
  team_l3: string | null
  platform_l1: string | null
  platform_l2: string | null
  platform_l3: string | null
}

type Classified = FundRow & {
  used_l1: string
  used_l2: string
  used_l3: string
  bucket: Bucket
  reason: string
}

function waitForPort(port: number, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  return (async () => {
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
  })()
}

async function startSshTunnel(): Promise<ChildProcess> {
  const keyPath = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".ssh", "id_ed25519_server")
  if (!fs.existsSync(keyPath)) {
    throw new Error(`SSH key not found: ${keyPath}`)
  }
  const child = spawn(
    "ssh",
    [
      "-i", keyPath,
      "-L", `${LOCAL_PORT}:${REMOTE_DB}`,
      "-N",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "ExitOnForwardFailure=yes",
      SSH_HOST,
    ],
    { stdio: "ignore", windowsHide: true },
  )
  child.on("error", (err) => console.error("SSH process error:", err.message))
  const ready = await waitForPort(LOCAL_PORT)
  if (!ready) {
    child.kill()
    throw new Error(`SSH tunnel did not open localhost:${LOCAL_PORT} within 20s`)
  }
  console.log(`SSH tunnel ready on localhost:${LOCAL_PORT}`)
  return child
}

function trim(v: unknown): string {
  const s = v == null ? "" : String(v).trim()
  return s === "-" ? "" : s
}

function csvEscape(v: string | null | undefined): string {
  const s = v == null ? "" : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s
}

function safeFilePart(name: string, max = 60): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "")
    .replace(/\.+$/g, "")
    .trim()
  return (cleaned || "unnamed").slice(0, max)
}

function preferTeamThenPage(row: FundRow): { l1: string; l2: string; l3: string; source: string } {
  if (row.team_l1 || row.team_l2 || row.team_l3) {
    return { l1: trim(row.team_l1), l2: trim(row.team_l2), l3: trim(row.team_l3), source: "团队策略" }
  }
  if (row.info_l1 || row.info_l2) {
    return { l1: trim(row.info_l1 || row.page_strategy), l2: trim(row.info_l2), l3: "", source: "页面策略" }
  }
  if (row.platform_l1 || row.platform_l2 || row.platform_l3) {
    return { l1: trim(row.platform_l1), l2: trim(row.platform_l2), l3: trim(row.platform_l3), source: "平台策略" }
  }
  return { l1: trim(row.page_strategy), l2: "", l3: "", source: "无标签" }
}

function classify(row: FundRow): Classified {
  const used = preferTeamThenPage(row)
  const labeled = `${used.l1} ${used.l2} ${used.l3}`
  const name = trim(row.product_name)
  const labeledNorm = labeled.replace(/\s+/g, "")

  const hit = (re: RegExp, text = labeledNorm) => re.test(text)

  let bucket: Bucket = "未分类"
  let reason = used.source

  if (hit(/套利/)) {
    bucket = "套利"
    reason = `${used.source}: 标签含套利`
  } else if (hit(/主观期货|主观CTA|主观商品|主观管理期货/i)) {
    bucket = "商品/主观期货"
    reason = `${used.source}: 主观期货`
  } else if (hit(/股票对冲|市场中性|量化对冲|中性策略/) || used.l1 === "股票对冲") {
    bucket = "股票/股票对冲"
    reason = `${used.source}: 股票对冲`
  } else if (hit(/股票多头|指数增强|量化选股|量化多头|主观多头/) || used.l1 === "股票多头") {
    bucket = "股票/股票多头"
    reason = `${used.source}: 股票多头`
  } else if (used.l1 === "股票策略" || hit(/股票策略/)) {
    if (hit(/对冲|中性/, name) || hit(/对冲|中性/, used.l2 + used.l3)) {
      bucket = "股票/股票对冲"
      reason = `${used.source}: 股票策略+对冲/中性`
    } else {
      bucket = "股票/股票多头"
      reason = `${used.source}: 股票策略→股票多头`
    }
  } else if (used.l1 === "CTA" || hit(/量化CTA|管理期货|程序化期货|\bCTA\b|cta/i) || used.l1 === "期货策略") {
    if (hit(/主观/, name) && !hit(/量化|CTA|程序化/i, name)) {
      bucket = "商品/主观期货"
      reason = `${used.source}: 期货+名称含主观`
    } else {
      bucket = "商品/CTA"
      reason = used.l1 === "期货策略" && !hit(/CTA|量化CTA/i)
        ? `${used.source}: 期货策略默认CTA`
        : `${used.source}: CTA/管理期货`
    }
  } else if (hit(/套利/, name)) {
    bucket = "套利"
    reason = "名称含套利（无明确非套利标签）"
  } else if (hit(/主观/, name) && hit(/期货|商品|CTA/i, name)) {
    bucket = "商品/主观期货"
    reason = "名称推断主观期货"
  } else if (hit(/CTA|量化期货|程序化/i, name)) {
    bucket = "商品/CTA"
    reason = "名称推断CTA"
  } else if (hit(/对冲|中性/, name)) {
    bucket = "股票/股票对冲"
    reason = "名称推断股票对冲"
  } else if (hit(/多头|指增|增强|选股/, name)) {
    bucket = "股票/股票多头"
    reason = "名称推断股票多头"
  } else {
    reason = `${used.source || "无标签"}: 无法归入股票/商品/套利`
  }

  return {
    ...row,
    used_l1: used.l1,
    used_l2: used.l2,
    used_l3: used.l3,
    bucket,
    reason,
  }
}

function folderFor(bucket: Bucket): string {
  return bucket
}

async function tableColumns(query: <T>(sql: string, params?: unknown[]) => Promise<T[]>, table: string): Promise<Set<string>> {
  const rows = await query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  )
  return new Set(rows.map((r) => r.column_name))
}

function pickCol(cols: Set<string>, candidates: string[]): string | null {
  for (const c of candidates) if (cols.has(c)) return c
  return null
}

function writeUtf8Csv(filePath: string, header: string[], rows: string[][]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const lines = [header.map(csvEscape).join(","), ...rows.map((r) => r.map(csvEscape).join(","))]
  fs.writeFileSync(filePath, `\uFEFF${lines.join("\n")}\n`, "utf8")
}

async function main() {
  const probeOnly = process.argv.includes("--probe-only")
  const noTunnel = process.argv.includes("--no-tunnel")
  let tunnel: ChildProcess | null = null

  try {
    if (!process.env.DATABASE_URL?.includes(`:${LOCAL_PORT}/`)) {
      process.env.DATABASE_URL = DEFAULT_DB_URL
    }

    if (noTunnel) {
      const ready = await waitForPort(LOCAL_PORT, 3_000)
      if (!ready) {
        throw new Error(`--no-tunnel was passed but nothing is listening on localhost:${LOCAL_PORT}`)
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

    const infoCols = await tableColumns(query, "private_fund_info")
    const navCols = await tableColumns(query, "private_fund_nav")
    const teamExists = (await tableColumns(query, "type6_ops_team_full")).size > 0

    console.log("private_fund_info columns:", [...infoCols].sort().join(", "))
    console.log("private_fund_nav columns:", [...navCols].sort().join(", "))

    const l2Col = infoCols.has("strategy_l2") ? "i.strategy_l2" : "NULL::text"
    const teamJoin = teamExists
      ? "LEFT JOIN type6_ops_team_full t ON t.register_number = i.beian_hao"
      : ""
    const teamSelect = teamExists
      ? `NULLIF(BTRIM(t.company_strategy_one), '') AS team_l1,
         NULLIF(BTRIM(t.company_strategy_two), '') AS team_l2,
         NULLIF(BTRIM(t.company_strategy_three), '') AS team_l3,
         NULLIF(BTRIM(t.platform_strategy_one), '') AS platform_l1,
         NULLIF(BTRIM(t.platform_strategy_two), '') AS platform_l2,
         NULLIF(BTRIM(t.platform_strategy_three), '') AS platform_l3`
      : `NULL::text AS team_l1, NULL::text AS team_l2, NULL::text AS team_l3,
         NULL::text AS platform_l1, NULL::text AS platform_l2, NULL::text AS platform_l3`

    const funds = await query<FundRow>(
      `SELECT
         i.beian_hao,
         i.product_name,
         i.manager,
         i.inception_date::text AS inception_date,
         i.latest_nav::text AS latest_nav,
         i.latest_nav_date::text AS latest_nav_date,
         i.ret_1w::text AS ret_1w,
         i.ret_1m::text AS ret_1m,
         i.ret_3m::text AS ret_3m,
         i.ret_6m::text AS ret_6m,
         i.ret_1y::text AS ret_1y,
         i.sharpe_1y::text AS sharpe_1y,
         i.calmar_1y::text AS calmar_1y,
         i.strategy_l1 AS page_strategy,
         i.strategy_l1 AS info_l1,
         ${l2Col} AS info_l2,
         ${teamSelect}
       FROM private_fund_info i
       ${teamJoin}
       WHERE i.latest_nav_date >= CURRENT_DATE - INTERVAL '6 months'
       ORDER BY i.inception_date DESC NULLS LAST, i.beian_hao`,
    )

    console.log(`Filtered funds (净值日期 6个月以内): ${funds.length}`)

    const classified = funds.map(classify)
    const counts = new Map<Bucket, number>()
    const labelCounts = new Map<string, number>()
    for (const row of classified) {
      counts.set(row.bucket, (counts.get(row.bucket) ?? 0) + 1)
      const key = `${row.used_l1 || "(空)"} | ${row.used_l2 || "(空)"}`
      labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1)
    }

    console.log("\n=== Classification counts ===")
    for (const [bucket, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${bucket}: ${n}`)
    }
    console.log("\n=== Used labels (top 40) ===")
    for (const [label, n] of [...labelCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
      console.log(`  ${n.toString().padStart(5)}  ${label}`)
    }

    if (probeOnly) return

    console.log("Preparing output folder...")
    const dateCol = pickCol(navCols, ["price_date", "nav_date", "trade_date", "date"])
    const navCol = pickCol(navCols, ["nav", "unit_nav", "nav_value", "net_value"])
    const cumCol = pickCol(navCols, ["cumulative_nav", "cum_nav", "acc_nav", "accumulated_nav"])
    if (!dateCol || !navCol) {
      throw new Error(`private_fund_nav missing date/nav columns. Have: ${[...navCols].join(", ")}`)
    }
    console.log(`NAV columns: date=${dateCol} nav=${navCol} cum=${cumCol ?? "none"}`)

    fs.mkdirSync(path.dirname(OUT_ROOT), { recursive: true })
    if (fs.existsSync(OUT_ROOT)) fs.rmSync(OUT_ROOT, { recursive: true, force: true })
    fs.mkdirSync(OUT_ROOT, { recursive: true })
    console.log(`Output: ${OUT_ROOT}`)

    const buckets: Bucket[] = [
      "股票/股票多头",
      "股票/股票对冲",
      "商品/主观期货",
      "商品/CTA",
      "套利",
      "未分类",
    ]
    for (const bucket of buckets) {
      fs.mkdirSync(path.join(OUT_ROOT, folderFor(bucket)), { recursive: true })
    }

    console.log("Writing product index...")
    writeUtf8Csv(
      path.join(OUT_ROOT, "_产品清单.csv"),
      [
        "分类一级", "分类二级", "分类路径", "分类依据",
        "备案号", "产品名称", "管理人", "成立日期",
        "使用一级策略", "使用二级策略", "使用三级策略",
        "页面策略", "团队一级", "团队二级", "团队三级",
        "平台一级", "平台二级", "平台三级",
        "最新净值", "净值日期",
        "近1周", "近1月", "近3月", "近6月", "近1年", "夏普1Y", "卡玛1Y",
        "净值文件",
      ],
      classified.map((r) => {
        const [l1, l2] = r.bucket.includes("/") ? r.bucket.split("/") : [r.bucket, r.bucket]
        const fileName = `${safeFilePart(r.beian_hao, 20)}_${safeFilePart(r.product_name)}.csv`
        return [
          l1, l2, r.bucket, r.reason,
          r.beian_hao, r.product_name, r.manager ?? "", r.inception_date ?? "",
          r.used_l1, r.used_l2, r.used_l3,
          r.page_strategy ?? "", r.team_l1 ?? "", r.team_l2 ?? "", r.team_l3 ?? "",
          r.platform_l1 ?? "", r.platform_l2 ?? "", r.platform_l3 ?? "",
          r.latest_nav ?? "", r.latest_nav_date ?? "",
          r.ret_1w ?? "", r.ret_1m ?? "", r.ret_3m ?? "", r.ret_6m ?? "", r.ret_1y ?? "",
          r.sharpe_1y ?? "", r.calmar_1y ?? "",
          path.posix.join(folderFor(r.bucket), fileName),
        ]
      }),
    )

    writeUtf8Csv(
      path.join(OUT_ROOT, "_分类汇总.csv"),
      ["分类路径", "产品数"],
      [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh")).map(([k, v]) => [k, String(v)]),
    )

    const readme = [
      "私募基金筛选导出（净值日期：6个月以内）",
      `导出日期：${STAMP}`,
      `产品数：${classified.length}`,
      "",
      "筛选口径：与基金数据库 → 私募基金页一致，净值日期=6个月以内，一级策略不限。",
      "",
      "分类规则（优先团队策略，否则用页面/平台策略）：",
      "1. 标签含「套利」→ 套利（股票套利、期货套利等全部进套利）",
      "2. 主观期货 / 主观CTA → 商品/主观期货",
      "3. 股票对冲 / 市场中性 → 股票/股票对冲",
      "4. 股票多头 / 指数增强 / 量化选股，或一级=股票策略 → 股票/股票多头",
      "5. CTA / 管理期货 / 期货策略 → 商品/CTA（名称仅含「主观」且不含量化/CTA 时进主观期货）",
      "6. 其余（债券、期权、多资产、组合、无标签等）→ 未分类",
      "",
      "每个产品一个 CSV：日期, 单位净值, 累计净值(如有), 日涨跌(由单位净值推算)。",
      "根目录 _产品清单.csv 是整张筛选表 + 分类映射。",
    ].join("\n")
    fs.writeFileSync(path.join(OUT_ROOT, "_说明.txt"), `${readme}\n`, "utf8")

    const byBeian = new Map(classified.map((r) => [r.beian_hao, r]))
    const ids = classified.map((r) => r.beian_hao)
    console.log("Fetching NAV history in batches...")
    const BATCH = 80
    let written = 0
    let emptyHist = 0
    const navHeader = cumCol
      ? ["日期", "单位净值", "累计净值", "日涨跌"]
      : ["日期", "单位净值", "日涨跌"]

    type NavRow = { beian_hao: string; price_date: string; nav: string; cum_nav: string | null }
    const cumSql = cumCol ? `${cumCol}::text` : "NULL::text"

    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH)
      const navRows = await query<NavRow>(
        `SELECT beian_hao,
                ${dateCol}::text AS price_date,
                ${navCol}::text AS nav,
                ${cumSql} AS cum_nav
         FROM private_fund_nav
         WHERE beian_hao = ANY($1::text[])
           AND ${navCol} IS NOT NULL
         ORDER BY beian_hao, ${dateCol}`,
        [batch],
      )

      const grouped = new Map<string, NavRow[]>()
      for (const row of navRows) {
        const list = grouped.get(row.beian_hao)
        if (list) list.push(row)
        else grouped.set(row.beian_hao, [row])
      }

      for (const beian of batch) {
        const fund = byBeian.get(beian)
        if (!fund) continue
        const series = grouped.get(beian) ?? []
        const fileName = `${safeFilePart(beian, 20)}_${safeFilePart(fund.product_name)}.csv`
        const dest = path.join(OUT_ROOT, folderFor(fund.bucket), fileName)

        const csvRows: string[][] = []
        let prev: number | null = null
        for (const pt of series) {
          const nav = parseFloat(pt.nav)
          let chg = ""
          if (Number.isFinite(nav) && prev != null && prev !== 0) {
            chg = ((nav / prev) - 1).toFixed(8)
          }
          if (Number.isFinite(nav)) prev = nav
          const date = String(pt.price_date ?? "").slice(0, 10)
          csvRows.push(cumCol ? [date, pt.nav, pt.cum_nav ?? "", chg] : [date, pt.nav, chg])
        }
        writeUtf8Csv(dest, navHeader, csvRows)
        written += 1
        if (series.length === 0) emptyHist += 1
      }

      const done = Math.min(i + BATCH, ids.length)
      if (done % 1000 < BATCH || done === ids.length) {
        console.log(`  NAV files ${done}/${ids.length}`)
      }
    }

    const summary = [
      `产品清单: ${classified.length}`,
      `已写净值文件: ${written}`,
      `无净值序列: ${emptyHist}`,
      `输出目录: ${OUT_ROOT}`,
      ...[...counts.entries()].map(([k, v]) => `  ${k}: ${v}`),
    ]
    console.log(summary.join("\n"))
    fs.writeFileSync(path.join(OUT_ROOT, "_导出日志.txt"), `${summary.join("\n")}\n`, "utf8")
  } finally {
    if (tunnel) tunnel.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
