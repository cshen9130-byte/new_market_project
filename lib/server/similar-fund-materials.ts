/**
 * Parse user-uploaded product materials (NAV chart/excel, roadshow PPT/notes,
 * 估值表, 结算单, 融航报告, …) into a comparable profile for 相似基金匹配.
 */

import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { extractNavMetadata } from "@/lib/server/email-nav-extract"
import { extractNavFromValuationBuffer } from "@/lib/server/email-valuation-attachment"
import { readFileDocumentText } from "@/lib/server/knowledge-base"
import { analyzeNavWorkbook, type NavCleanerRow } from "@/lib/server/nav-cleaner"
import { normalizeRegisterCode } from "@/lib/server/fund-picker-search"
import { extractPptxText, isPptxOpenXmlExtension } from "@/lib/server/pptx-text"
import { isRonghangArchiveFilename } from "@/lib/server/ronghang-archive"
import { analyzeRonghangDays, analyzeRonghangZipBuffer } from "@/lib/server/ronghang-zip-analysis"
import { parseRonghangWorkbook } from "@/lib/server/ronghang-settlement-parse"
import { parseValuationWorkbook, type ValuationAnalysis } from "@/lib/server/valuation-analyzer"
import * as XLSX from "xlsx"

export const MAX_SIMILAR_FUND_MATERIAL_FILES = 15
export const MAX_SIMILAR_FUND_MATERIAL_BYTES = 25 * 1024 * 1024

export const SIMILAR_FUND_MATERIAL_ACCEPT = [
  ".pdf", ".doc", ".docx",
  ".ppt", ".pptx", ".pptm", ".ppsx",
  ".xls", ".xlsx", ".xlsm", ".csv",
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp",
  ".zip", ".rar",
  ".txt", ".md",
].join(",")

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"])
const SPREADSHEET_EXTS = new Set([".xls", ".xlsx", ".xlsm", ".csv"])
const TEXT_OFFICE_EXTS = new Set([".pdf", ".doc", ".docx", ".txt", ".md", ".html", ".htm"])

const BEIAN_RE = /(?<![A-Z0-9])([A-Z][A-Z0-9]{4,7}[A-Z]?)(?![A-Z0-9])/gi
const FUND_NAME_RE = /[\u4e00-\u9fffA-Za-z0-9]{2,40}(?:私募证券投资基金|私募基金|证券投资基金|投资基金)/u

const STRATEGY_HINTS: Array<{ re: RegExp; l1: string; l2: string }> = [
  { re: /股票市场中性|量化中性|市场中性/, l1: "股票多头", l2: "股票市场中性" },
  { re: /指数增强|指增|中证500|中证1000|沪深300/, l1: "股票多头", l2: "指数增强" },
  { re: /量化选股|量化多头|量化精选/, l1: "股票多头", l2: "量化选股" },
  { re: /主观多头|主观选股|主观股票/, l1: "股票多头", l2: "主观多头" },
  { re: /股票对冲|多空对冲/, l1: "股票多头", l2: "股票对冲" },
  { re: /CTA|管理期货|商品期货|趋势跟踪|量化期货/, l1: "期货策略", l2: "量化期货" },
  { re: /主观期货/, l1: "期货策略", l2: "主观期货" },
  { re: /债券|固收|票息|利率债/, l1: "债券策略", l2: "债券策略" },
  { re: /可转债/, l1: "债券策略", l2: "可转债多头" },
  { re: /套利/, l1: "套利策略", l2: "套利策略" },
  { re: /期权/, l1: "期权策略", l2: "期权策略" },
  { re: /宏观对冲|宏观配置/, l1: "多资产策略", l2: "宏观对冲" },
  { re: /FOF|基金中基金|组合策略/, l1: "多资产策略", l2: "组合策略" },
]

export type SimilarFundMaterialKind =
  | "nav"
  | "valuation"
  | "settlement"
  | "roadshow"
  | "note"
  | "chart"
  | "archive"
  | "other"

export type SimilarFundNavPoint = {
  price_date: string
  nav: string
  cumulative_nav: string | null
}

