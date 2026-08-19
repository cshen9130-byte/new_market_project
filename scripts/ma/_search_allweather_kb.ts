/**
 * Search AI knowledge base (kb_chunks) for all-weather strategy asset allocation weights.
 * Usage: npx tsx scripts/ma/_search_allweather_kb.ts
 * Opens SSH tunnel to DB on :5433 if needed (same key/host as other scripts/ma exports).
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
  const ready = await waitForPort(LOCAL_PORT)
  if (!ready) {
    child.kill()
    throw new Error(`SSH tunnel did not open localhost:${LOCAL_PORT}`)
  }
  console.log(`SSH tunnel ready on localhost:${LOCAL_PORT}`)
  return child
}

const KEYWORDS = [
  "全天候",
  "All Weather",
  "AllWeather",
  "风险平价",
  "Risk Parity",
  "风险预算",
  "大类资产配置",
  "资产配比",
]

function extractWindows(text: string, patterns: string[], radius = 180): string[] {
  const lower = text.toLowerCase()
  const windows: string[] = []
  for (const p of patterns) {
    const needle = p.toLowerCase()
    let from = 0
    while (windows.length < 6) {
      const idx = lower.indexOf(needle, from)
      if (idx < 0) break
      const start = Math.max(0, idx - radius)
      const end = Math.min(text.length, idx + needle.length + radius)
      const w = text.slice(start, end).replace(/\s+/g, " ").trim()
      if (w && !windows.some((x) => x.includes(w) || w.includes(x))) windows.push(w)
      from = idx + needle.length
    }
  }
  return windows
}

async function main() {
  const tunnel = await ensureTunnel()
  try {
  const { query } = await import("../../lib/db")
  const patterns = KEYWORDS
  const likeParams = patterns.map((k) => `%${k}%`)
  const contentOr = patterns.map((_, i) => `content ILIKE $${i + 1}`).join(" OR ")
  const sourceOr = patterns.map((_, i) => `source ILIKE $${i + 1}`).join(" OR ")

  // contentOr and sourceOr share the same $1..$N placeholders / params.
  const whereSql = `(${contentOr}) OR (${sourceOr})`

  const countRows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM kb_chunks WHERE ${whereSql}`,
    likeParams,
  )
  const total = Number(countRows[0]?.n || 0)
  console.log(`kb_chunks matches: ${total}`)

  // Prefer chunks that mention allocation / weights / percentages near all-weather
  const rows = await query<{
    scope: string
    source: string
    snippet: string
  }>(
    `SELECT scope, source, LEFT(content, 2200) AS snippet
     FROM kb_chunks
     WHERE ${whereSql}
     ORDER BY
       CASE
         WHEN content ILIKE '%权重%' OR content ILIKE '%配比%' OR content ILIKE '%配置%' THEN 0
         WHEN content ILIKE '%风险平价%' OR content ILIKE '%全天候%' THEN 1
         ELSE 2
       END,
       CASE WHEN source ILIKE '%内部尽调%' OR source ILIKE '%路演%' THEN 0 ELSE 1 END,
       source
     LIMIT 400`,
    likeParams,
  )

  const bySource = new Map<
    string,
    { scope: string; source: string; snippets: string[]; windows: string[] }
  >()

  for (const r of rows) {
    const windows = extractWindows(r.snippet || "", patterns)
    const existing = bySource.get(r.source)
    if (existing) {
      if (existing.snippets.length < 4) existing.snippets.push(r.snippet)
      for (const w of windows) {
        if (existing.windows.length < 8 && !existing.windows.includes(w)) existing.windows.push(w)
      }
      continue
    }
    bySource.set(r.source, {
      scope: r.scope,
      source: r.source,
      snippets: [r.snippet],
      windows,
    })
  }

  // Also pull filename hits that may not have keyword in content yet
  const fileHits = await query<{ source: string; n: string }>(
    `SELECT source, COUNT(*)::text AS n
     FROM kb_chunks
     WHERE ${sourceOr}
     GROUP BY source
     ORDER BY COUNT(*) DESC
     LIMIT 100`,
    likeParams,
  )

  const out = {
    searchedAt: new Date().toISOString(),
    keywords: KEYWORDS,
    totalChunkMatches: total,
    uniqueSources: bySource.size,
    fileNameHits: fileHits,
    sources: [...bySource.values()].sort((a, b) => b.windows.length - a.windows.length),
  }

  const outPath = path.join(process.cwd(), "scripts", "ma", "_allweather_kb_hits.json")
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8")
  console.log(`unique sources: ${out.uniqueSources}`)
  console.log(`wrote ${outPath}`)
  for (const s of out.sources.slice(0, 30)) {
    console.log(`- ${s.source} | windows=${s.windows.length}`)
  }
  } finally {
    tunnel?.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
