/**
 * Parse broker 交易确认单 / 确认函 PDF text into structured fields.
 * Styles covered: 国泰海通 / 华泰 / 招商 / 中金 / 中信 (and generic fallbacks).
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

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1]?.trim()) return m[1].trim()
  }
  return null
}

function detectBroker(text: string, filename: string, subject: string): string | null {
  const blob = `${text}\n${filename}\n${subject}`
  if (/国泰海通/.test(blob)) return "国泰海通"
  if (/华泰证券|华泰/.test(blob)) return "华泰"
  if (/招商证券|招商/.test(blob)) return "招商"
  if (/中金公司|中国国际金融|中金/.test(blob)) return "中金"
  if (/中信证券|中信/.test(blob)) return "中信"
  return null
}

function extractFromText(text: string, filename: string, subject: string): ParsedConfirmSlip {
  const t = normalizeWhitespace(text)

  const fundName = firstMatch(t, [
    /基金名称(?:\s*\([^)]*\))?\s*([^\n基金代码管理人销售商客户名称投资人委托人]{2,80})/,
    /产品名称[：:]\s*([^\n]{2,80})/,
    /Fund\s*Name\s+([^\n]{2,80})/,
  ])

  const fundCode = firstMatch(t, [
    /基金代码(?:\s*\([^)]*\))?\s*([A-Za-z0-9]{4,12})/,
    /产品代码[：:]\s*([A-Za-z0-9]{4,12})/,
    /Fund\s*(?:Code|Number)\s+([A-Za-z0-9]{4,12})/,
  ])

  const investorName = firstMatch(t, [
    /投资人名称(?:\s*\([^)]*\))?\s*([^\n证件号码证件类型投资人类型]{2,40})/,
    /客户名称(?:\s*\([^)]*\))?\s*([^\n客户类型]{2,40})/,
    /委托人名称\s+([^\n]{2,40})/,
    /Investor\s*Name\s+([^\n]{2,40})/,
    /尊敬的([^您，,\s]{2,20})您好/,
  ])

  const applyDate = toIsoDate(
    firstMatch(t, [
      /申请日期(?:\s*\([^)]*\))?\s*((?:20\d{2}[年/-]\d{1,2}[月/-]\d{1,2}日?|20\d{6}|20\d{2}-\d{2}-\d{2}))/,
      /Application\s*Date\s*((?:20\d{2}[年/-]\d{1,2}[月/-]\d{1,2}日?|20\d{6}|20\d{2}-\d{2}-\d{2}))/,
      /Trade\s*Date\s*((?:20\d{2}[年/-]\d{1,2}[月/-]\d{1,2}日?|20\d{6}|20\d{2}-\d{2}-\d{2}))/,
    ]),
  )

  const confirmDate = toIsoDate(
    firstMatch(t, [
      /确认日期(?:\s*\([^)]*\))?\s*((?:20\d{2}[年/-]\d{1,2}[月/-]\d{1,2}日?|20\d{6}|20\d{2}-\d{2}-\d{2}))/,
      /Confirmed\s*Date\s*((?:20\d{2}[年/-]\d{1,2}[月/-]\d{1,2}日?|20\d{6}|20\d{2}-\d{2}-\d{2}))/,
      /Confirmation\s*Date\s*((?:20\d{2}[年/-]\d{1,2}[月/-]\d{1,2}日?|20\d{6}|20\d{2}-\d{2}-\d{2}))/,
    ]),
  )

  const businessType = firstMatch(t, [
    /业务类型(?:\s*\([^)]*\))?\s*([^\n确认状态Confirmed]{2,20})/,
    /Business\s*Type\s*([^\n]{2,20})/,
    /Transaction\s*Type\s*([^\n]{2,20})/,
  ])

  const confirmedAmount = toNumberString(
    firstMatch(t, [
      /确认金额(?:\s*\([^)]*\))?[：:\s]*([0-9,]+\.\d{2})/,
      /确认净额(?:\s*\([^)]*\))?[：:\s]*([0-9,]+\.\d{2})/,
      /Confirmed\s*(?:Amount|Net\s*Amount)[：:\s]*([0-9,]+\.\d{2})/,
    ]),
  )

  const confirmedShares = toNumberString(
    firstMatch(t, [
      /确认份额(?:\s*\([^)]*\))?[：:\s]*([0-9,]+\.\d{2,8})/,
      /Confirmed\s*Share[s]?[：:\s]*([0-9,]+\.\d{2,8})/,
    ]),
  )

  const unitNav = toNumberString(
    firstMatch(t, [
      /单位净值(?:\s*\([^)]*\))?[：:\s]*([0-9]+\.\d{2,8})/,
      /Net\s*Asset\s*Value[：:\s]*([0-9]+\.\d{2,8})/,
      /NAV\s*per\s*Share[：:\s]*([0-9]+\.\d{2,8})/,
    ]),
  )

  const tradeFee = toNumberString(
    firstMatch(t, [
      /交易费(?:用)?(?:\s*\([^)]*\))?[：:\s]*([0-9,]+\.\d{2})/,
      /手续费用?[：:\s]*([0-9,]+\.\d{2})/,
      /Transaction\s*[Ff]ee[：:\s]*([0-9,]+\.\d{2})/,
      /Trade\s*Fee[：:\s]*([0-9,]+\.\d{2})/,
    ]),
  )

  return {
    fundName: fundName?.replace(/\s+/g, "") ?? null,
    fundCode: fundCode?.toUpperCase() ?? null,
    investorName: investorName ?? null,
    applyDate,
    confirmDate,
    businessType,
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
  return extractFromText(text, filename, subject)
}
