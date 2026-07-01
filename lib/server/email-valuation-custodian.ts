/**
 * Resolve 托管券商 from parsed 估值表 header, registration tables, or
 * direct custodian-platform email senders (not batch multi-fund senders).
 */

import { extractCustodianFromHeaderRows } from "@/lib/server/valuation-analyzer"

const CUSTODIAN_VALUE_RE =
  /^[\u4e00-\u9fffA-Za-z0-9（）()·\s]{2,}(?:证券|银行|信托|资产|托管).*(?:有限公司|有限责任公司)$/

/** Batch valuation dispatch platforms — default 托管券商 when the spreadsheet header omits it. */
const BATCH_VALUATION_PLATFORM_CUSTODIANS: ReadonlyArray<[RegExp, string]> = [
  [/cmschina\.com/i, "招商证券股份有限公司"],
  [/chinastock\.com\.cn/i, "中国银河证券股份有限公司"],
]

/** Direct custodian-platform senders where the mailbox belongs to the 托管券商. */
const DIRECT_CUSTODIAN_SENDER_SUFFIXES: ReadonlyArray<[RegExp, string]> = [
  [/@[a-z0-9.-]*gtht\.com$/i, "国泰海通证券股份有限公司"],
  [/@[a-z0-9.-]*gtja\.com$/i, "国泰海通证券股份有限公司"],
  [/@[a-z0-9.-]*htsc\.com$/i, "华泰证券股份有限公司"],
  [/@[a-z0-9.-]*csc108\.com$/i, "中信建投证券股份有限公司"],
  [/@[a-z0-9.-]*citics\.com$/i, "中信证券股份有限公司"],
  [/@[a-z0-9.-]*guosen\.com\.cn$/i, "国信证券股份有限公司"],
  [/@[a-z0-9.-]*cicc\.com$/i, "中国国际金融股份有限公司"],
  [/@[a-z0-9.-]*gf\.com\.cn$/i, "广发证券股份有限公司"],
  [/@[a-z0-9.-]*essence\.com\.cn$/i, "安信证券股份有限公司"],
  [/@[a-z0-9.-]*ebscn\.com$/i, "光大证券股份有限公司"],
]

/** Extract just the company-name portion from a raw custodian string.
 *
 * Raw 估值表 cells often append fund names or account labels after the company
 * name, e.g. "招商证券股份有限公司_荣熙恒盈2号私募证券投资基金_专用名".
 * This regex captures only up to the first 有限公司 / 有限责任公司 suffix.
 */
const COMPANY_NAME_RE =
  /([\u4e00-\u9fffA-Za-z0-9（）()·\s]+?(?:证券|银行|信托|资产|托管)[\u4e00-\u9fffA-Za-z0-9（）()·\s]*?(?:股份有限公司|有限责任公司|有限公司))/u

function extractCompanyName(text: string): string {
  const m = text.match(COMPANY_NAME_RE)
  return m?.[1]?.trim() ?? text
}

export function normalizeCustodianName(raw: string | null | undefined): string | null {
  const text = String(raw ?? "").trim().replace(/\s+/g, " ")
  if (!text || text.length < 4) return null
  if (/^[\d.,]+$/.test(text)) return null
  if (/(?:证券|银行|信托|资产)/.test(text)) return extractCompanyName(text)
  if (/托管/.test(text) && /(?:公司|有限)/.test(text)) return extractCompanyName(text)
  return null
}

/** Registration / elements tables — keep short names when already human-readable. */
export function normalizeRegistrationCustodian(raw: string | null | undefined): string | null {
  const text = String(raw ?? "").trim().replace(/\s+/g, " ")
  if (!text || text.length < 2) return null
  if (/^[\d.,]+$/.test(text)) return null
  // Strip any fund name / account label appended after the company suffix
  if (/(?:证券|银行|信托|资产|托管)/.test(text) && /(?:有限公司|有限责任公司)/.test(text)) {
    return extractCompanyName(text)
  }
  return text
}

export function resolveValuationCustodian(
  headerCustodian: string | null | undefined,
): string | null {
  return normalizeCustodianName(headerCustodian) ?? normalizeRegistrationCustodian(headerCustodian)
}

/** Scan arbitrary text (email body, subject, filename) for 托管券商 labels or company names. */
export function inferCustodianFromText(text: string | null | undefined): string | null {
  const blob = String(text ?? "").trim()
  if (!blob) return null

  const lines = blob.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  const chunks = lines.length > 0 ? lines : [blob]

  for (const chunk of chunks) {
    const assetCustody = chunk.match(
      /([\u4e00-\u9fffA-Za-z0-9（）()·]+(?:证券|银行|信托|资产)[\u4e00-\u9fffA-Za-z0-9（）()·]*?)资产托管/u,
    )
    if (assetCustody?.[1]) {
      return normalizeCustodianName(assetCustody[1]) ?? normalizeRegistrationCustodian(assetCustody[1])
    }

    const inline = chunk.match(
      /(?:基金托管人|托管人名称|托管券商|托管银行|托管机构|托管人)\s*[：:]\s*([\u4e00-\u9fffA-Za-z0-9（）()·\s]+?(?:证券|银行|信托|资产)[\u4e00-\u9fffA-Za-z0-9（）()·\s]*)/u,
    )
    if (inline?.[1]) {
      const cleaned = inline[1].split(/[|｜\t]/)[0]?.trim() ?? ""
      return normalizeCustodianName(cleaned) ?? normalizeRegistrationCustodian(cleaned)
    }
  }

  const bracket = blob.match(
    /【([\u4e00-\u9fffA-Za-z0-9（）()·]+(?:证券|银行|信托|资产)[\u4e00-\u9fffA-Za-z0-9（）()·]*)】/u,
  )
  if (bracket?.[1] && !/估值表|净值|公告|虚拟/.test(bracket[1])) {
    return normalizeCustodianName(bracket[1]) ?? normalizeRegistrationCustodian(bracket[1])
  }

  return null
}