export type ParsedSimilarFundFile = {
  fileName: string
  kind: SimilarFundMaterialKind
  summary: string
  productName: string | null
  beianHao: string | null
  manager: string | null
  nav: SimilarFundNavPoint[]
  textExcerpt: string
  extra: string
}

export type SimilarFundMaterialProfile = {
  files: ParsedSimilarFundFile[]
  productName: string | null
  beianHao: string | null
  manager: string | null
  strategyL1: string | null
  strategyL2: string | null
  strategyHints: string[]
  navSeries: SimilarFundNavPoint[]
  documentContext: string
  parseSummary: string
}

export function guessSimilarFundMaterialKind(fileName: string): SimilarFundMaterialKind {
  const n = fileName.toLowerCase()
  if (/\.(zip|rar)$/i.test(fileName) || /融航/.test(fileName)) return "archive"
  if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(fileName) || /净值图|nav.?chart/i.test(n)) return "chart"
  if (/估值表/.test(fileName)) return "valuation"
  if (/结算单|融航/.test(fileName)) return "settlement"
  if (/净值|nav/i.test(fileName) && /\.(xlsx?|csv)$/i.test(fileName)) return "nav"
  if (/路演|road.?show|ppt/i.test(n)) return "roadshow"
  if (/纪要|笔记|note|会议/i.test(n)) return "note"
  if (/\.(pptx?|pptm|ppsx)$/i.test(fileName)) return "roadshow"
  return "other"
}

export function similarFundMaterialKindLabel(kind: SimilarFundMaterialKind): string {
  switch (kind) {
    case "nav": return "净值"
    case "valuation": return "估值表"
    case "settlement": return "结算单"
    case "roadshow": return "路演"
    case "note": return "纪要"
    case "chart": return "净值图"
    case "archive": return "融航/压缩包"
    default: return "材料"
  }
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const s = String(value ?? "").trim()
    if (s) return s
  }
  return null
}

const WEAK_IDENTITY_RE =
  /^(净值图?|累计净值|单位净值|历史净值|nav|chart|image|img|screenshot|picture|photo|untitled|图片|截图|路演|ppt|pptx|估值表|结算单|融航|纪要|材料|上传材料|file)[\s_\-0-9]*$/i

export function isWeakMaterialIdentity(value: string | null | undefined): boolean {
  const s = String(value ?? "").trim()
  if (s.length < 4) return true
  const compact = s.replace(/[\s_\-()（）\[\]0-9]+/g, "")
  if (WEAK_IDENTITY_RE.test(s) || WEAK_IDENTITY_RE.test(compact)) return true
  if (/净值/.test(s) && s.length <= 6) return true
  return false
}

export function looksLikeFundIdentity(value: string | null | undefined): boolean {
  const s = String(value ?? "").trim()
  if (!s || isWeakMaterialIdentity(s)) return false
  if (normalizeRegisterCode(s)) return true
  if (/(私募证券投资基金|私募基金|证券投资基金|资产管理计划|投资基金)/.test(s) && s.length >= 6) return true
  if (s.length >= 8 && /[\u4e00-\u9fff]/.test(s) && !/净值图|路演|估值表|结算单|截图|图片/.test(s)) return true
  return false
}

function trustedProductName(value: string | null | undefined): string | null {
  const s = String(value ?? "").trim()
  return looksLikeFundIdentity(s) ? s : null
}

function collectBeian(text: string): string | null {
  for (const match of text.toUpperCase().matchAll(BEIAN_RE)) {
    const code = normalizeRegisterCode(match[1])
    if (code) return code
  }
  return null
}

function collectFundName(text: string): string | null {
  const m = text.match(FUND_NAME_RE)
  return m ? m[0].trim() : null
}

