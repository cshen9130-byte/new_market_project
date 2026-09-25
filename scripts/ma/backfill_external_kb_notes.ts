/**
 * Create one 团队笔记 per embedded file in the three external DD folders.
 * Text comes from kb_chunks (already extracted). qwen-plus only writes the
 * title and HTML summary. Author is 外部笔记, not auto.
 *
 *   npx tsx scripts/ma/backfill_external_kb_notes.ts --dry-run
 *   npx tsx scripts/ma/backfill_external_kb_notes.ts --limit=2
 *   npx tsx scripts/ma/backfill_external_kb_notes.ts
 */

import fs from "fs"
import path from "path"
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "@/lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

const AUTHOR = "外部笔记"
const BUDGET_RMB = 14
const PRICE_IN_PER_TOKEN = 0.8 / 1_000_000
const PRICE_OUT_PER_TOKEN = 2 / 1_000_000
const MAX_TEXT = 12_000
const OVERLAP = 180
const PREFIXES = [
  "外部尽调资料/点睛炎究所/",
  "外部尽调资料/点睛研究所/",
  "外部尽调资料/Beny的尽调笔记本/",
  "外部尽调资料/喵财君带你一起去探店/",
  "外部尽调资料/喵才君带你一起去探店/",
]

type Progress = {
  spentRmb: number
  promptTokens: number
  completionTokens: number
  done: string[]
  failed: Array<{ source: string; error: string }>
}

function progressPath() {
  return path.resolve(process.cwd(), "..", "market_dashboard_storage", "investment-notes", "external-kb-note-progress.json")
}

function loadProgress(): Progress {
  try {
    const parsed = JSON.parse(fs.readFileSync(progressPath(), "utf8")) as Partial<Progress>
    return {
      spentRmb: Number(parsed.spentRmb) || 0,
      promptTokens: Number(parsed.promptTokens) || 0,
      completionTokens: Number(parsed.completionTokens) || 0,
      done: Array.isArray(parsed.done) ? parsed.done.filter((item) => typeof item === "string") : [],
      failed: Array.isArray(parsed.failed) ? parsed.failed : [],
    }
  } catch {
    return { spentRmb: 0, promptTokens: 0, completionTokens: 0, done: [], failed: [] }
  }
}

function saveProgress(progress: Progress) {
  fs.mkdirSync(path.dirname(progressPath()), { recursive: true })
  fs.writeFileSync(progressPath(), JSON.stringify(progress, null, 2))
}

function parseLimit(argv: string[]): number | undefined {
  const raw = argv.find((arg) => arg.startsWith("--limit="))
  if (!raw) return undefined
  const n = Number(raw.slice("--limit=".length))
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function textToNoteHtml(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `<div>${line ? escapeHtml(line) : "<br>"}</div>`)
    .join("")
}

function stitchChunks(parts: string[]): string {
  if (parts.length === 0) return ""
  let out = parts[0] || ""
  for (let i = 1; i < parts.length; i++) {
    const cur = parts[i] || ""
    const tail = out.slice(-OVERLAP)
    if (tail && cur.startsWith(tail)) out += cur.slice(tail.length)
    else out += `\n${cur}`
  }
  return out.trim()
}

function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced?.[1] || text).trim()
  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf("{")
    const end = candidate.lastIndexOf("}")
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1))
    throw new Error("AI 返回格式无效")
  }
}

function fileTitle(source: string): string {
  const base = source.split("/").pop() || source
  return base.replace(/\.[^.]+$/, "").trim().slice(0, 80) || "外部资料笔记"
}

function sourceBlock(source: string): string {
  const name = source.split("/").pop() || source
  return [
    `<!-- kb-source:${escapeHtml(source)} -->`,
    "<div><b>资料来源</b></div>",
    `<div>本笔记根据知识库文件自动生成：${escapeHtml(name)}</div>`,
    `<div>知识库路径：${escapeHtml(source)}</div>`,
    "<div><br></div>",
  ].join("")
}

