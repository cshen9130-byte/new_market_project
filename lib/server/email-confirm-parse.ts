/**
 * Parse broker 交易确认单 / 确认函 PDF text into structured fields.
 * Styles covered: 国泰海通 / 华泰 / 招商 / 中金 / 中信 / 众量(恒生TA bilingual) (and generic fallbacks).
 */

import { PDFParse } from "pdf-parse"
import { CanvasFactory, getData } from "pdf-parse/worker"

PDFParse.setWorker(getData())

export type ParsedConfirmSlip = {
  fundName: string | null
  fundCode: string | null
  investorName: string | null
  applyDate: string | null
  confirmDate: string | null
  businessType: string | null
  confirmedAmount: string | null
  confirmedShares: string | null
  unitNav: string | null
  tradeFee: string | null
  broker: string | null
  rawTextPreview: string
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function toIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.trim()
  let m = s.match(/^(20\d{2})[年/-](\d{1,2})[月/-](\d{1,2})/)
  if (m) {
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`
  }
  m = s.match(/^(20\d{2})(\d{2})(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(20\d{2})-(\d{2})-(\d{2})$/)
  if (m) return s.slice(0, 10)
  return null
}

function toNumberString(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = raw.replace(/,/g, "").replace(/元|份/g, "").trim()
  if (!cleaned) return null
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  return cleaned
}

/** Reject bilingual PDF field labels mistaken for values (e.g. "Fund Name" → "FundName"). */
function cleanCapturedValue(raw: string | null | undefined): string | null {
  if (!raw) return null
  const v = raw.trim()
  if (!v) return null
  const compact = v.replace(/\s+/g, "")
  const labelOnly =
    /^(FundName|InvestorName|FundCode|FundNumber|BusinessType|TransactionType|ApplicationDate|TradeDate|ConfirmedDate|ConfirmationDate|ConfirmedAmount|ConfirmedNetAmount|ConfirmedShares?|NetAssetValue|NAVperShare|TransactionFee|TradeFee)$/i.test(
      compact,
    )
    || /^(基金名称|产品名称|投资人名称|客户名称|委托人名称|基金代码|产品代码|业务类型|申请日期|确认日期|确认金额|确认净额|确认份额|单位净值|交易费用|手续费)$/.test(
      compact,
    )
  if (labelOnly) return null
  return v
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = text.match(re)
    const cleaned = cleanCapturedValue(m?.[1])
    if (cleaned) return cleaned
  }
  return null
}

/**
 * After a Chinese (or English) label, skip bilingual label noise and capture the first
 * matching value in a short window. Handles layouts like:
 *   单位净值 NAV per Share 1.1451
 *   确认金额(元) Confirmed Amount (CNY)\n1,000,000.00
 */
function valueAfterLabel(
  text: string,
  labelPattern: RegExp,
  valuePattern: RegExp,
  window = 160,
): string | null {
  const flags = labelPattern.flags.includes("g") ? labelPattern.flags : `${labelPattern.flags}g`
  const labelRe = new RegExp(labelPattern.source, flags)
  let labelMatch: RegExpExecArray | null
  while ((labelMatch = labelRe.exec(text)) != null) {
    const start = labelMatch.index + labelMatch[0].length
    // Trim leading whitespace so bilingual labels / values align reliably.
    const sliceRaw = text.slice(start, start + window)
    const lead = sliceRaw.match(/^\s*/)?.[0].length ?? 0
    const slice = sliceRaw.slice(lead)
    const valueMatch = slice.match(valuePattern)
    const cleaned = cleanCapturedValue(valueMatch?.[1] ?? null)
    if (cleaned) return cleaned
  }
  return null
}

const DATE_VALUE =
  /((?:20\d{2}[年/-]\d{1,2}[月/-]\d{1,2}日?|20\d{6}|20\d{2}-\d{2}-\d{2}))/
const AMOUNT_VALUE = /([0-9,]+\.\d{2})(?!\d)/
const SHARES_VALUE = /([0-9,]+\.\d{2,8})(?!\d)/
const NAV_VALUE = /([0-9]+\.\d{2,8})(?!\d)/
const FUND_CODE_VALUE = /\b([A-Za-z]{0,4}\d[A-Za-z0-9]{2,10}|[A-Z]{5,10}\d[A-Za-z0-9]*)\b/

function looksLikeFundCode(value: string | null | undefined): string | null {
  const v = cleanCapturedValue(value)
  if (!v) return null
  if (!/^[A-Za-z0-9]{4,12}$/.test(v)) return null
  if (/^(FUND|CODE|NUMBER|NAME|SHARE|DATE|TYPE|AMOUNT|STATUS|AMAC)$/i.test(v)) return null
  // Real product/TA codes almost always include a digit (BLF14C / SBLF14 / 000001).
  if (!/\d/.test(v)) return null
  return v.toUpperCase()
}

function detectBroker(text: string, filename: string, subject: string): string | null {
  const blob = `${text}\n${filename}\n${subject}`
  if (/国泰海通/.test(blob)) return "国泰海通"
  if (/华泰证券|华泰/.test(blob)) return "华泰"
  if (/招商证券|招商/.test(blob)) return "招商"
  if (/中金公司|中国国际金融|中金/.test(blob)) return "中金"
  if (/中信证券|中信/.test(blob)) return "中信"
  if (/众量/.test(blob)) return "众量"
  return null
}

export function extractConfirmFieldsFromText(
  text: string,
  filename = "",
  subject = "",
): ParsedConfirmSlip {
  const t = normalizeWhitespace(text)

  const fundName =
    cleanCapturedValue(
      valueAfterLabel(
        t,
        // Avoid matching inside 协会基金名称.
        /(?<!协)基金名称(?:\s*\([^)]*\))?/g,
        /\s*(?:Fund\s*Name\s+)?([^\n]{2,80}?)(?=\s*(?:基金代码|Fund\s*Code|协会基金|AMAC\b|管理人|业务类型|Transaction|$|\n\n))/,
        120,
      ),
    ) ||
    firstMatch(t, [
      /(?<!协)基金名称(?:\s*\([^)]*\))?(?:\s*Fund\s*Name)?\s*([^\n]{2,80}?)(?=\s*(?:基金代码|Fund\s*Code|协会基金|AMAC\b))/,
      /产品名称[：:]\s*([^\n]{2,80})/,
    ])

  const fundCode =
    looksLikeFundCode(
      valueAfterLabel(
        t,
        // Prefer product 基金代码 over 协会基金代码.
        /(?<!协会)基金代码(?:\s*\([^)]*\))?|产品代码/g,
        /\s*(?:Fund\s*(?:Code|Number)\s+)?([A-Za-z0-9]{4,12})/,
        80,
      ),
    ) ||
    looksLikeFundCode(
      valueAfterLabel(t, /Fund\s*(?:Code|Number)/gi, FUND_CODE_VALUE, 40),
    ) ||
    looksLikeFundCode(
      firstMatch(t, [
        /(?<!协会)基金代码(?:\s*\([^)]*\))?(?:\s*Fund\s*(?:Code|Number))?\s*([A-Za-z0-9]{4,12})/,
        /产品代码[：:]\s*([A-Za-z0-9]{4,12})/,
      ]),
    )

  const investorName = firstMatch(t, [
    /投资人名称(?:\s*\([^)]*\))?(?:\s*Investor\s*Name)?\s*([^\n证件号码证件类型投资人类型]{2,40})/,
    /客户名称(?:\s*\([^)]*\))?\s*([^\n客户类型]{2,40})/,
    /委托人名称\s+([^\n]{2,40})/,
    /Investor\s*Name\s+([^\n]{2,40})/,
    /尊敬的([^您，,\s]{2,20})您好/,
  ])

  const applyDate = toIsoDate(
    valueAfterLabel(
      t,
      /申请日期(?:\s*\([^)]*\))?|Application\s*Date|Trade\s*Date/gi,
      DATE_VALUE,
    ) ||
      firstMatch(t, [
        /申请日期(?:\s*\([^)]*\))?\s*((?:20\d{2}[年/-]\d{1,2}[月/-]\d{1,2}日?|20\d{6}|20\d{2}-\d{2}-\d{2}))/,
        /Application\s*Date\s*((?:20\d{2}[年/-]\d{1,2}[月/-]\d{1,2}日?|20\d{6}|20\d{2}-\d{2}-\d{2}))/,
        /Trade\s*Date\s*((?:20\d{2}[年/-]\d{1,2}[月/-]\d{1,2}日?|20\d{6}|20\d{2}-\d{2}-\d{2}))/,
      ]),
  )

  const confirmDate = toIsoDate(
    valueAfterLabel(
      t,
      /确认日期(?:\s*\([^)]*\))?|Confirmation\s*Date|Confirmed\s*Date/gi,
      DATE_VALUE,
    ) ||
      firstMatch(t, [
        /确认日期(?:\s*\([^)]*\))?\s*((?:20\d{2}[年/-]\d{1,2}[月/-]\d{1,2}日?|20\d{6}|20\d{2}-\d{2}-\d{2}))/,
        /Confirmed\s*Date\s*((?:20\d{2}[年/-]\d{1,2}[月/-]\d{1,2}日?|20\d{6}|20\d{2}-\d{2}-\d{2}))/,
        /Confirmation\s*Date\s*((?:20\d{2}[年/-]\d{1,2}[月/-]\d{1,2}日?|20\d{6}|20\d{2}-\d{2}-\d{2}))/,
      ]),
  )

  const businessType = firstMatch(t, [
    /业务类型(?:\s*\([^)]*\))?(?:\s*Transaction\s*Type|\s*Business\s*Type)?\s*([^\n确认状态Confirmed]{2,20})/,
    /Business\s*Type\s*([^\n]{2,20})/,
    /Transaction\s*Type\s*([^\n]{2,20})/,
  ])

  const confirmedAmount = toNumberString(
    valueAfterLabel(
      t,
      /确认金额(?:\s*\([^)]*\))?|Confirmed\s*(?:Net\s*)?Amount(?:\s*\([^)]*\))?/gi,
      AMOUNT_VALUE,
    ) ||
      firstMatch(t, [
        /确认金额(?:\s*\([^)]*\))?[：:\s]*([0-9,]+\.\d{2})/,
        /确认净额(?:\s*\([^)]*\))?[：:\s]*([0-9,]+\.\d{2})/,
        /Confirmed\s*(?:Amount|Net\s*Amount)[：:\s]*([0-9,]+\.\d{2})/,
      ]),
  )

  const confirmedShares = toNumberString(
    valueAfterLabel(
      t,
      /确认份额(?:\s*\([^)]*\))?|Confirmed\s*Shares?(?:\s*\([^)]*\))?/gi,
      SHARES_VALUE,
    ) ||
      firstMatch(t, [
        /确认份额(?:\s*\([^)]*\))?[：:\s]*([0-9,]+\.\d{2,8})/,
        /Confirmed\s*Share[s]?[：:\s]*([0-9,]+\.\d{2,8})/,
      ]),
  )

  const unitNav = toNumberString(
    valueAfterLabel(
      t,
      /单位净值(?:\s*\([^)]*\))?|NAV\s*per\s*Share|Net\s*Asset\s*Value(?:\s*\([^)]*\))?/gi,
      NAV_VALUE,
    ) ||
      firstMatch(t, [
        /单位净值(?:\s*\([^)]*\))?[：:\s]*([0-9]+\.\d{2,8})/,
        /Net\s*Asset\s*Value[：:\s]*([0-9]+\.\d{2,8})/,
        /NAV\s*per\s*Share[：:\s]*([0-9]+\.\d{2,8})/,
      ]),
  )

  const tradeFee = toNumberString(
    valueAfterLabel(
      t,
      /交易费(?:用)?(?:\s*\([^)]*\))?|Trade\s*Fee(?:\s*\([^)]*\))?|Transaction\s*[Ff]ee(?:\s*\([^)]*\))?|手续费用?/gi,
      AMOUNT_VALUE,
    ) ||
      firstMatch(t, [
        /交易费(?:用)?(?:\s*\([^)]*\))?[：:\s]*([0-9,]+\.\d{2})/,
        /手续费用?[：:\s]*([0-9,]+\.\d{2})/,
        /Transaction\s*[Ff]ee[：:\s]*([0-9,]+\.\d{2})/,
        /Trade\s*Fee[：:\s]*([0-9,]+\.\d{2})/,
      ]),
  )

  return {
    fundName: fundName?.replace(/\s+/g, "").replace(/^FundName/i, "") || null,
    fundCode: fundCode ?? null,
    investorName: investorName ?? null,
    applyDate,
    confirmDate,
    businessType: businessType?.replace(/[A-Za-z].*$/, "").replace(/\s+/g, "") || null,
    confirmedAmount,
    confirmedShares,
    unitNav,
    tradeFee,
    broker: detectBroker(t, filename, subject),
    rawTextPreview: t.slice(0, 800),
  }
}

export async function extractConfirmTextFromBuffer(
  buffer: Buffer,
  filename: string,
): Promise<string> {
  const lower = filename.toLowerCase()
  if (lower.endsWith(".pdf")) {
    const parser = new PDFParse({ data: buffer, CanvasFactory })
    try {
      const result = await parser.getText()
      return normalizeWhitespace(result.text || "")
    } finally {
      await parser.destroy?.()
    }
  }
  // Image / office: no OCR in v1 — return empty so we still store the file.
  return ""
}

export async function parseConfirmSlipFromBuffer(
  buffer: Buffer,
  filename: string,
  subject = "",
): Promise<ParsedConfirmSlip> {
  const text = await extractConfirmTextFromBuffer(buffer, filename)
  return extractConfirmFieldsFromText(text, filename, subject)
}