function collectManager(text: string): string | null {
  const m = text.match(/(?:基金管理人|管理人|投资顾问)[:：\s]*([^\n,，;；]{2,40})/)
  if (!m) return null
  const name = m[1].replace(/[（(].*$/, "").trim()
  return name.length >= 2 ? name : null
}

function identityFromFilename(fileName: string): {
  productName: string | null
  beianHao: string | null
} {
  const meta = extractNavMetadata(fileName, "")
  const beian = normalizeRegisterCode(meta.productCode) ?? collectBeian(fileName)
  const productName = trustedProductName(meta.fundName) || trustedProductName(collectFundName(fileName))
  return { productName, beianHao: beian }
}

function inferStrategyHints(blob: string): { l1: string | null; l2: string | null; hints: string[] } {
  const hints: string[] = []
  let l1: string | null = null
  let l2: string | null = null
  for (const rule of STRATEGY_HINTS) {
    if (rule.re.test(blob)) {
      hints.push(rule.l2)
      if (!l1) l1 = rule.l1
      if (!l2) l2 = rule.l2
    }
  }
  return { l1, l2, hints: [...new Set(hints)] }
}

/** Strategy / name hints from the user-written material note only — not from a NAV chart. */
export function inferStrategyFromUserNote(note: string): { l1: string | null; l2: string | null; hints: string[] } {
  return inferStrategyHints(note)
}

const NOTE_STOPWORDS = new Set([
  "这是", "这是一只", "一只", "一个", "产品", "基金", "曲线", "净值", "上传", "材料", "说明",
  "的", "是", "和", "与", "或", "以及", "请", "帮", "我", "查找", "相似", "对比",
  "信息", "策略", "关于", "这个", "那只", "可以", "进行", "分析", "匹配",
  "私募", "证券", "投资", "走势", "接近", "相关", "例如", "比如",
])

const NOTE_STRATEGY_PHRASES = [
  "量化期货", "主观期货", "管理期货", "期货策略", "市场中性", "指数增强",
  "量化选股", "主观多头", "股票对冲", "宏观对冲",
]

export function extractNoteSearchTokens(note: string): string[] {
  const text = note.trim()
  if (!text) return []
  const out: string[] = []
  const seen = new Set<string>()
  const add = (raw: string) => {
    const t = raw.trim().replace(/产品$/u, "").trim()
    if (t.length < 2 || NOTE_STOPWORDS.has(t)) return
    if (/^[这那该本]/.test(t) && t.length <= 4) return
    const key = t.toUpperCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(t)
  }
  if (/CTA/i.test(text)) add("CTA")
  for (const phrase of NOTE_STRATEGY_PHRASES) {
    if (text.includes(phrase)) add(phrase)
  }
  if (/期货/.test(text) && !out.some((t) => t.includes("期货"))) add("期货")
  for (const part of text.split(/[\s,，、/|；;:.。！？!?（）()【】[\]<>《》]+/)) {
    add(part)
  }
  return out.slice(0, 8)
}

export function applyUserNoteToMaterials(
  materials: SimilarFundMaterialProfile,
  note: string,
): SimilarFundMaterialProfile {
  const n = note.trim()
  if (!n) return materials
  const fromNote = inferStrategyHints(n)
  return {
    ...materials,
    strategyL1: fromNote.l1 ?? materials.strategyL1,
    strategyL2: fromNote.l2 ?? materials.strategyL2,
    strategyHints: [...new Set([...fromNote.hints, ...materials.strategyHints])],
    documentContext: `【用户材料说明】\n${n}${materials.documentContext ? `\n\n${materials.documentContext}` : ""}`.slice(0, 16_000),
  }
}

function navFromCleanerRows(rows: NavCleanerRow[]): SimilarFundNavPoint[] {
  return rows
    .filter((row) => row.date && (row.cumulativeNav > 0 || row.unitNav > 0 || (row.adjustedNav ?? 0) > 0))
    .map((row) => ({
      price_date: row.date.slice(0, 10),
      nav: String(row.unitNav || row.cumulativeNav || row.adjustedNav),
      // Product-page CSV has 复权净值; DB matching uses return_nav / 复权 when present.
      cumulative_nav: String(row.adjustedNav || row.cumulativeNav || row.unitNav),
    }))
    .sort((a, b) => a.price_date.localeCompare(b.price_date))
}

function mergeNavSeries(parts: SimilarFundNavPoint[][]): SimilarFundNavPoint[] {
  const map = new Map<string, SimilarFundNavPoint>()
  for (const series of parts) {
    for (const point of series) {
      if (!point.price_date || !point.nav) continue
      map.set(point.price_date, point)
    }
  }
  return [...map.values()].sort((a, b) => a.price_date.localeCompare(b.price_date))
}

function looksLikeValuation(analysis: ValuationAnalysis): boolean {
  const details = analysis.portfolio_data.filter((row) => Boolean(row.include_in_detail))
  return details.length >= 3 || (analysis.summary.nav > 0 && analysis.portfolio_data.length >= 5)
}

function summarizeValuation(analysis: ValuationAnalysis): string {
  const details = analysis.portfolio_data.filter((row) => Boolean(row.include_in_detail))
  const ranked = [...details].sort((a, b) => {
    const aw = Number(a.market_weight ?? a.market_value ?? 0)
    const bw = Number(b.market_weight ?? b.market_value ?? 0)
    return bw - aw
  })
  const top = ranked.slice(0, 12).map((row, idx) => {
    const weight = row.market_weight != null ? `${Number(row.market_weight).toFixed(2)}%` : ""
    return `  ${idx + 1}. ${row.name || row.code}${weight ? `  ${weight}` : ""}`
  })
  const s = analysis.summary
  return [
    `估值日 ${s.valuation_date || "未知"}  净值 ${s.nav || "N/A"}  资产 ${s.total_asset || "N/A"}`,
    s.fund_name && s.fund_name !== "未知基金" ? `产品 ${s.fund_name}` : "",
    top.length ? `主要持仓：\n${top.join("\n")}` : "",
  ].filter(Boolean).join("\n")
}

function equityToNav(points: Array<{ date: string; nav: number }>): SimilarFundNavPoint[] {
  return points
    .filter((p) => p.date && Number.isFinite(p.nav) && p.nav > 0)
    .map((p) => ({
      price_date: p.date.slice(0, 10),
      nav: String(p.nav),
      cumulative_nav: String(p.nav),
    }))
}

async function extractOfficeText(buffer: Buffer, fileName: string): Promise<string> {
  const ext = path.extname(fileName).toLowerCase()
  if (isPptxOpenXmlExtension(ext)) {
    try {
      return extractPptxText(buffer).slice(0, 40_000)
    } catch {
      return ""
    }
  }
  if (!TEXT_OFFICE_EXTS.has(ext) && ext !== ".csv") return ""
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "similar-fund-"))
  const safeName = path.basename(fileName).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_") || `file${ext}`
  const tempPath = path.join(dir, safeName)
  try {
    await fs.writeFile(tempPath, buffer)
    const text = await readFileDocumentText(tempPath, ext)
    return String(text || "").slice(0, 40_000)
  } catch {
    return ""
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

function spreadsheetTextDump(buffer: Buffer): string {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" })
    return workbook.SheetNames.slice(0, 4).map((name) => {
      const sheet = workbook.Sheets[name]
      const csv = XLSX.utils.sheet_to_csv(sheet)
      return `Sheet: ${name}\n${csv.slice(0, 6000)}`
    }).join("\n\n").slice(0, 16_000)
  } catch {
    return ""
  }
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = (fenced ? fenced[1] : text).trim()
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1))
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function visionRowsToNav(navRaw: unknown[], axisHint: string): SimilarFundNavPoint[] {
  const parsed: Array<{ date: string; value: number; asReturn: boolean }> = []
  for (const row of navRaw) {
    if (Array.isArray(row) && row.length >= 2) {
      const date = String(row[0] ?? "").slice(0, 10)
      const value = Number(row[1])
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value)) {
        parsed.push({ date, value, asReturn: axisHint !== "nav" })
      }
      continue
    }
    if (!row || typeof row !== "object") continue
    const rec = row as Record<string, unknown>
    const date = String(rec.date ?? "").slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const retPct = Number(rec.return_pct)
    const unit = Number(rec.nav ?? rec.cumulative_nav)
    if (Number.isFinite(retPct)) {
      parsed.push({ date, value: retPct, asReturn: true })
      continue
    }
    if (Number.isFinite(unit)) {
      parsed.push({ date, value: unit, asReturn: false })
    }
  }
  if (parsed.length === 0) return []

  const values = parsed.map((p) => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)

  // Detect whether values are cumulative return-% (0–80), fractional return (0–0.5),
  // or actual nav (0.8–5).
  //   return_pct:   max–min >= 1 AND max < 80
  //   frac_return:  max < 0.8 AND min >= -0.2   (model returned 0.18 instead of 18)
  //   nav:          min >= 0.5 AND max <= 5
  const isFracReturn = max < 0.8 && min >= -0.3 && max - min < 0.8
  const valuesForConvert = isFracReturn ? values.map((v) => v * 100) : values
  const adjustedMin = isFracReturn ? min * 100 : min
  const adjustedMax = isFracReturn ? max * 100 : max

  const forceReturn =
    axisHint === "return_pct"
    || parsed.every((p) => p.asReturn)
    || isFracReturn
    || (adjustedMax <= 80 && adjustedMin >= -60 && adjustedMax - adjustedMin >= 1 && adjustedMax < 50 && !(adjustedMin >= 0.5 && adjustedMax <= 5))

  const points = parsed
    .map((p, i) => {
      const raw = isFracReturn ? valuesForConvert[i] : p.value
      let nav: number
      if (forceReturn || p.asReturn) {
        // raw is cumulative return in %: nav = 1 + raw/100
        // guard against the model accidentally outputting tiny fractions (<=2) on a return_pct chart
        nav = Math.abs(raw) <= 2 && axisHint !== "return_pct" && !p.asReturn && !isFracReturn
          ? 1 + raw
          : 1 + raw / 100
      } else {
        nav = raw
      }
      if (!Number.isFinite(nav) || nav <= 0) return null
      return {
        price_date: p.date,
        nav: String(nav),
        cumulative_nav: String(nav),
      }
    })
    .filter((p): p is SimilarFundNavPoint => Boolean(p))
    .sort((a, b) => a.price_date.localeCompare(b.price_date))

  if (points.length === 0) return []

  // Sanity-check: remove outlier points whose nav deviates more than 5× from the median.
  const navVals = points.map((p) => parseFloat(p.cumulative_nav ?? p.nav)).sort((a, b) => a - b)
  const med = navVals[Math.floor(navVals.length / 2)]
  const clean = points.filter((p) => {
    const v = parseFloat(p.cumulative_nav ?? p.nav)
    return v >= med * 0.1 && v <= med * 10
  })

  return clean.length >= 3 ? clean : points
}

