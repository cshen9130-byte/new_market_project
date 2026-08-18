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
import {
  formatFeePayFormula,
  formatTemporaryOpen,
  parseFeePayFormulaConfig,
  type FeePayFormulaConfig,
} from "@/lib/ma/fund-elements-extra"
import {
  fillMissingElementsFromKeywords,
  isWeakAddAmount,
  isWeakFeeManage,
  isWeakFeePay,
  isWeakFormula,
  isWeakLockPeriod,
  isWeakRiskLevel,
  isWeakShortFee,
  isWeakTemporaryOpen,
} from "@/lib/server/fund-contract-element-keywords"

const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_TEXT_CHARS = 160_000
const LLM_TEXT_CHARS = 48_000
const PDF_OCR_MAX_PAGES = 8
const SPARSE_PDF_TEXT_CHARS = 80
const CONTRACT_HEAD_CHARS = 8_000
const CONTRACT_WINDOW_GAP = 120

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
  risk_level: string | null
  lock_period_desc: string | null
  fee_pay_formula: string | null
  fee_pay_formula_config?: FeePayFormulaConfig | null
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
  risk_level: null,
  lock_period_desc: null,
  fee_pay_formula: null,
}

export type ExtractedFundElementTextKey = Exclude<keyof ExtractedFundElements, "fee_pay_formula_config">

const ELEMENT_KEYS = Object.keys(EMPTY_ELEMENTS) as ExtractedFundElementTextKey[]

const FEE_AND_SUBSCRIPTION_KEYS: ExtractedFundElementTextKey[] = [
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
  "risk_level",
  "lock_period_desc",
  "fee_pay_formula",
]

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
  try {
    const ocr = await ocrPdfPages(buffer)
    if (ocr && !isSparsePdfText(ocr)) return ocr.slice(0, MAX_TEXT_CHARS)
  } catch (err) {
    console.error("[fund-contract-element-extract] pdf ocr fallback failed", err)
  }
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
  const s = String(value).replace(/\u0000/g, "").trim()
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
    if (key === "is_temporary_open") {
      out[key] = formatTemporaryOpen(raw[key])
      continue
    }
    out[key] = normalizeNullableString(raw[key])
  }
  const config = parseFeePayFormulaConfig(
    raw.fee_pay_formula_config ?? {
      mode: raw.fee_pay_mode,
      gradients: raw.fee_pay_gradients,
    },
  )
  if (config) out.fee_pay_formula_config = config
  if (!out.fee_pay_formula && config) {
    out.fee_pay_formula = formatFeePayFormula(config)
  }
  return out
}

type ContractSectionGroup = "fees" | "perf" | "lock" | "risk" | "subscription"

type ContractSectionWindow = {
  re: RegExp
  before: number
  after: number
  priority: number
  group?: ContractSectionGroup
}

const CONTRACT_SECTION_WINDOWS: ContractSectionWindow[] = [
  { re: /管理费/g, before: 240, after: 3200, priority: 10, group: "fees" },
  { re: /托管费/g, before: 200, after: 2400, priority: 10, group: "fees" },
  { re: /运营服务费|外包费|行政服务费|销售服务费/g, before: 180, after: 2200, priority: 9, group: "fees" },
  { re: /业绩报酬的?计算?公式|计提公式/g, before: 200, after: 2800, priority: 12, group: "perf" },
  { re: /业绩报酬|业绩提成|提取比例|高水位/g, before: 500, after: 4200, priority: 10, group: "perf" },
  { re: /年化收益率|计提比例/g, before: 300, after: 2800, priority: 9, group: "perf" },
  { re: /申购费|赎回费/g, before: 180, after: 1800, priority: 8, group: "subscription" },
  { re: /开放日|临时开放|临开/g, before: 180, after: 2000, priority: 8, group: "subscription" },
  { re: /封闭期|锁定期|份额锁定|不满.{0,12}不得赎回/g, before: 180, after: 2200, priority: 11, group: "lock" },
  { re: /预警线|止损线|平仓线/g, before: 120, after: 1400, priority: 8, group: "subscription" },
  { re: /风险等级|风险评级|本基金属于\s*R[1-5]|R[1-5]\s*[（(][^)）]{0,16}风险|中高风险|中低风险/g, before: 80, after: 900, priority: 11, group: "risk" },
  { re: /追加申购|最低追加|追加金额/g, before: 80, after: 900, priority: 6, group: "subscription" },
  { re: /是否可赎回|赎回申请/g, before: 80, after: 900, priority: 5, group: "subscription" },
]

