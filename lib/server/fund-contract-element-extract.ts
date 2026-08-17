import { promises as fs } from "fs"
import path from "path"
import { ChatOpenAI } from "@langchain/openai"
import { PDFParse } from "pdf-parse"
import { readFileDocumentText } from "@/lib/server/knowledge-base"
import {
  fundNameCore,
  normalizeRegisterCode,
  searchFundsByRegister,
  searchTrackingFunds,
} from "@/lib/server/fund-picker-search"
import {
  shareClassProductNamesMatch,
} from "@/lib/server/fund-name-match"
import {
  shareClassFromProductName,
  canonicalizeShareClassBeianCode,
  type ShareClassLetter,
} from "@/lib/server/share-class-product"
import { getServerStoragePath } from "@/lib/server/storage"
import { pdfParseLoadOptions, readPdfTextWithCmaps } from "@/lib/server/pdf-text"

const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_TEXT_CHARS = 120_000
const LLM_TEXT_CHARS = 24_000
const PDF_OCR_MAX_PAGES = 4
const SPARSE_PDF_TEXT_CHARS = 80

const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
])
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"])
const SUPPORTED_FORMATS_MESSAGE =
  "仅支持 PDF、Word (.doc/.docx)、Excel (.xls/.xlsx)、图片 (.png/.jpg/.jpeg/.gif/.webp/.bmp) 格式的基金合同"

export type ExtractedFundElements = {
  fund_name: string | null
  register_number: string | null
  advisor: string | null
  fund_manager: string | null
  inception_date: string | null
  puton_date: string | null
  custodian: string | null
  open_day: string | null
  is_temporary_open: string | null
  fee_purchase: string | null
  add_amount: string | null
  fee_redeem: string | null
  precautious_line: string | null
  closed_period: string | null
  stop_line: string | null
  fee_manage_rate: string | null
  fee_trust: string | null
  fee_manage: string | null
  fee_admin_service: string | null
  fee_pay: string | null
}

export type FundMatchCandidate = {
  beian_hao: string
  product_name: string
  short_name: string | null
}

const EMPTY_ELEMENTS: ExtractedFundElements = {
  fund_name: null,
  register_number: null,
  advisor: null,
  fund_manager: null,
  inception_date: null,
  puton_date: null,
  custodian: null,
  open_day: null,
  is_temporary_open: null,
  fee_purchase: null,
  add_amount: null,
  fee_redeem: null,
  precautious_line: null,
  closed_period: null,
  stop_line: null,
  fee_manage_rate: null,
  fee_trust: null,
  fee_manage: null,
  fee_admin_service: null,
  fee_pay: null,
}

const ELEMENT_KEYS = Object.keys(EMPTY_ELEMENTS) as (keyof ExtractedFundElements)[]

function getExtension(fileName: string) {
  return path.extname(fileName).toLowerCase()
}

function getDashScopeApiKey() {
  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) {
    throw new Error("缺少 DASHSCOPE_API_KEY，无法启用要素提取")
  }
  return apiKey
}

function getDashScopeBaseUrl() {
  return process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1"
}

function getVisionModel() {
  return process.env.DASHSCOPE_VISION_MODEL || "qwen-vl-plus"
}

function mimeTypeForExtension(ext: string) {
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
  }
  return map[ext] || "application/octet-stream"
}