async function extractFromImage(buffer: Buffer, fileName: string): Promise<ParsedSimilarFundFile> {
  const ext = path.extname(fileName).toLowerCase()
  const mime: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
  }
  const identity = identityFromFilename(fileName)
  const empty = (summary: string, extra = ""): ParsedSimilarFundFile => ({
    fileName,
    kind: "chart",
    summary,
    productName: identity.productName,
    beianHao: identity.beianHao,
    manager: null,
    nav: [],
    textExcerpt: extra,
    extra: "",
  })

  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) return empty("图片已接收，但未配置视觉模型，未能识别净值图文字")

  const dataUrl = `data:${mime[ext] || "image/png"};base64,${buffer.toString("base64")}`
  const baseURL = process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1"
  const model = process.env.DASHSCOPE_VISION_MODEL || "qwen-vl-plus"
  try {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 8000,
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl } },
            {
              type: "text",
              text: `这是私募产品净值/收益曲线截图。图中往往没有产品名称。只输出 JSON：
{"product_name":"","beian_hao":"","manager":"","axis":"return_pct","pts":[["2026-05-16",0],["2026-05-23",0.2]]}
规则：
1. product_name、beian_hao、manager 仅当图中文字明确出现时填写，否则必须是空字符串。禁止猜测、禁止用文件名编造。
2. pts 为 [日期, 数值] 数组。必须覆盖横轴全部区间：起点、终点、每个可见刻度，以及刻度之间每隔约 5-7 天再取一点。目标 32-48 个点，不要只给 8-12 个点。
3. 纵轴若是累计收益率百分比（0%~18%），axis=return_pct，数值用百分比（15 表示 15%，不要写成 0.15）。
4. 纵轴若是净值（1.00、1.08），axis=nav，数值用净值。
5. 日期必须是图中横轴的真实年份（如 2026-05-16），不要编成 2024/2025。
6. 不要输出 JSON 以外的文字。`,
            },
          ],
        }],
      }),
    })
    if (!res.ok) throw new Error(`vision ${res.status}`)
    const parsed = await res.json()
    const content = parsed?.choices?.[0]?.message?.content
    const text = typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((part: { text?: string }) => part?.text || "").join("\n")
        : JSON.stringify(content ?? "")
    const obj = parseJsonObject(text) ?? {}
    const navRaw = Array.isArray(obj.pts)
      ? obj.pts
      : Array.isArray(obj.nav_points)
        ? obj.nav_points
        : []
    const nav = visionRowsToNav(navRaw, String(obj.axis || ""))
    const productName = trustedProductName(String(obj.product_name || "")) || identity.productName
    const beianHao = normalizeRegisterCode(String(obj.beian_hao || "")) ?? identity.beianHao
    const manager = looksLikeFundIdentity(String(obj.manager || "")) ? String(obj.manager).trim() : null
    const notes = String(obj.notes || "").trim()
    return {
      fileName,
      kind: "chart",
      summary: nav.length
        ? `从净值图识别 ${nav.length} 个收益/净值点${productName ? `，产品 ${productName}` : "（图中无产品名）"}`
        : `已读取净值图，但未能还原曲线点${productName ? `；图中产品 ${productName}` : ""}`,
      productName,
      beianHao,
      manager,
      nav,
      textExcerpt: notes,
      extra: String(obj.axis || ""),
    }
  } catch (err) {
    return empty(`图片识别失败：${(err as Error).message}`)
  }
}

