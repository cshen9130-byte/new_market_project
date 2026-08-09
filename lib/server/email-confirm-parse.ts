/**
 * Parse broker 交易确认单 / 确认函 PDF text into structured fields.
 * Styles covered: 国泰海通 / 华泰 / 招商 / 中金 / 中信 / 众量(恒生TA bilingual) (and generic fallbacks).
 *
 * Note: 中信/众量 TA PDFs use CID fonts (UniGB-UTF16). Without a Node CMap reader,
 * pdf.js only returns field labels and all values (净值/份额/金额) are lost.
 */

import fs from "fs"
import path from "path"
import { pathToFileURL } from "url"
import { PDFParse } from "pdf-parse"
import { CanvasFactory, getData } from "pdf-parse/worker"

PDFParse.setWorker(getData())

const PDFJS_CMAP_DIR = path.resolve(process.cwd(), "node_modules/pdfjs-dist/cmaps")
const PDFJS_STANDARD_FONT_DIR = path.resolve(
  process.cwd(),
  "node_modules/pdfjs-dist/standard_fonts",
)

class NodeCMapReaderFactory {
  async fetch({ name }: { name: string }) {
    const file = path.join(PDFJS_CMAP_DIR, `${name}.bcmap`)
    const buf = fs.readFileSync(file)
    return { cMapData: new Uint8Array(buf), isCompressed: true }
  }
}

class NodeStandardFontDataFactory {
  async fetch({ filename }: { filename: string }) {
    const file = path.join(PDFJS_STANDARD_FONT_DIR, filename)
    return new Uint8Array(fs.readFileSync(file))
  }
}

function pdfParseLoadOptions(buffer: Buffer) {
  return {
    data: buffer,
    CanvasFactory,
    cMapUrl: pathToFileURL(PDFJS_CMAP_DIR + path.sep).href,
    cMapPacked: true,
    CMapReaderFactory: NodeCMapReaderFactory,
    StandardFontDataFactory: NodeStandardFontDataFactory,
    useSystemFonts: true,
  }
}

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
/** Unit NAV only (no thousands separators); rejects trailing ",000.00" fragments. */
const NAV_VALUE = /(?<![0-9,])([0-9]+\.\d{2,8})(?!\d)/
const FUND_CODE_VALUE = /\b([A-Za-z]{0,4}\d[A-Za-z0-9]{2,10}|[A-Z]{5,10}\d[A-Za-z0-9]*)\b/
/** 众量/恒生 TA often prints NAV as `1.1451 (20260729)`. */
const NAV_WITH_DATE_VALUE = /(?<![0-9,])([0-9]+\.\d{2,8})\s*\(\s*20\d{6}\s*\)/

function looksLikeFundCode(value: string | null | undefined): string | null {
  const v = cleanCapturedValue(value)
  if (!v) return null
  if (!/^[A-Za-z0-9]{4,12}$/.test(v)) return null
  if (/^(FUND|CODE|NUMBER|NAME|SHARE|DATE|TYPE|AMOUNT|STATUS|AMAC)$/i.test(v)) return null
  // Real product/TA codes almost always include a digit (BLF14C / SBLF14 / 000001).
  if (!/\d/.test(v)) return null
  return v.toUpperCase()
}

function looksLikeUnitNav(value: string | null | undefined): string | null {
  const n = toNumberString(value)
  if (!n) return null
  const v = Number(n)
  // Private-fund NAVs are typically near 1.x; reject fees (0) and amounts.
  if (!(v > 0.05 && v < 100)) return null
  return n
}

function deriveUnitNav(
  amount: string | null,
  shares: string | null,
): string | null {
  if (!amount || !shares) return null
  const a = Number(amount)
  const s = Number(shares)
  if (!(a > 0) || !(s > 0)) return null
  const nav = a / s
  if (!(nav > 0.05 && nav < 100)) return null
  // Keep up to 8 dp, trim trailing zeros carefully via Number→string for short values.
  const fixed = nav.toFixed(8).replace(/\.?0+$/, "")
  return looksLikeUnitNav(fixed.includes(".") ? fixed : `${fixed}.0`) || nav.toFixed(4)
}