const EXPLICIT_CUSTODIAN_RE =
  /([\u4e00-\u9fffA-Za-z0-9（）()·]+(?:证券|银行|信托|资产)[\u4e00-\u9fffA-Za-z0-9（）()·]*(?:股份有限公司|有限责任公司))/gu

/** Pick an explicitly named broker from header/body text (e.g. cmschina 估值表 footers). */
function inferExplicitCustodianFromText(text: string | null | undefined): string | null {
  const blob = String(text ?? "")
  if (!blob) return null

  if (/招商证券股份有限公司/.test(blob)) return "招商证券股份有限公司"

  const matches = [...blob.matchAll(EXPLICIT_CUSTODIAN_RE)]
    .map((m) => m[1]?.trim())
    .filter(Boolean) as string[]
  for (const candidate of matches) {
    const resolved = normalizeCustodianName(candidate) ?? normalizeRegistrationCustodian(candidate)
    if (resolved) return resolved
  }
  return null
}

function headerRowsToText(headerRows: unknown[][] | null | undefined): string {
  if (!Array.isArray(headerRows)) return ""
  return headerRows
    .flatMap((row) => (Array.isArray(row) ? row : []))
    .map((cell) => String(cell ?? "").trim())
    .filter(Boolean)
    .join(" ")
}

export function inferCustodianFromSenderEmail(
  senderEmail: string | null | undefined,
  contextText?: string | null,
): string | null {
  const email = String(senderEmail ?? "").trim().toLowerCase()
  if (!email) return null

  for (const [pattern, name] of DIRECT_CUSTODIAN_SENDER_SUFFIXES) {
    if (pattern.test(email)) return name
  }

  const context = String(contextText ?? "")
  const explicitInContext = inferExplicitCustodianFromText(context)
  if (explicitInContext) return explicitInContext

  for (const [pattern, name] of BATCH_VALUATION_PLATFORM_CUSTODIANS) {
    if (!pattern.test(email)) continue
    if (context && EXPLICIT_CUSTODIAN_RE.test(context)) {
      const brokers = [...context.matchAll(EXPLICIT_CUSTODIAN_RE)]
        .map((m) => normalizeCustodianName(m[1]) ?? normalizeRegistrationCustodian(m[1]))
        .filter(Boolean) as string[]
      if (brokers.length > 0 && !brokers.includes(name)) continue
    }
    return name
  }

  return null
}

export function inferCustodianFromValuationMeta(
  subject: string | null | undefined,
  attachmentFilename: string | null | undefined,
): string | null {
  return inferCustodianFromText(`${subject ?? ""} ${attachmentFilename ?? ""}`)
}

export function resolveCustodianFromValuationRecord(input: {
  custodian?: string | null
  summaryCustodian?: string | null
  headerRows?: unknown[][] | null
  senderEmail?: string | null
  subject?: string | null
  attachmentFilename?: string | null
  bodyText?: string | null
}): string | null {
  const header = resolveValuationCustodian(input.summaryCustodian ?? input.custodian)
  if (header) return header

  if (Array.isArray(input.headerRows) && input.headerRows.length > 0) {
    const fromRows = resolveValuationCustodian(
      extractCustodianFromHeaderRows(input.headerRows, input.headerRows.length),
    )
    if (fromRows) return fromRows
  }

  const body = inferCustodianFromText(input.bodyText)
  if (body) return body

  const meta = inferCustodianFromValuationMeta(input.subject, input.attachmentFilename)
  if (meta) return meta

  const headerContext = headerRowsToText(input.headerRows)
  const explicit = inferExplicitCustodianFromText(
    [headerContext, input.bodyText, input.subject, input.attachmentFilename].filter(Boolean).join("\n"),
  )
  if (explicit) return explicit

  return inferCustodianFromSenderEmail(input.senderEmail, headerContext)
}

export function looksLikeCustodianCompany(value: string | null | undefined): boolean {
  const text = String(value ?? "").trim()
  if (!text) return false
  return (
    CUSTODIAN_VALUE_RE.test(text)
    || /(?:证券|银行).*(?:有限公司|有限责任公司)/.test(text)
    || (/托管/.test(text) && /(?:公司|有限)/.test(text))
  )
}