async function parseSpreadsheet(buffer: Buffer, fileName: string): Promise<ParsedSimilarFundFile> {
  const identity = identityFromFilename(fileName)
  const kindHint = guessSimilarFundMaterialKind(fileName)
  const attempts: ParsedSimilarFundFile[] = []

  const tryValuation = () => {
    try {
      const analysis = parseValuationWorkbook(buffer, fileName)
      if (!looksLikeValuation(analysis)) return
      const extracted = extractNavFromValuationBuffer(buffer, fileName, fileName)
      const nav: SimilarFundNavPoint[] = []
      if (extracted?.navDate && extracted.nav != null) {
        nav.push({
          price_date: extracted.navDate.slice(0, 10),
          nav: String(extracted.nav),
          cumulative_nav: extracted.cumulativeNav != null ? String(extracted.cumulativeNav) : String(extracted.nav),
        })
      }
      attempts.push({
        fileName,
        kind: "valuation",
        summary: summarizeValuation(analysis),
        productName: firstNonEmpty(
          analysis.summary.fund_name !== "未知基金" ? analysis.summary.fund_name : "",
          extracted?.fundName,
          identity.productName,
        ),
        beianHao: normalizeRegisterCode(extracted?.productCode || "") ?? identity.beianHao,
        manager: null,
        nav,
        textExcerpt: summarizeValuation(analysis),
        extra: `估值日 ${analysis.summary.valuation_date || ""}`,
      })
    } catch { /* not a valuation workbook */ }
  }

  const tryNav = () => {
    try {
      const analysis = analyzeNavWorkbook(buffer, fileName)
      if (analysis.validRowCount < 3) return
      const names = [...new Set(analysis.rows.map((r) => r.fundName).filter(Boolean))] as string[]
      const codes = [...new Set(analysis.rows.map((r) => r.productCode).filter(Boolean))] as string[]
      attempts.push({
        fileName,
        kind: "nav",
        summary: `解析净值序列 ${analysis.validRowCount} 条（${analysis.rows[0]?.date ?? ""} ~ ${analysis.rows[analysis.rows.length - 1]?.date ?? ""}）`,
        productName: firstNonEmpty(...names, identity.productName),
        beianHao: normalizeRegisterCode(codes[0] || "") ?? identity.beianHao,
        manager: null,
        nav: navFromCleanerRows(analysis.rows),
        textExcerpt: "",
        extra: analysis.warnings.slice(0, 3).join("；"),
      })
    } catch { /* not a nav workbook */ }
  }

  const trySettlement = () => {
    try {
      const day = parseRonghangWorkbook(buffer, fileName)
      const report = analyzeRonghangDays([day], fileName)
      attempts.push({
        fileName,
        kind: "settlement",
        summary: [
          report.narrative.returnSummary,
          report.narrative.navSummary,
          `板块盈亏：${report.narrative.topProfitSectors.slice(0, 4).join("、") || "无"}`,
        ].filter(Boolean).join(" "),
        productName: firstNonEmpty(report.meta.clientName, identity.productName),
        beianHao: identity.beianHao,
        manager: firstNonEmpty(report.meta.brokerName),
        nav: equityToNav(report.equityCurve),
        textExcerpt: [
          report.narrative.returnSummary,
          report.narrative.drawdownSummary,
          report.narrative.monthlySummary,
        ].join("\n"),
        extra: `交易日 ${report.meta.tradingDays}  夏普 ${report.overview.sharpe.toFixed(2)}  卡玛 ${report.overview.calmar.toFixed(2)}`,
      })
    } catch { /* not a settlement workbook */ }
  }

  if (kindHint === "valuation") tryValuation()
  else if (kindHint === "nav") tryNav()
  else if (kindHint === "settlement" || kindHint === "archive") trySettlement()
  else {
    tryNav()
    tryValuation()
    trySettlement()
  }

  if (kindHint === "valuation" && attempts.length === 0) {
    tryNav()
    trySettlement()
  } else if (kindHint === "nav" && attempts.length === 0) {
    tryValuation()
    trySettlement()
  } else if ((kindHint === "settlement" || kindHint === "archive") && attempts.length === 0) {
    tryNav()
    tryValuation()
  }

  if (attempts.length > 0) {
    return attempts.sort((a, b) => b.nav.length - a.nav.length)[0]
  }

  const dump = spreadsheetTextDump(buffer)
  return {
    fileName,
    kind: kindHint === "other" ? "other" : kindHint,
    summary: dump ? "已读取表格文本，但未能识别为净值/估值表/结算单" : "未能解析该表格",
    productName: identity.productName,
    beianHao: identity.beianHao,
    manager: collectManager(dump),
    nav: [],
    textExcerpt: dump.slice(0, 8000),
    extra: "",
  }
}