async function summarize(input: {
  apiKey: string
  baseUrl: string
  model: string
  fileName: string
  text: string
}): Promise<{ title: string; content: string; products: Array<{ name: string; recordNo: string }>; promptTokens: number; completionTokens: number }> {
  const system = [
    "你是私募投资研究助手，负责把路演材料、尽调资料、合同或研究报告整理成投资笔记。",
    "要求：",
    "1. 只依据提供的文件内容整理，不要编造其中没有的事实、数据或结论。",
    "2. 用中文撰写，结构清晰，突出要点、关键数据和风险。",
    "3. 严格输出 JSON：{\"title\":\"笔记标题\",\"content\":\"HTML正文\",\"products\":[{\"name\":\"产品全称\",\"recordNo\":\"备案号\"}]}",
    "4. title 简洁，不超过 80 字，可包含管理人、产品或主题。",
    "5. content 使用简单 HTML（div、b、p、ul、li、table），不要使用 markdown，不要用代码块包裹。",
    "6. products 列出文件中明确出现的基金产品。name 用全称；备案号未知则 recordNo 为空字符串。没有产品则 []。不要编造产品。",
  ].join("\n")
  const body = {
    model: input.model,
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: `共 1 份资料：${input.fileName}\n\n【文件内容】\n【文件：${input.fileName}】\n${input.text}` },
    ],
  }
  let lastError = "AI 请求失败"
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${input.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
    if (res.status === 429 || res.status >= 500) {
      lastError = `HTTP ${res.status}`
      await new Promise((resolve) => setTimeout(resolve, 8_000 * (attempt + 1)))
      continue
    }
    if (!res.ok) {
      const detail = await res.text()
      throw new Error(`HTTP ${res.status} ${detail.slice(0, 200)}`)
    }
    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const raw = payload.choices?.[0]?.message?.content || ""
    const parsed = extractJsonObject(raw) as { title?: unknown; content?: unknown; products?: unknown }
    const title = String(parsed.title ?? "").trim().slice(0, 80)
    const content = String(parsed.content ?? "").trim()
    if (!content.replace(/<[^>]+>/g, "").trim()) throw new Error("AI 未返回可用的笔记正文")
    const products = Array.isArray(parsed.products)
      ? parsed.products.flatMap((item) => {
          if (!item || typeof item !== "object") return []
          const row = item as { name?: unknown; recordNo?: unknown }
          const name = String(row.name ?? "").trim()
          const recordNo = String(row.recordNo ?? "").trim()
          if (!name && !recordNo) return []
          return [{ name: name || recordNo, recordNo }]
        })
      : []
    return {
      title,
      content,
      products,
      promptTokens: Number(payload.usage?.prompt_tokens) || 0,
      completionTokens: Number(payload.usage?.completion_tokens) || 0,
    }
  }
  throw new Error(lastError)
}

