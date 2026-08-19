/**
 * Focused second-pass: extract institution asset-weight snippets from kb_chunks.
 * Keeps SSH tunnel open until done.
 */
import fs from "fs"
import net from "net"
import path from "path"
import { spawn, type ChildProcess } from "child_process"
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

const SSH_HOST = "root@8.154.33.143"
const LOCAL_PORT = 5433
const REMOTE_DB = "127.0.0.1:5432"
const DEFAULT_DB_URL = `postgresql://market_user:2026SmartDashboard%21@127.0.0.1:${LOCAL_PORT}/market_data`

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

async function ensureTunnel(): Promise<ChildProcess | null> {
  if (!process.env.DATABASE_URL?.includes(`:${LOCAL_PORT}/`)) {
    process.env.DATABASE_URL = DEFAULT_DB_URL
  }
  if (await waitForPort(LOCAL_PORT, 800)) {
    console.log(`Using existing listener on localhost:${LOCAL_PORT}`)
    return null
  }
  const keyPath = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".ssh", "id_ed25519_server")
  if (!fs.existsSync(keyPath)) throw new Error(`SSH key not found: ${keyPath}`)
  const child = spawn(
    "ssh",
    [
      "-i", keyPath, "-L", `${LOCAL_PORT}:${REMOTE_DB}`, "-N",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "ExitOnForwardFailure=yes",
      SSH_HOST,
    ],
    { stdio: "ignore", windowsHide: true },
  )
  if (!(await waitForPort(LOCAL_PORT))) {
    child.kill()
    throw new Error("SSH tunnel failed")
  }
  console.log("SSH tunnel ready")
  return child
}

function institutionFromSource(source: string): string {
  const base = source.replace(/\\/g, "/").split("/").pop() || source
  // Prefer folder manager names like 2026.6.10-东恺
  const folder = source.match(/内部尽调资料\/([^/]+)\//)?.[1]
  if (folder) {
    const m = folder.match(/^\d{4}\.\d{1,2}\.\d{1,2}[-_](.+)$/)
    return (m?.[1] || folder).trim()
  }
  const known = [
    "桥水", "波克", "东恺", "坤复", "蜂起", "卓尚", "雪球", "元康", "从容", "仁布",
    "锐联", "道昆", "恒立", "交睿", "天泉证道", "宽桥", "汉鸿", "华兴", "思达星汇",
    "鋆晟", "德乾", "全天候", "量创", "尚艺", "九轩", "佳泽", "澜音", "诚远",
  ]
  for (const k of known) {
    if (source.includes(k) || base.includes(k)) return k
  }
  return base.slice(0, 40)
}

async function main() {
  const tunnel = await ensureTunnel()
  process.on("exit", () => tunnel?.kill())
  try {
    const { query } = await import("../../lib/db")

    // Tight filter: must mention all-weather/risk-parity AND weight/allocation language
    const rows = await query<{ scope: string; source: string; content: string }>(
      `SELECT scope, source, content
       FROM kb_chunks
       WHERE (
         content ILIKE '%全天候%' OR content ILIKE '%All Weather%' OR content ILIKE '%AllWeather%'
         OR content ILIKE '%风险平价%' OR content ILIKE '%Risk Parity%' OR content ILIKE '%风险预算%'
       )
       AND (
         content ILIKE '%权重%' OR content ILIKE '%配比%' OR content ILIKE '%仓位%'
         OR content ILIKE '%配置%' OR content ~ '[0-9]{1,2}([.][0-9]+)?%'
       )
       ORDER BY
         CASE WHEN source ILIKE '%内部尽调%' THEN 0 ELSE 1 END,
         source
       LIMIT 600`,
    )

    console.log("focused rows", rows.length)

    const byInst = new Map<
      string,
      { institution: string; sources: Set<string>; excerpts: string[] }
    >()

    const pctWindow =
      /.{0,60}(?:权重|配比|仓位|配置|风险预算|风险贡献|股债|股票|债券|商品|黄金|国债|权益|固收|CTA|货币|信用|久期).{0,80}\d{1,2}(?:\.\d+)?%.{0,80}|.{0,60}\d{1,2}(?:\.\d+)?%.{0,80}(?:权重|配比|仓位|配置|股票|债券|商品|黄金|国债|权益|固收|CTA).{0,60}/gi

    for (const r of rows) {
      const inst = institutionFromSource(r.source)
      if (!byInst.has(inst)) {
        byInst.set(inst, { institution: inst, sources: new Set(), excerpts: [] })
      }
      const g = byInst.get(inst)!
      g.sources.add(r.source)
      const text = (r.content || "").replace(/\s+/g, " ")
      const matches = text.match(pctWindow) || []
      for (const m of matches) {
        const clean = m.trim()
        if (clean.length < 20) continue
        if (!g.excerpts.some((e) => e.includes(clean) || clean.includes(e))) {
          if (g.excerpts.length < 12) g.excerpts.push(clean)
        }
      }
      // Also keep short direct sentences with 全天候 + %
      if (g.excerpts.length < 12 && /全天候|风险平价|风险预算/.test(text) && /\d{1,2}(?:\.\d+)?%/.test(text)) {
        const sentences = text.split(/[。；;\n]/).filter(
          (s) =>
            /全天候|风险平价|风险预算|权重|配比|配置/.test(s) &&
            /\d{1,2}(?:\.\d+)?%/.test(s),
        )
        for (const s of sentences) {
          const clean = s.trim()
          if (clean.length < 15 || clean.length > 280) continue
          if (!g.excerpts.some((e) => e.includes(clean) || clean.includes(e))) {
            if (g.excerpts.length < 12) g.excerpts.push(clean)
          }
        }
      }
    }

    const institutions = [...byInst.values()]
      .map((g) => ({
        institution: g.institution,
        sourceCount: g.sources.size,
        sources: [...g.sources].slice(0, 8),
        excerpts: g.excerpts,
      }))
      .filter((g) => g.excerpts.length > 0)
      .sort((a, b) => b.excerpts.length - a.excerpts.length || b.sourceCount - a.sourceCount)

    const out = {
      searchedAt: new Date().toISOString(),
      focusedRowCount: rows.length,
      institutionCount: institutions.length,
      institutions,
    }
    const outPath = path.join(process.cwd(), "scripts", "ma", "_allweather_weights.json")
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8")
    console.log(`wrote ${outPath}`)
    console.log(`institutions with weight excerpts: ${institutions.length}`)
    for (const g of institutions.slice(0, 40)) {
      console.log(`\n=== ${g.institution} (${g.sourceCount} sources, ${g.excerpts.length} excerpts) ===`)
      for (const e of g.excerpts.slice(0, 5)) console.log(" -", e)
    }
  } finally {
    tunnel?.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