async function parseArchive(buffer: Buffer, fileName: string): Promise<ParsedSimilarFundFile> {
  const identity = identityFromFilename(fileName)
  try {
    const report = await analyzeRonghangZipBuffer(buffer, fileName)
    return {
      fileName,
      kind: "archive",
      summary: [
        `融航结算单 ${report.fileCount} 份，${report.meta.startDate} ~ ${report.meta.endDate}`,
        report.narrative.returnSummary,
      ].join("。"),
      productName: firstNonEmpty(report.meta.clientName, identity.productName),
      beianHao: identity.beianHao,
      manager: firstNonEmpty(report.meta.brokerName),
      nav: equityToNav(report.equityCurve),
      textExcerpt: [
        report.narrative.returnSummary,
        report.narrative.navSummary,
        report.narrative.drawdownSummary,
        `盈利板块：${report.narrative.topProfitSectors.join("、")}`,
        `亏损板块：${report.narrative.topLossSectors.join("、")}`,
      ].join("\n"),
      extra: `夏普 ${report.overview.sharpe.toFixed(2)}  卡玛 ${report.overview.calmar.toFixed(2)}  最大回撤 ${(report.overview.maxPeakDrawdown * 100).toFixed(2)}%`,
    }
  } catch (err) {
    return {
      fileName,
      kind: "archive",
      summary: `压缩包解析失败：${(err as Error).message}`,
      productName: identity.productName,
      beianHao: identity.beianHao,
      manager: null,
      nav: [],
      textExcerpt: "",
      extra: "",
    }
  }
}