const KEYWORD_FALLBACK_KEYS: ExtractedFundElementTextKey[] = [
  "risk_level",
  "lock_period_desc",
  "fee_pay",
  "fee_pay_formula",
  "fee_manage",
  "add_amount",
  "fee_redeem",
  "closed_period",
  "fee_trust",
  "fee_admin_service",
  "is_temporary_open",
]

const MISSING_FIELD_GROUPS: Partial<Record<ExtractedFundElementTextKey, ContractSectionGroup>> = {
  risk_level: "risk",
  lock_period_desc: "lock",
  closed_period: "lock",
  fee_pay_formula: "perf",
  fee_pay: "perf",
  fee_manage: "fees",
  add_amount: "subscription",
  fee_redeem: "subscription",
  fee_trust: "fees",
  fee_admin_service: "fees",
  fee_manage_rate: "fees",
  is_temporary_open: "subscription",
}

type TextRange = { start: number; end: number; priority: number; group?: ContractSectionGroup }

function findAllIndices(text: string, pattern: RegExp): number[] {
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`)
  const out: number[] = []
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    out.push(match.index)
    if (match[0].length === 0) re.lastIndex += 1
  }
  return out
}

function mergeTextRanges(ranges: TextRange[]): TextRange[] {
  if (!ranges.length) return []
  const sorted = [...ranges].sort((a, b) => a.start - b.start || b.priority - a.priority)
  const merged: TextRange[] = [{ ...sorted[0] }]
  for (const range of sorted.slice(1)) {
    const last = merged[merged.length - 1]
    if (range.start <= last.end + CONTRACT_WINDOW_GAP) {
      last.end = Math.max(last.end, range.end)
      if (range.priority >= last.priority) {
        last.priority = range.priority
        if (range.group) last.group = range.group
      }
    } else {
      merged.push({ ...range })
    }
  }
  return merged
}

function clipRangesToBudget(ranges: TextRange[], budget: number): TextRange[] {
  const total = ranges.reduce((sum, range) => sum + (range.end - range.start), 0)
  if (total <= budget) return ranges

  const reservedGroups = new Set<ContractSectionGroup>(["risk", "lock", "perf"])
  const reserved: TextRange[] = []
  const general: TextRange[] = []
  for (const range of ranges) {
    if (range.group && reservedGroups.has(range.group)) reserved.push(range)
    else general.push(range)
  }

  const kept: TextRange[] = []
  let used = 0
  const take = (pool: TextRange[]) => {
    const ranked = [...pool].sort(
      (a, b) => b.priority - a.priority || (b.end - b.start) - (a.end - a.start),
    )
    for (const range of ranked) {
      const size = range.end - range.start
      if (used + size > budget && kept.length > 0) continue
      kept.push(range)
      used += size
      if (used >= budget) break
    }
  }
  take(reserved)
  if (used < budget) take(general)
  return kept.sort((a, b) => a.start - b.start)
}

export function selectContractTextForExtraction(
  text: string,
  options?: { feeOnly?: boolean; maxChars?: number; groups?: ContractSectionGroup[]; headChars?: number },
): string {
  const maxChars = options?.maxChars ?? LLM_TEXT_CHARS
  const source = text.slice(0, MAX_TEXT_CHARS)
  if (source.length <= maxChars && !options?.groups) return source

  const headChars = options?.headChars ?? (options?.feeOnly ? 1_500 : CONTRACT_HEAD_CHARS)
  const head = source.slice(0, Math.min(headChars, source.length))
  const budget = Math.max(4_000, maxChars - head.length - 400)
  const windows = options?.groups?.length
    ? CONTRACT_SECTION_WINDOWS.filter((window) => window.group && options.groups?.includes(window.group))
    : CONTRACT_SECTION_WINDOWS
  const ranges: TextRange[] = []
  for (const window of windows) {
    for (const index of findAllIndices(source, window.re)) {
      ranges.push({
        start: Math.max(0, index - window.before),
        end: Math.min(source.length, index + window.after),
        priority: window.priority,
        group: window.group,
      })
    }
  }
  const selected = clipRangesToBudget(mergeTextRanges(ranges), budget)
  const parts = [head]
  let cursor = head.length
  for (const range of selected) {
    if (range.end <= cursor) continue
    const start = Math.max(range.start, cursor)
    if (start > cursor + 40) parts.push("……")
    parts.push(source.slice(start, range.end).trim())
    cursor = range.end
  }
  const combined = parts.filter(Boolean).join("\n\n").trim()
  return combined.slice(0, maxChars) || source.slice(0, maxChars)
}

function filledFieldCount(extracted: ExtractedFundElements, keys: ExtractedFundElementTextKey[]): number {
  return keys.filter((key) => Boolean(extracted[key]?.trim())).length
}

function mergeExtractedElements(
  base: ExtractedFundElements,
  extra: ExtractedFundElements,
): ExtractedFundElements {
  const out: ExtractedFundElements = { ...base }
  for (const key of ELEMENT_KEYS) {
    if (!out[key]?.trim() && extra[key]?.trim()) out[key] = extra[key]
  }
  if (!out.fee_pay_formula_config && extra.fee_pay_formula_config) {
    out.fee_pay_formula_config = extra.fee_pay_formula_config
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
- open_day: 开放日，一两句。不要把锁定期、赎回费写进本字段。
- is_temporary_open: "可临开"、"否"、"不可临开"、"可临开回" 之一；不要填 0、1、2。
- fee_purchase: 申购费率，如 "0%"。
- add_amount: 追加/申购金额限制，一两句，如「首次净申购不低于100万元」。
- fee_redeem: 赎回费，尽量写成「持有不足90天0.5%，满90天0%」或「0%」。不要摘录计算过程。
- precautious_line: 预警线；无则填 "不设置预警线"
- closed_period: 封闭期，如「不设置」或「6个月」。不要摘录释义。
- stop_line: 平仓线/止损线；无则填 "不设置平仓线"
- risk_level: 产品风险等级，如 "R5（高风险）"。合同可能写成「本基金风险等级为[R5]」。不要把 C5 投资者适当性或期货工具风险当成产品风险等级。
- lock_period_desc: 锁定期，最多一句。表格「不设置」就填「不设置」；「不满6个月不得赎回」就填该句。禁止摘录释义第43条、不可抗力、形式监督。
- fee_manage_rate: 年化管理费率，如 "1.00%"。
- fee_trust: 托管费，最多一句，如「年托管费率0.015%，每日计提，按自然季度支付。」禁止 H＝E 公式和划款流程。
- fee_manage: 管理费说明，最多一句，如「年管理费率1%，每日计提，按自然季度支付。」禁止 H＝E 公式、费用种类清单、划款流程。
- fee_admin_service: 外包费/运营服务费，最多一句，如「年运营服务费率0.015%，每日计提，按自然季度支付。」
- fee_pay: 业绩报酬说明，一两句：基准、计提比例、计提时点。不要整章费用与税收。
- fee_pay_formula: 只保留公式本身，一两行，如「R>6%时提取40%。R=(A-B)/C×365/N；E=K×T1×(R-B)×T/365×40%。」禁止费用种类清单、管理费/托管费公式、页码。
- fee_pay_formula_config: 若能归纳为单一主份额公式则输出对象，否则 null。格式：
  {"mode":"annual_gradient"|"excess_gradient"|"fixed"|"none","gradients":[{"fromPct":"0","toPct":"6","ratePct":"20"}]}

无法从合同中确定的字段填 null。只输出 JSON 对象。文本可能用“……”省略无关章节，费用、申赎、锁定期、风险等级、业绩报酬仍完整出现在摘录中，必须提取，不要因为不在文首或标题用词不完全一致就填 null。

字段定位提示：
- 标题可能是「业绩报酬的计算公式」而不是「业绩报酬公式」；可能是「基金份额的锁定期」而不是「锁定期说明」。按关键词搜索并阅读前后段落。
- 风险等级可能嵌在句子里（「属于 R4（中高风险）投资品种」），不要只在表格或「风险等级：」标签后查找。

份额类别（重要）：
合同常对 A/B/C 类份额规定不同费率。遇到这种情况时：
- 用短句按类别列出，如「A类年管理费率1%；B类1.5%」。禁止摘录整章、H＝E 公式、划款流程、页码。
- 示例（管理费说明）：「年管理费率1%，每日计提，按季支付。」
- 示例（托管费）：「年托管费率0.015%，每日计提，按自然季度支付。」
- 示例（外包费）：「年运营服务费率0.015%，每日计提，按自然季度支付。」
- 示例（业绩报酬说明）：「按业绩基准计提，业绩基准6%，计提比例40%。」
- 示例（业绩报酬公式）：「基准6%；超额计提40%；R=(A-B)/C×365/N。」
- fee_manage_rate：各类相同则填该年化费率（如 "1.00%"）；各类不同时填 A 类或主份额费率，细节仍须写在 fee_manage 中。

若文本是补充协议、修订协议、合同变更，或业绩报酬减免说明函、费率调整说明等非合同文件：这些文件同样会影响产品要素。请提取 fund_name、register_number，以及本文件明确变更或重申的最新规则（尤其是 fee_pay、fee_manage）；未提及的字段填 null。
- 落款日期、发函日期、用印日期不是成立日期或备案日期，inception_date 与 puton_date 必须填 null。
- 业绩报酬减免说明：fee_pay 须写明适用份额（A/B/C 或产品代码）、减免比例、减免区间、是否刷新高水位、虚拟净值是否同步、计算公式（如 实际业绩报酬=原计提业绩报酬×(1-减免比例)）。

合同或说明文本：
`

async function invokeElementExtraction(selectedText: string): Promise<ExtractedFundElements> {
  const model = new ChatOpenAI({
    apiKey: getDashScopeApiKey(),
    model: process.env.DASHSCOPE_CHAT_MODEL || "qwen-plus",
    temperature: 0,
    streaming: false,
    configuration: { baseURL: getDashScopeBaseUrl() },
  })

  let raw = ""
  try {
    const resp = await model.invoke([{ role: "user", content: EXTRACTION_PROMPT + selectedText }])
    raw = stringifyModelContent(resp.content).trim()
  } catch (err) {
    console.error("[fund-contract-element-extract] llm error", err)
    throw new Error("AI 提取失败，请稍后重试")
  }

  const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim()
  try {
    const parsed = JSON.parse(jsonStr)
    if (!parsed || typeof parsed !== "object") return { ...EMPTY_ELEMENTS }
    return normalizeElements(parsed as Record<string, unknown>)
  } catch {
    throw new Error("AI 返回格式无效，请重试或更换合同文件")
  }
}

export function softenWeakExtractedFields(extracted: ExtractedFundElements): ExtractedFundElements {
  return {
    ...extracted,
    risk_level: isWeakRiskLevel(extracted.risk_level) ? null : extracted.risk_level,
    lock_period_desc: isWeakLockPeriod(extracted.lock_period_desc) ? null : extracted.lock_period_desc,
    fee_pay_formula: isWeakFormula(extracted.fee_pay_formula) ? null : extracted.fee_pay_formula,
    fee_manage: isWeakFeeManage(extracted.fee_manage) ? null : extracted.fee_manage,
    fee_pay: isWeakFeePay(extracted.fee_pay) ? null : extracted.fee_pay,
    add_amount: isWeakAddAmount(extracted.add_amount) ? null : extracted.add_amount,
    fee_redeem: isWeakShortFee(extracted.fee_redeem) ? null : extracted.fee_redeem,
    closed_period: isWeakShortFee(extracted.closed_period) ? null : extracted.closed_period,
    fee_trust: isWeakShortFee(extracted.fee_trust) ? null : extracted.fee_trust,
    fee_admin_service: isWeakShortFee(extracted.fee_admin_service) ? null : extracted.fee_admin_service,
    is_temporary_open: isWeakTemporaryOpen(extracted.is_temporary_open) ? null : extracted.is_temporary_open,
  }
}

export function applyContractKeywordFallbacks(
  text: string,
  extracted?: ExtractedFundElements | null,
): ExtractedFundElements {
  const filled = fillMissingElementsFromKeywords(text, softenWeakExtractedFields({
    ...EMPTY_ELEMENTS,
    ...(extracted ?? {}),
  }))
  const out: ExtractedFundElements = {
    ...filled,
    is_temporary_open: formatTemporaryOpen(filled.is_temporary_open) ?? filled.is_temporary_open,
  }
  for (const key of ELEMENT_KEYS) {
    const value = out[key]
    if (typeof value === "string") out[key] = value.replace(/\u0000/g, "")
  }
  return out
}

function missingKeywordFields(extracted: ExtractedFundElements): ExtractedFundElementTextKey[] {
  return KEYWORD_FALLBACK_KEYS.filter((key) => !extracted[key]?.trim())
}

async function extractElementsWithLlm(text: string): Promise<ExtractedFundElements> {
  const selected = selectContractTextForExtraction(text)
  console.log(
    `[fund-contract-element-extract] contract chars=${text.length} selected chars=${selected.length}`,
  )
  let extracted = await invokeElementExtraction(selected)
  const feeKeywordsPresent = /管理费|托管费|业绩报酬|运营服务费/.test(selected)
  if (feeKeywordsPresent && filledFieldCount(extracted, FEE_AND_SUBSCRIPTION_KEYS) < 4) {
    const feeOnly = selectContractTextForExtraction(text, { feeOnly: true })
    try {
      const feeExtracted = await invokeElementExtraction(feeOnly)
      extracted = mergeExtractedElements(extracted, feeExtracted)
    } catch (err) {
      console.error("[fund-contract-element-extract] fee fallback failed", err)
    }
  }

  extracted = applyContractKeywordFallbacks(text, extracted)
  const stillMissing = missingKeywordFields(extracted)
  if (stillMissing.length) {
    const groups = Array.from(
      new Set(
        stillMissing
          .map((key) => MISSING_FIELD_GROUPS[key])
          .filter((group): group is ContractSectionGroup => Boolean(group)),
      ),
    )
    const focused = selectContractTextForExtraction(text, {
      groups,
      maxChars: 16_000,
      headChars: 400,
    })
    if (focused.length > 120) {
      try {
        const extra = await invokeElementExtraction(focused)
        extracted = applyContractKeywordFallbacks(
          text,
          mergeExtractedElements(extracted, extra),
        )
      } catch (err) {
        console.error("[fund-contract-element-extract] keyword fallback failed", err)
      }
    }
  }
  return extracted
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

export const FUND_ELEMENT_FIELD_LABELS: Record<ExtractedFundElementTextKey, string> = {
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
  risk_level: "风险等级",
  lock_period_desc: "锁定期说明",
  fee_pay_formula: "业绩报酬公式",
}

export const FUND_ELEMENT_BASIC_KEYS: ExtractedFundElementTextKey[] = [
  "fund_name",
  "register_number",
  "advisor",
  "fund_manager",
  "inception_date",
  "puton_date",
  "custodian",
]

export const FUND_ELEMENT_SUBSCRIPTION_KEYS: ExtractedFundElementTextKey[] = [
  "open_day",
  "is_temporary_open",
  "fee_purchase",
  "add_amount",
  "fee_redeem",
  "precautious_line",
  "closed_period",
  "stop_line",
  "risk_level",
  "lock_period_desc",
  "fee_manage_rate",
  "fee_trust",
  "fee_manage",
  "fee_admin_service",
  "fee_pay",
  "fee_pay_formula",
]