function extractUnitNav(text: string): string | null {
  // Prefer NAV printed with its as-of date: 1.1451 (20260729)
  const withDate =
    valueAfterLabel(
      text,
      /单位净值(?:\s*\([^)]*\))?|NAV\s*per\s*Share|Net\s*Asset\s*Value(?:\s*\([^)]*\))?/gi,
      NAV_WITH_DATE_VALUE,
      600,
    ) ||
    firstMatch(text, [
      /单位净值[\s\S]{0,600}?([0-9]+\.\d{2,8})\s*\(\s*20\d{6}\s*\)/i,
      /NAV\s*per\s*Share[\s\S]{0,600}?([0-9]+\.\d{2,8})\s*\(\s*20\d{6}\s*\)/i,
      /(?<![0-9,])([0-9]+\.\d{3,6})\s*\(\s*20\d{6}\s*\)/,
    ])
  const fromDate = looksLikeUnitNav(withDate)
  if (fromDate) return fromDate

  const nearLabel = looksLikeUnitNav(
    valueAfterLabel(
      text,
      /单位净值(?:\s*\([^)]*\))?|NAV\s*per\s*Share|Net\s*Asset\s*Value(?:\s*\([^)]*\))?/gi,
      NAV_VALUE,
      600,
    ),
  )
  if (nearLabel) return nearLabel

  return looksLikeUnitNav(
    firstMatch(text, [
      /单位净值(?:\s*\([^)]*\))?[：:\s]*([0-9]+\.\d{2,8})/,
      /Net\s*Asset\s*Value[：:\s]*([0-9]+\.\d{2,8})/,
      /NAV\s*per\s*Share[：:\s]*([0-9]+\.\d{2,8})/,
    ]),
  )
}

function looksLikeConfirmedShares(
  value: string | null | undefined,
  confirmedAmount: string | null,
): string | null {
  const n = toNumberString(value)
  if (!n) return null
  const s = Number(n)
  if (!(s > 0)) return null
  // Avoid grabbing 确认金额 when PDF dumps columns out of order.
  if (confirmedAmount && Math.abs(s - Number(confirmedAmount)) < 0.005) return null
  if (confirmedAmount) {
    const a = Number(confirmedAmount)
    if (a > 0) {
      // shares ≈ amount / nav with nav typically in (0.05, 100)
      if (s > a / 0.05 + 1) return null
      // For normal subscriptions, skip NAV-sized numbers (e.g. 1.1451) before real shares.
      if (a >= 1000 && s < Math.max(10, a / 100)) return null
    }
  }
  return n
}

function extractConfirmedShares(text: string, confirmedAmount: string | null): string | null {
  const labelRe = /确认份额(?:\s*\([^)]*\))?|Confirmed\s*Shares?(?:\s*\([^)]*\))?/gi
  let labelMatch: RegExpExecArray | null
  while ((labelMatch = labelRe.exec(text)) != null) {
    const slice = text.slice(labelMatch.index + labelMatch[0].length, labelMatch.index + labelMatch[0].length + 500)
    // Walk every numeric candidate; skip NAV-with-date and amount-sized values.
    const numRe = /([0-9,]+\.\d{2,8})(?!\d)/g
    let numMatch: RegExpExecArray | null
    while ((numMatch = numRe.exec(slice)) != null) {
      const around = slice.slice(numMatch.index, numMatch.index + numMatch[0].length + 16)
      if (/\(\s*20\d{6}\s*\)/.test(around)) continue // 1.1451 (20260729)
      const shares = looksLikeConfirmedShares(numMatch[1], confirmedAmount)
      if (shares) return shares
    }
  }
  return looksLikeConfirmedShares(
    firstMatch(text, [
      /确认份额(?:\s*\([^)]*\))?[：:\s]*([0-9,]+\.\d{2,8})/,
      /Confirmed\s*Share[s]?[：:\s]*([0-9,]+\.\d{2,8})/,
    ]),
    confirmedAmount,
  )
}