async function parseDocument(buffer: Buffer, fileName: string): Promise<ParsedSimilarFundFile> {
  const identity = identityFromFilename(fileName)
  const kind = guessSimilarFundMaterialKind(fileName)
  const text = await extractOfficeText(buffer, fileName)
  const productName = firstNonEmpty(identity.productName, collectFundName(text))
  const beianHao = identity.beianHao ?? collectBeian(`${fileName}\n${text}`)
  const manager = collectManager(text)
  return {
    fileName,
    kind,
    summary: text
      ? `已提取文档约 ${Math.min(text.length, 40_000)} 字${productName ? `，识别产品 ${productName}` : ""}`
      : `未能提取「${fileName}」文本（可能是旧版 PPT 或扫描件）`,
    productName,
    beianHao,
    manager,
    nav: [],
    textExcerpt: text.slice(0, 8000),
    extra: "",
  }
}

async function parseOneFile(buffer: Buffer, fileName: string): Promise<ParsedSimilarFundFile> {
  const ext = path.extname(fileName).toLowerCase()
  if (IMAGE_EXTS.has(ext)) return extractFromImage(buffer, fileName)
  if (isRonghangArchiveFilename(fileName) || /\.(zip|rar)$/i.test(ext)) {
    return parseArchive(buffer, fileName)
  }
  if (SPREADSHEET_EXTS.has(ext)) return parseSpreadsheet(buffer, fileName)
  return parseDocument(buffer, fileName)
}