function acquireLock() {
  const lock = `${progressPath()}.lock`
  try {
    const fd = fs.openSync(lock, "wx")
    fs.writeFileSync(fd, String(process.pid))
    const release = () => {
      try {
        fs.closeSync(fd)
        fs.unlinkSync(lock)
      } catch {
        // already released
      }
    }
    process.on("exit", release)
    return release
  } catch {
    throw new Error("已有外部笔记任务在运行")
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run")
  if (!dryRun) acquireLock()
  const limit = parseLimit(process.argv)
  const apiKey = process.env.DASHSCOPE_API_KEY || ""
  const baseUrl = process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1"
  const model = process.env.DASHSCOPE_ANALYSIS_MODEL || process.env.DASHSCOPE_CHAT_MODEL || "qwen-plus"
  if (!dryRun && !apiKey) throw new Error("缺少 DASHSCOPE_API_KEY")

  const { query } = await import("@/lib/db")
  const { listServerInvestmentNotes, createServerInvestmentNoteWithKbSync } = await import("@/lib/server/investment-notes")
  const { resolveExtractedProductCandidates } = await import("@/lib/server/investment-note-extracted-products")

  const existing = new Set<string>()
  for (const note of listServerInvestmentNotes("team", AUTHOR)) {
    const match = note.content.match(/知识库路径：([^<]+)/)
    if (match?.[1]) existing.add(match[1].trim())
  }
  const progress = loadProgress()
  for (const source of progress.done) existing.add(source)

  const likeSql = PREFIXES.map((_, i) => `source LIKE $${i + 1}`).join(" OR ")
  const rows = await query<{ source: string; content: string }>(
    `SELECT source, content FROM kb_chunks WHERE ${likeSql} ORDER BY source, id`,
    PREFIXES.map((prefix) => `${prefix}%`),
  )
  const grouped = new Map<string, string[]>()
  for (const row of rows) {
    const list = grouped.get(row.source) || []
    list.push(row.content || "")
    grouped.set(row.source, list)
  }

  const pending = [...grouped.keys()].filter((source) => !existing.has(source))
  console.error(
    `[external-notes] files=${grouped.size} pending=${pending.length} already=${grouped.size - pending.length} spent=¥${progress.spentRmb.toFixed(2)} model=${model}`,
  )
  if (dryRun) {
    const chars = pending.reduce((sum, source) => sum + Math.min(stitchChunks(grouped.get(source) || []).length, MAX_TEXT), 0)
    const estIn = chars / 1.7 + pending.length * 500
    const estOut = pending.length * 1500
    const est = estIn * PRICE_IN_PER_TOKEN + estOut * PRICE_OUT_PER_TOKEN
    console.error(`[external-notes] dry-run estimated additional cost ¥${est.toFixed(2)} (${pending.length} notes)`)
    return
  }

  const owner = { id: AUTHOR, name: AUTHOR }
  let created = 0
  const cap = limit ?? pending.length
  for (const source of pending) {
    if (created >= cap) break
    if (progress.spentRmb >= BUDGET_RMB) {
      console.error(`[external-notes] stop: spent ¥${progress.spentRmb.toFixed(2)} reached budget ¥${BUDGET_RMB}`)
      break
    }
    const text = stitchChunks(grouped.get(source) || []).slice(0, MAX_TEXT)
    const name = source.split("/").pop() || source
    if (text.length < 40) {
      progress.failed.push({ source, error: "提取文字过短" })
      progress.done.push(source)
      saveProgress(progress)
      continue
    }
    try {
      let title = fileTitle(source)
      let body = textToNoteHtml(text.slice(0, 4000))
      let products: Array<{ name: string; recordNo: string }> = []
      try {
        const generated = await summarize({ apiKey, baseUrl, model, fileName: name, text })
        title = generated.title || title
        body = generated.content
        products = generated.products
        progress.promptTokens += generated.promptTokens
        progress.completionTokens += generated.completionTokens
        progress.spentRmb += generated.promptTokens * PRICE_IN_PER_TOKEN + generated.completionTokens * PRICE_OUT_PER_TOKEN
      } catch (err) {
        console.error(`[external-notes] AI fallback ${name}: ${err instanceof Error ? err.message : err}`)
      }
      let extractedProducts: Awaited<ReturnType<typeof resolveExtractedProductCandidates>> = []
      if (products.length > 0) {
        try {
          extractedProducts = await resolveExtractedProductCandidates(products, name)
        } catch (err) {
          console.error(`[external-notes] product match skipped ${name}: ${err instanceof Error ? err.message : err}`)
        }
      }
      const note = await createServerInvestmentNoteWithKbSync(
        AUTHOR,
        AUTHOR,
        owner,
        {
          title,
          content: `${sourceBlock(source)}${body}`,
          teamShared: true,
          ...(extractedProducts.length ? { extractedProducts } : {}),
        },
        { append: true },
      )
      progress.done.push(source)
      progress.failed = progress.failed.filter((item) => item.source !== source)
      saveProgress(progress)
      created += 1
      console.error(
        `[external-notes] ${created} ${note.title} ¥${progress.spentRmb.toFixed(3)} ${source}`,
      )
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      progress.failed.push({ source, error })
      saveProgress(progress)
      console.error(`[external-notes] FAIL ${source}: ${error}`)
    }
  }
  console.error(
    `[external-notes] done created=${created} spent=¥${progress.spentRmb.toFixed(2)} prompt=${progress.promptTokens} completion=${progress.completionTokens} failed=${progress.failed.length}`,
  )
  process.exit(0)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