async function extractTextFromImage(buffer: Buffer, ext: string): Promise<string> {
  const mimeType = mimeTypeForExtension(ext)
  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`
  const res = await fetch(`${getDashScopeBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getDashScopeApiKey()}`,
    },
    body: JSON.stringify({
      model: getVisionModel(),
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl } },
            {
              type: "text",
              text: "请识别并完整输出图片中的全部文字内容，保持段落与表格结构，不要添加任何解释或说明。",
            },
          ],
        },
      ],
    }),
  })

  if (!res.ok) {
    let message = `图片识别失败 (${res.status})`
    try {
      const parsed = await res.json()
      message = parsed?.error?.message || parsed?.message || message
    } catch {
      // ignore parse errors
    }
    throw new Error(message)
  }

  const parsed = await res.json()
  const content = parsed?.choices?.[0]?.message?.content
  const text = stringifyModelContent(content).trim()
  if (!text) {
    throw new Error("未能从图片中识别文字，请确认图片清晰且包含可读内容")
  }
  return text.replace(/\s+/g, " ").trim()
}

function isSparsePdfText(text: string): boolean {
  const cleaned = text
    .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, " ")
    .replace(/page\s+\d+\s*(of|\/)\s*\d+/gi, " ")
    .replace(/\s+/g, "")
  return cleaned.length < SPARSE_PDF_TEXT_CHARS
}

async function ocrPdfPages(buffer: Buffer): Promise<string> {
  const parser = new PDFParse(pdfParseLoadOptions(buffer))
  try {
    const shot = await parser.getScreenshot({
      scale: 2,
      first: PDF_OCR_MAX_PAGES,
      imageDataUrl: false,
      imageBuffer: true,
    })
    const pages = shot.pages ?? []
    const parts: string[] = []
    for (const page of pages) {
      const bytes = page.data
      if (!bytes || bytes.length === 0) continue
      const text = await extractTextFromImage(Buffer.from(bytes), ".png")
      if (text.trim()) parts.push(text.trim())
    }
    return parts.join("\n\n").trim()
  } finally {
    await parser.destroy().catch(() => undefined)
  }
}

async function readPdfTextWithOcrFallback(buffer: Buffer, fileName: string): Promise<string> {
  let text = ""
  try {
    text = await readPdfTextWithCmaps(buffer)
  } catch {
    text = ""
  }
  if (!isSparsePdfText(text)) return text.slice(0, MAX_TEXT_CHARS)
  const ocr = await ocrPdfPages(buffer)
  if (ocr && !isSparsePdfText(ocr)) return ocr.slice(0, MAX_TEXT_CHARS)
  if (text.trim()) return text.slice(0, MAX_TEXT_CHARS)
  throw new Error(`未能从文件「${fileName}」读取文字，请确认文件未加密且内容可读`)
}

function stringifyModelContent(content: unknown) {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item
        if (item && typeof item === "object" && "text" in item) return String((item as { text?: string }).text || "")
        return ""
      })
      .join("\n")
      .trim()
  }
  return String(content || "")
}

function normalizeNullableString(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s || null
}

function normalizeDate(value: unknown): string | null {
  const s = normalizeNullableString(value)
  if (!s) return null
  const m = s.match(/(\d{4})[年./-](\d{1,2})[月./-](\d{1,2})/)
  if (m) {
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return s.slice(0, 10)
}

function normalizeElements(raw: Record<string, unknown>): ExtractedFundElements {
  const out: ExtractedFundElements = { ...EMPTY_ELEMENTS }
  for (const key of ELEMENT_KEYS) {
    if (key === "inception_date" || key === "puton_date") {
      out[key] = normalizeDate(raw[key])
      continue
    }
    if (key === "register_number") {
      out[key] = normalizeRegisterCode(normalizeNullableString(raw[key]))
      continue
    }
    out[key] = normalizeNullableString(raw[key])
  }
  return out
}

const EXTRACTION_PROMPT = `你是私募基金合同要素提取专家。请从以下基金合同文本中提取字段，输出纯 JSON，不要 markdown 代码块或额外说明。

字段说明：
- fund_name: 基金全称
- register_number: 备案编号/基金备案号（如 SXN097、SBNX55 等字母数字编码）
- advisor: 投资顾问
- fund_manager: 基金管理人
- inception_date: 成立日期 (YYYY-MM-DD)
- puton_date: 备案日期 (YYYY-MM-DD)
- custodian: 托管人/托管券商
- open_day: 开放日规则描述
- is_temporary_open: 临开信息，取值为 "可"、"不可临开"、"可临开回" 之一；无法判断填 null
- fee_purchase: 申购费
- add_amount: 追加申购限制/最低追加金额
- fee_redeem: 赎回费
- precautious_line: 预警线；无则填 "不设置预警线"
- closed_period: 封闭期
- stop_line: 平仓线/止损线；无则填 "不设置平仓线"
- fee_manage_rate: 年化管理费率，带百分号，如 "1.50%"
- fee_trust: 托管费
- fee_manage: 管理费说明
- fee_admin_service: 外包费/行政服务费
- fee_pay: 业绩报酬说明

无法从合同中确定的字段填 null。只输出 JSON 对象。

份额类别（重要）：
合同常对 A/B/C 类份额规定不同的管理费、业绩报酬、申购赎回或封闭期。遇到这种情况时：
- fee_manage、fee_pay、fee_redeem、fee_purchase、closed_period、add_amount、open_day 必须写成覆盖全部分额的完整说明，按 A/B/C 逐条写明规则，不要只提取其中一类。
- 示例（管理费说明）：「A类（机构/产品类合格投资者）：年化管理费率1%，每日计提、按季支付；B类（个人合格投资者）：年化管理费率0.2%，每日计提、按季支付；C类：年化管理费率1%，每日计提、按季支付。」
- 示例（业绩报酬说明）：「按每个客户/每个账户高水位法计提。A类：对超过0%的收益部分按35%计提业绩报酬；B类：不计提业绩报酬；C类：对超过0%的收益部分按50%计提业绩报酬。」
- fee_manage_rate：各类相同则填该年化费率（如 "1.00%"）；各类不同时填 A 类或主份额费率，细节仍须写在 fee_manage 中。

若文本是补充协议、修订协议、合同变更，或业绩报酬减免说明函、费率调整说明等非合同文件：这些文件同样会影响产品要素。请提取 fund_name、register_number，以及本文件明确变更或重申的最新规则（尤其是 fee_pay、fee_manage）；未提及的字段填 null。
- 落款日期、发函日期、用印日期不是成立日期或备案日期，inception_date 与 puton_date 必须填 null。
- 业绩报酬减免说明：fee_pay 须写明适用份额（A/B/C 或产品代码）、减免比例、减免区间、是否刷新高水位、虚拟净值是否同步、计算公式（如 实际业绩报酬=原计提业绩报酬×(1-减免比例)）。

合同或说明文本：
`

async function extractElementsWithLlm(text: string): Promise<ExtractedFundElements> {
  const truncated = text.slice(0, LLM_TEXT_CHARS)
  const model = new ChatOpenAI({
    apiKey: getDashScopeApiKey(),
    model: process.env.DASHSCOPE_CHAT_MODEL || "qwen-plus",
    temperature: 0,
    streaming: false,
    configuration: { baseURL: getDashScopeBaseUrl() },
  })

  let raw = ""
  try {
    const resp = await model.invoke([{ role: "user", content: EXTRACTION_PROMPT + truncated }])
    raw = stringifyModelContent(resp.content).trim()
  } catch (err) {
    console.error("[fund-contract-element-extract] llm error", err)
    throw new Error("AI 提取失败，请稍后重试")
  }

  const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim()
  try {
    const parsed = JSON.parse(jsonStr)
    if (!parsed || typeof parsed !== "object") return EMPTY_ELEMENTS
    return normalizeElements(parsed as Record<string, unknown>)
  } catch {
    throw new Error("AI 返回格式无效，请重试或更换合同文件")
  }
}

export async function readFundContractText(buffer: Buffer, fileName: string): Promise<string> {
  const ext = getExtension(fileName)
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(SUPPORTED_FORMATS_MESSAGE)
  }
  if (buffer.byteLength > MAX_FILE_BYTES) {
    throw new Error("文件大小不能超过 20MB")
  }

  if (IMAGE_EXTENSIONS.has(ext)) {
    const text = await extractTextFromImage(buffer, ext)
    return text.slice(0, MAX_TEXT_CHARS)
  }

  if (ext === ".pdf") {
    return readPdfTextWithOcrFallback(buffer, fileName)
  }

  const tempDir = getServerStoragePath("fund-elements", "tmp")
  await fs.mkdir(tempDir, { recursive: true })
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
  const tempPath = path.join(tempDir, safeName)

  try {
    await fs.writeFile(tempPath, buffer)
    const text = await readFileDocumentText(tempPath, ext)
    if (!text.trim()) {
      throw new Error("未能从合同中读取文本，请确认文件未加密且内容可读")
    }
    return text.slice(0, MAX_TEXT_CHARS)
  } finally {
    await fs.unlink(tempPath).catch(() => undefined)
  }
}

const BEIAN_CODE_RE = /(?<![A-Z0-9])([A-Z][A-Z0-9]{4,7}[A-Z]?)(?![A-Z0-9])/g

type MatchHints = {
  fileName?: string
  contractText?: string
}

type ScoredFundMatch = FundMatchCandidate & { score: number }

const GENERIC_FILE_NAME_SEGMENTS = new Set([
  "合同",
  "基金合同",
  "产品合同",
  "私募基金合同",
  "私募合同",
  "投资条款",
  "说明函",
  "公告",
  "补充协议",
  "修订协议",
])

function compactFundName(name: string): string {
  return String(name ?? "").replace(/[\s\u3000]+/g, "")
}

function familyKey(name: string): string {
  return fundNameCore(compactFundName(name)).toLowerCase()
}

function serialSuffix(name: string): string {
  const m = fundNameCore(compactFundName(name)).match(/[一二三四五六七八九十百千0-9]+号$/)
  return m?.[0] ?? ""
}

function namesLooselyMatch(a: string, b: string): boolean {
  const left = compactFundName(a)
  const right = compactFundName(b)
  if (!left || !right) return false
  if (left === right) return true
  const guard = serialSuffix(left) === serialSuffix(right)
  const leftBase = fundNameCore(left)
  const rightBase = fundNameCore(right)
  if (left.startsWith(right) && guard) return true
  if (right.startsWith(left) && guard) return true
  if (leftBase && rightBase) {
    if (leftBase === rightBase) return true
    if (leftBase.startsWith(rightBase) && guard) return true
    if (rightBase.startsWith(leftBase) && guard) return true
  }
  return false
}

function shareClassFromFileName(fileName: string): ShareClassLetter | null {
  const fromName = shareClassFromProductName(fileName)
  if (fromName) return fromName
  const base = path.basename(fileName, path.extname(fileName))
  const m = base.match(/号([ABC])(?:类|份额)?(?:_|-|\s|$)/u)
  return m ? (m[1] as ShareClassLetter) : null
}

function fundNameAgrees(fund: FundMatchCandidate, extractedName: string): boolean {
  if (namesLooselyMatch(fund.product_name, extractedName)) return true
  if (fund.short_name && namesLooselyMatch(fund.short_name, extractedName)) return true
  return false
}

function uniqueByBeian(funds: FundMatchCandidate[]): FundMatchCandidate[] {
  const map = new Map<string, FundMatchCandidate>()
  for (const fund of funds) {
    const key = fund.beian_hao.trim().toUpperCase()
    if (key && !map.has(key)) map.set(key, fund)
  }
  return Array.from(map.values())
}

function pickFromFamily(
  pool: FundMatchCandidate[],
  wantedShareClass: ShareClassLetter | null,
): FundMatchCandidate | null {
  const unique = uniqueByBeian(pool)
  if (!unique.length) return null

  if (wantedShareClass) {
    const classHits = unique.filter((fund) => shareClassFromProductName(fund.product_name) === wantedShareClass)
    const uniqueClass = uniqueByBeian(classHits)
    if (uniqueClass.length === 1) return uniqueClass[0]
  }

  const parents = unique.filter((fund) => !shareClassFromProductName(fund.product_name))
  if (parents.length === 1) return parents[0]
  if (unique.length === 1) return unique[0]
  return null
}

function extractBeianCodes(...sources: Array<string | null | undefined>): string[] {
  const out = new Set<string>()
  for (const source of sources) {
    const text = (source ?? "").toUpperCase()
    if (!text) continue
    for (const match of text.matchAll(BEIAN_CODE_RE)) {
      const code = normalizeRegisterCode(match[1])
      if (code) out.add(code)
    }
  }
  return Array.from(out)
}

function extractFundNamesFromFileName(fileName: string): string[] {
  const base = path.basename(fileName, path.extname(fileName))
  const out = new Set<string>()
  for (const segment of base.split(/[-_]/)) {
    const name = segment.trim()
    if (!name || GENERIC_FILE_NAME_SEGMENTS.has(name) || /^\d{8}/.test(name)) continue
    if (/^[A-Z][A-Z0-9]{4,7}[A-Z]?$/.test(name)) continue
    if (name.includes("基金") || name.includes("私募") || name.length >= 4) {
      out.add(name)
    }
  }
  return Array.from(out)
}

function collectMatchNameCandidates(elements: ExtractedFundElements, hints?: MatchHints): string[] {
  const out = new Set<string>()
  const add = (value: string) => {
    const name = value.trim()
    if (!name) return
    out.add(name)
    const compact = compactFundName(name)
    if (compact && compact !== name) out.add(compact)
  }

  const fundName = elements.fund_name?.trim() ?? ""
  if (fundName) add(fundName)

  for (const name of extractFundNamesFromFileName(hints?.fileName ?? "")) {
    // Filenames often include the parent FOF; don't search those once the contract name is known.
    if (fundName && !namesLooselyMatch(name, fundName)) continue
    add(name)
  }
  return Array.from(out)
}

function collectRegisterCandidates(elements: ExtractedFundElements, hints?: MatchHints): string[] {
  const out = new Set<string>()
  const register = normalizeRegisterCode(elements.register_number)
  if (register) out.add(register)
  for (const code of extractBeianCodes(hints?.contractText, elements.fund_name)) out.add(code)
  // Filename codes are often the parent FOF 备案号. Keep them only when the contract name is unknown.
  if (!(elements.fund_name ?? "").trim()) {
    for (const code of extractBeianCodes(hints?.fileName)) out.add(code)
  }
  return Array.from(out)
}

function enrichExtractedRegisterNumber(
  elements: ExtractedFundElements,
  hints?: MatchHints,
): ExtractedFundElements {
  if (normalizeRegisterCode(elements.register_number)) return elements
  const textCodes = extractBeianCodes(hints?.contractText, elements.fund_name)
  if (!textCodes.length) return elements
  return { ...elements, register_number: textCodes[0] }
}

function addMatches(target: Map<string, ScoredFundMatch>, rows: FundMatchCandidate[], score: number) {
  for (const row of rows) {
    const beian = (row.beian_hao ?? "").trim()
    const name = (row.product_name ?? "").trim()
    if (!beian || !name) continue
    const existing = target.get(beian)
    if (!existing || score < existing.score) {
      target.set(beian, { beian_hao: beian, product_name: name, short_name: row.short_name ?? null, score })
    }
  }
}

function rankMatchedFunds(
  matches: ScoredFundMatch[],
  nameCandidates: string[],
  registerCandidates: string[],
): FundMatchCandidate[] {
  const primaryName = nameCandidates[0]?.trim() ?? ""
  const wantedShareClass = primaryName ? shareClassFromProductName(primaryName) : null

  return matches
    .map((row) => {
      let score = row.score
      const registerHit = registerCandidates.includes(row.beian_hao.toUpperCase())
      let nameHit = false
      for (const candidate of nameCandidates) {
        const trimmedCandidate = candidate.trim()
        if (row.product_name.trim() === trimmedCandidate) {
          score -= 15
          nameHit = true
        } else if (namesLooselyMatch(row.product_name, trimmedCandidate)) {
          if (shareClassProductNamesMatch(row.product_name, trimmedCandidate)) {
            score -= 10
            nameHit = true
          } else {
            score += 12
          }
        } else if (row.short_name && namesLooselyMatch(row.short_name, trimmedCandidate)) {
          if (shareClassProductNamesMatch(row.short_name, trimmedCandidate)) {
            score -= 8
            nameHit = true
          } else {
            score += 10
          }
        }
      }

      if (wantedShareClass) {
        const rowShareClass = shareClassFromProductName(row.product_name)
        if (rowShareClass === wantedShareClass) score -= 8
        else if (!rowShareClass) score += 10
        else if (rowShareClass !== wantedShareClass) score += 15
      }

      if (registerHit && nameHit) score -= 10
      else if (registerHit && !nameHit && nameCandidates.length > 0) score += 15
      return { ...row, score }
    })
    .sort((a, b) => a.score - b.score || a.product_name.localeCompare(b.product_name, "zh-CN"))
    .slice(0, 10)
    .map(({ beian_hao, product_name, short_name }) => ({ beian_hao, product_name, short_name }))
}

export function pickHighConfidenceFundMatch(
  extracted: ExtractedFundElements,
  matchedFunds: FundMatchCandidate[],
  hints?: MatchHints,
): FundMatchCandidate | null {
  if (!matchedFunds.length) return null

  const extractedName = (extracted.fund_name ?? "").trim()
  const wantedShareClass =
    shareClassFromProductName(extractedName) ?? shareClassFromFileName(hints?.fileName ?? "")

  const register = normalizeRegisterCode(extracted.register_number)
  if (register) {
    const nameOk = (fund: FundMatchCandidate) => !extractedName || fundNameAgrees(fund, extractedName)
    const exact = matchedFunds.filter(
      (fund) => fund.beian_hao.trim().toUpperCase() === register && nameOk(fund),
    )
    if (exact.length === 1) return exact[0]
    const canon = canonicalizeShareClassBeianCode(register) || register
    const canonHits = matchedFunds.filter((fund) => {
      const code = canonicalizeShareClassBeianCode(fund.beian_hao) || fund.beian_hao.trim().toUpperCase()
      return code === canon && nameOk(fund)
    })
    if (canonHits.length === 1) return canonHits[0]
  }

  if (!extractedName) {
    return pickFromFamily(matchedFunds, wantedShareClass)
  }

  const familyHits = matchedFunds.filter((fund) => fundNameAgrees(fund, extractedName))
  if (!familyHits.length) return null

  const extractedKey = familyKey(extractedName)
  const sameFamily = familyHits.filter((fund) => {
    if (familyKey(fund.product_name) === extractedKey) return true
    if (fund.short_name && familyKey(fund.short_name) === extractedKey) return true
    return false
  })
  return pickFromFamily(sameFamily.length ? sameFamily : familyHits, wantedShareClass)
}

export async function matchFundsFromExtracted(
  elements: ExtractedFundElements,
  hints?: MatchHints,
): Promise<FundMatchCandidate[]> {
  const enriched = enrichExtractedRegisterNumber(elements, hints)
  const registerCandidates = collectRegisterCandidates(enriched, hints)
  const nameCandidates = collectMatchNameCandidates(enriched, hints)
  const scored = new Map<string, ScoredFundMatch>()

  if (registerCandidates.length) {
    addMatches(scored, await searchFundsByRegister(registerCandidates), 0)
  }

  for (const name of nameCandidates) {
    addMatches(scored, await searchTrackingFunds(name, 10), 5)
  }

  if (scored.size === 0 && nameCandidates.length) {
    for (const name of nameCandidates) {
      const core = fundNameCore(name)
      if (!core || core === name) continue
      addMatches(scored, await searchTrackingFunds(core, 10), 8)
    }
  }

  return rankMatchedFunds(Array.from(scored.values()), nameCandidates, registerCandidates)
}

export async function extractFundContractElements(input: {
  buffer: Buffer
  fileName: string
}): Promise<{
  extracted: ExtractedFundElements
  matched_funds: FundMatchCandidate[]
  text_preview: string
}> {
  const text = await readFundContractText(input.buffer, input.fileName)
  const extractedRaw = await extractElementsWithLlm(text)
  const hints = { fileName: input.fileName, contractText: text }
  const extracted = enrichExtractedRegisterNumber(extractedRaw, hints)
  const matched_funds = await matchFundsFromExtracted(extracted, hints)
  return {
    extracted,
    matched_funds,
    text_preview: text.slice(0, 2000),
  }
}

export const FUND_ELEMENT_FIELD_LABELS: Record<keyof ExtractedFundElements, string> = {
  fund_name: "产品全称",
  register_number: "备案编号",
  advisor: "投资顾问",
  fund_manager: "基金管理人",
  inception_date: "成立日期",
  puton_date: "备案日期",
  custodian: "托管券商",
  open_day: "开放日",
  is_temporary_open: "临开信息",
  fee_purchase: "申购费",
  add_amount: "追加限制",
  fee_redeem: "赎回费",
  precautious_line: "预警线",
  closed_period: "封闭期",
  stop_line: "平仓线",
  fee_manage_rate: "管理费率",
  fee_trust: "托管费",
  fee_manage: "管理费说明",
  fee_admin_service: "外包费",
  fee_pay: "业绩报酬说明",
}

export const FUND_ELEMENT_BASIC_KEYS: (keyof ExtractedFundElements)[] = [
  "fund_name",
  "register_number",
  "advisor",
  "fund_manager",
  "inception_date",
  "puton_date",
  "custodian",
]

export const FUND_ELEMENT_SUBSCRIPTION_KEYS: (keyof ExtractedFundElements)[] = [
  "open_day",
  "is_temporary_open",
  "fee_purchase",
  "add_amount",
  "fee_redeem",
  "precautious_line",
  "closed_period",
  "stop_line",
  "fee_manage_rate",
  "fee_trust",
  "fee_manage",
  "fee_admin_service",
  "fee_pay",
]