export async function parseSimilarFundMaterials(
  files: Array<{ name: string; buffer: Buffer }>,
): Promise<SimilarFundMaterialProfile> {
  const parsed: ParsedSimilarFundFile[] = []
  for (const file of files.slice(0, MAX_SIMILAR_FUND_MATERIAL_FILES)) {
    if (file.buffer.length > MAX_SIMILAR_FUND_MATERIAL_BYTES) {
      parsed.push({
        fileName: file.name,
        kind: "other",
        summary: `文件超过 ${Math.round(MAX_SIMILAR_FUND_MATERIAL_BYTES / 1024 / 1024)}MB，已跳过`,
        productName: null,
        beianHao: null,
        manager: null,
        nav: [],
        textExcerpt: "",
        extra: "",
      })
      continue
    }
    try {
      parsed.push(await parseOneFile(file.buffer, file.name))
    } catch (err) {
      parsed.push({
        fileName: file.name,
        kind: guessSimilarFundMaterialKind(file.name),
        summary: `解析失败：${(err as Error).message}`,
        productName: null,
        beianHao: null,
        manager: null,
        nav: [],
        textExcerpt: "",
        extra: "",
      })
    }
  }

  const navSeries = mergeNavSeries(parsed.map((f) => f.nav))
  // A NAV chart cannot tell CTA/期货. Only documents (路演/纪要/表格文本) may contribute strategy hints.
  const strategyBlob = parsed
    .filter((f) => f.kind !== "chart")
    .map((f) => `${f.summary}\n${f.textExcerpt}\n${f.extra}`)
    .join("\n")
  const strategy = inferStrategyHints(strategyBlob)
  const documentContext = parsed
    .map((f) => {
      const excerpt = f.textExcerpt.trim()
      if (!excerpt && !f.summary) return ""
      return `【${similarFundMaterialKindLabel(f.kind)} · ${f.fileName}】\n${f.summary}${excerpt ? `\n${excerpt.slice(0, 3500)}` : ""}`
    })
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 16_000)

  const parseSummary = parsed
    .map((f) => `${similarFundMaterialKindLabel(f.kind)}「${f.fileName}」：${f.summary.split("\n")[0]}`)
    .join("；")

  return {
    files: parsed,
    productName: firstNonEmpty(...parsed.map((f) => trustedProductName(f.productName))),
    beianHao: firstNonEmpty(...parsed.map((f) => f.beianHao)),
    manager: firstNonEmpty(...parsed.map((f) => (looksLikeFundIdentity(f.manager) || (f.manager && f.manager.length >= 4 && /资本|资产|投资|管理/.test(f.manager)) ? f.manager : null))),
    strategyL1: strategy.l1,
    strategyL2: strategy.l2,
    strategyHints: strategy.hints,
    navSeries,
    documentContext,
    parseSummary,
  }
}