function detectBroker(text: string, filename: string, subject: string): string | null {
  const blob = `${text}\n${filename}\n${subject}`
  if (/国泰海通/.test(blob)) return "国泰海通"
  if (/华泰证券|华泰/.test(blob)) return "华泰"
  if (/招商证券|招商/.test(blob)) return "招商"
  if (/中金公司|中国国际金融|中金/.test(blob)) return "中金"
  if (/中信证券|中信|中信中证/.test(blob)) return "中信"
  if (/众量/.test(blob)) return "众量"
  return null
}

/** All decimal numbers in document order (CID-font TA PDFs dump values after labels). */
function allDecimalNumbers(text: string): string[] {
  const out: string[] = []
  const re = /([0-9,]+\.\d{2,8})(?!\d)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) != null) {
    const n = toNumberString(m[1])
    if (n) out.push(n)
  }
  return out
}

/**
 * Fallback for 中信/众量 TA PDFs where values are scattered after all labels.
 * Prefer NAV-with-date, then amount/shares that reconcile with that NAV.
 */
function extractScatteredTaFields(text: string): {
  fundName: string | null
  fundCode: string | null
  investorName: string | null
  businessType: string | null
  confirmedAmount: string | null
  confirmedShares: string | null
  unitNav: string | null
  tradeFee: string | null
  applyDate: string | null
  confirmDate: string | null
} {
  const unitNav = looksLikeUnitNav(
    firstMatch(text, [/(?<![0-9,])([0-9]+\.\d{3,6})\s*\(\s*20\d{6}\s*\)/]),
  )

  const nums = allDecimalNumbers(text)
  // Money-like amounts: ignore tiny fees (0.00) when larger amounts exist.
  const moneyAmounts = nums.filter((n) => Number(n) >= 100)
  let confirmedAmount: string | null = null
  if (moneyAmounts.length) {
    // Mode (most frequent) among large amounts — 确认/申请/净确认 often repeat.
    const counts = new Map<string, number>()
    for (const a of moneyAmounts) counts.set(a, (counts.get(a) || 0) + 1)
    confirmedAmount = [...counts.entries()].sort((a, b) => b[1] - a[1] || Number(b[0]) - Number(a[0]))[0][0]
  }

  let confirmedShares: string | null = null
  if (confirmedAmount && unitNav) {
    const target = Number(confirmedAmount) / Number(unitNav)
    let best: { n: string; err: number } | null = null
    for (const n of nums) {
      if (Number(n) === Number(confirmedAmount)) continue
      if (looksLikeUnitNav(n)) continue
      const err = Math.abs(Number(n) - target)
      if (err > Math.max(1, target * 0.002)) continue
      if (!best || err < best.err) best = { n, err }
    }
    confirmedShares = best?.n ?? null
  }
  if (!confirmedShares && confirmedAmount) {
    for (const n of nums) {
      const s = looksLikeConfirmedShares(n, confirmedAmount)
      if (s) {
        confirmedShares = s
        break
      }
    }
  }

  const codeHits = [...text.matchAll(/\b([A-Z]{2,5}\d{2,5}[A-Z0-9]?)\b/g)]
    .map((m) => looksLikeFundCode(m[1]))
    .filter((c): c is string => Boolean(c))
  // Prefer product share-class codes (BLF14C) over AMAC codes (SBLF14).
  const fundCode =
    codeHits.find((c) => /[A-Z]$/.test(c) && !c.startsWith("S")) ||
    codeHits.find((c) => !c.startsWith("S")) ||
    codeHits[0] ||
    null

  const fundNames = [...text.matchAll(/([\u4e00-\u9fffA-Za-z0-9]+(?:私募证券投资基金|证券投资基金)[A-Z]?类?)/g)]
    .map((m) => m[1]?.replace(/\s+/g, "") || "")
    .filter((n) => n.length >= 8)
  // Underlying product name (众量/聚宝…C类), not the FOF investor.
  const fundName =
    fundNames.find((n) => /[A-Z]类$/.test(n) && !/FOF/.test(n)) ||
    fundNames.find((n) => /众量|聚宝|资产/.test(n) && !/FOF/.test(n)) ||
    fundNames.find((n) => !/FOF|金舆/.test(n)) ||
    null

  const investorName =
    fundNames.find((n) => /FOF/.test(n)) ||
    fundNames.find((n) => /金舆|基石|锡泰|守安|稳健/.test(n) && n !== fundName) ||
    null

  // Avoid matching inside 巨额赎回方式.
  const businessType = firstMatch(text, [
    /(申购|认购)/,
    /(?<!巨额)(赎回)/,
    /(转换|红利再投资|强制赎回)/,
  ])

  const dates = [...text.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map((m) => m[1])
  const uniqueDates = [...new Set(dates)]
  let applyDate: string | null = uniqueDates[0] ?? null
  let confirmDate: string | null = uniqueDates.find((d) => d !== applyDate) ?? uniqueDates[1] ?? null
  // If NAV footnote date is present as YYYYMMDD, apply date often matches that trading day.
  const navAsOf = toIsoDate(firstMatch(text, [/[0-9]+\.\d{3,6}\s*\(\s*(20\d{6})\s*\)/]))
  if (navAsOf && uniqueDates.includes(navAsOf)) applyDate = navAsOf
  if (applyDate && confirmDate === applyDate) {
    confirmDate = uniqueDates.find((d) => d !== applyDate) ?? confirmDate
  }

  const tradeFee =
    toNumberString(firstMatch(text, [/交易费(?:用)?(?:\s*\([^)]*\))?[^\d]{0,40}([0-9,]+\.\d{2})/])) ||
    (nums.includes("0.00") ? "0.00" : null)

  return {
    fundName,
    fundCode,
    investorName,
    businessType,
    confirmedAmount,
    confirmedShares,
    unitNav,
    tradeFee,
    applyDate,
    confirmDate,
  }
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

  // Prefer dashed dates; avoid NAV footnotes like `1.1451 (20260729)`.
  const DASHED_DATE_VALUE = /(20\d{2}-\d{2}-\d{2})/
  const applyDate = toIsoDate(
    valueAfterLabel(t, /申请日期(?:\s*\([^)]*\))?|Application\s*Date|Trade\s*Date/gi, DASHED_DATE_VALUE, 500) ||
      valueAfterLabel(t, /申请日期(?:\s*\([^)]*\))?|Application\s*Date|Trade\s*Date/gi, DATE_VALUE, 500) ||
      firstMatch(t, [
        /申请日期(?:\s*\([^)]*\))?\s*((?:20\d{2}[年/-]\d{1,2}[月/-]\d{1,2}日?|20\d{6}|20\d{2}-\d{2}-\d{2}))/,
        /Application\s*Date\s*((?:20\d{2}[年/-]\d{1,2}[月/-]\d{1,2}日?|20\d{6}|20\d{2}-\d{2}-\d{2}))/,
        /Trade\s*Date\s*((?:20\d{2}[年/-]\d{1,2}[月/-]\d{1,2}日?|20\d{6}|20\d{2}-\d{2}-\d{2}))/,
      ]),
  )

  // Column-dump PDFs list both dates after labels; skip the apply-date value when present.
  let confirmDate: string | null = null
  {
    const labelRe = /确认日期(?:\s*\([^)]*\))?|Confirmation\s*Date|Confirmed\s*Date/gi
    let labelMatch: RegExpExecArray | null
    while (!confirmDate && (labelMatch = labelRe.exec(t)) != null) {
      const slice = t.slice(labelMatch.index + labelMatch[0].length, labelMatch.index + labelMatch[0].length + 500)
      const dateRe = /(20\d{2}-\d{2}-\d{2})|(20\d{6})/g
      let dm: RegExpExecArray | null
      while ((dm = dateRe.exec(slice)) != null) {
        const iso = toIsoDate(dm[1] || dm[2])
        if (!iso) continue
        if (applyDate && iso === applyDate) continue
        confirmDate = iso
        break
      }
    }
    if (!confirmDate) {
      confirmDate = toIsoDate(
        valueAfterLabel(t, /确认日期(?:\s*\([^)]*\))?|Confirmation\s*Date|Confirmed\s*Date/gi, DASHED_DATE_VALUE, 500) ||
          firstMatch(t, [
            /确认日期(?:\s*\([^)]*\))?\s*((?:20\d{2}[年/-]\d{1,2}[月/-]\d{1,2}日?|20\d{6}|20\d{2}-\d{2}-\d{2}))/,
            /Confirmation\s*Date\s*((?:20\d{2}[年/-]\d{1,2}[月/-]\d{1,2}日?|20\d{6}|20\d{2}-\d{2}-\d{2}))/,
          ]),
      )
    }
  }

  const businessTypeRaw = firstMatch(t, [
    /业务类型(?:\s*\([^)]*\))?(?:\s*Transaction\s*Type|\s*Business\s*Type)?\s*([认申赎转红利强增派][^\nA-Za-z]{0,12})/,
    /Transaction\s*Type\s*([认申赎转红利强增派][^\nA-Za-z]{0,12})/,
    /业务类型(?:\s*\([^)]*\))?(?:\s*Transaction\s*Type|\s*Business\s*Type)?\s*([^\n确认状态基金代码Confirmed]{2,20})/,
  ])
  const businessType =
    businessTypeRaw && !/^(基金代码|确认状态|产品代码)$/.test(businessTypeRaw.replace(/\s+/g, ""))
      ? businessTypeRaw
      : null

  let confirmedAmount = toNumberString(
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
  // Reject fee-sized false positives from jumbled TA value dumps.
  if (confirmedAmount && Number(confirmedAmount) < 1) confirmedAmount = null

  let confirmedShares = extractConfirmedShares(t, confirmedAmount)

  let unitNav =
    extractUnitNav(t) || deriveUnitNav(confirmedAmount, confirmedShares)

  let tradeFee = toNumberString(
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

  // 中信/众量 CID-font PDFs often dump values after labels; fill any remaining gaps.
  const scattered = extractScatteredTaFields(t)
  const mergedFundName = (fundName && !/^(Typeof|FundName|基金)/i.test(fundName.replace(/\s+/g, "")))
    ? fundName
    : scattered.fundName
  const mergedFundCode = fundCode || scattered.fundCode
  const mergedInvestor =
    (investorName && investorName.length >= 6 && !/^(基金账|Investor)/i.test(investorName))
      ? investorName
      : scattered.investorName
  const mergedBusiness = businessType || scattered.businessType
  confirmedAmount = confirmedAmount || scattered.confirmedAmount
  confirmedShares = confirmedShares || scattered.confirmedShares
  unitNav = unitNav || scattered.unitNav || deriveUnitNav(confirmedAmount, confirmedShares)
  tradeFee = tradeFee ?? scattered.tradeFee
  const mergedApply = applyDate || scattered.applyDate
  const mergedConfirm = confirmDate || scattered.confirmDate

  return {
    fundName: mergedFundName?.replace(/\s+/g, "").replace(/^FundName/i, "") || null,
    fundCode: mergedFundCode ?? null,
    investorName: mergedInvestor?.replace(/\s+/g, "") || null,
    applyDate: mergedApply,
    confirmDate: mergedConfirm,
    businessType: mergedBusiness?.replace(/[A-Za-z].*$/, "").replace(/\s+/g, "") || null,
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
    const parser = new PDFParse(pdfParseLoadOptions(buffer))
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
