/**
 * NAV extraction from fund email subjects and body text.
 * Handles three sources in priority order:
 *   1. subject  – direct 单位净值：value mention in the subject line
 *   2. body_post_table – colon-separated 单位净值／累计净值 labels in plain text
 *   3. body_table – date + decimal columns found in a table row
 */

export type NavExtractSource =
  | "subject"
  | "body_table"
  | "body_post_table"
  | "attachment_nav_table"
  | "attachment_valuation_table"

export type ExtractedNavData = {
  nav: number | null
  navDate: string | null       // ISO "YYYY-MM-DD"
  cumulativeNav: number | null // 累计净值
  adjustedNav: number | null     // 复权净值
  productCode: string | null
  fundName: string | null
  source: NavExtractSource
}

// ── date normalisation ────────────────────────────────────────────────────────

/** Accept YYYYMMDD, YYYY/MM/DD, YYYY年MM月DD日, YYYY-MM-DD → "YYYY-MM-DD" */
function normaliseDate(raw: string): string | null {
  if (!raw) return null
  // Already YYYY-MM-DD
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return raw

  // YYYYMMDD
  const compact = raw.match(/^(\d{4})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`

  // YYYY/MM/DD or YYYY年MM月DD日
  const loose = raw.match(/(\d{4})[\/年](\d{1,2})[\/月](\d{1,2})/)
  if (loose) {
    const [, y, m, d] = loose
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`
  }
  return null
}

// ── helper extractors ─────────────────────────────────────────────────────────

/** Allow ASCII letters in names (e.g. 衡颐承和FOF1号). */
const FUND_NAME_RE =
  /[\u4e00-\u9fffA-Za-z0-9]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?/

/** CMS/招商证券 净值表 subject: 管理人旗下"产品名-CODE". */
function parseCmsCustodyNavSubject(text: string): { code: string; fundName: string } | null {
  const m = text.match(
    /管理人旗下[""''\u201c\u201d]([\u4e00-\u9fff\d]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?)-([A-Z0-9]+)[""''\u201c\u201d]/u,
  )
  if (!m) return null
  return { code: m[2], fundName: normalizeFundDisplayName(m[1]) }
}

/** Parse CODE_FUNDNAME from 资产净值公告 subjects. */
function parseAssetNavAnnouncementSubject(text: string): { code: string; fundName: string } | null {
  const m = text.match(
    /资产净值公告_([A-Z0-9]+)_([\u4e00-\u9fff\d]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?)_/,
  )
  if (!m) return null
  return { code: m[1], fundName: normalizeFundDisplayName(m[2]) }
}

/** Prefer fund names from the subject line, ignoring investor names in 【】. */
function extractFundNameFromSubject(subject: string): string | null {
  for (const parser of [
    parseCmsCustodyNavSubject,
    parseVirtualEstSubject,
    parseAssetNavAnnouncementSubject,
    parseVirtualPerfSubject,
    parseValuationTableSubject,
  ]) {
    const parsed = parser(subject)
    if (parsed) return parsed.fundName
  }

  const bracketVirtualSubj = subject.match(
    /【虚拟净值】[A-Z0-9]+_([\u4e00-\u9fff\d]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金))_/,
  )
  if (bracketVirtualSubj) return normalizeFundDisplayName(bracketVirtualSubj[1])

  const virtualSubj = subject.match(
    /】[A-Z0-9]+_([\u4e00-\u9fff\d]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?)_/,
  )
  if (virtualSubj) return normalizeFundDisplayName(virtualSubj[1])

  const guotaiSubj = subject.match(/发送[：:](.+?)(?:【|$)/)
  if (guotaiSubj && /私募证券|投资基金/.test(guotaiSubj[1])) {
    // The capture may include a leading beian code and trailing date, e.g.
    // "SAVW72_金舆基石一号私募证券投资基金20260617估值表" — apply FUND_NAME_RE
    // to extract just the clean fund name.
    const fundMatch = guotaiSubj[1].match(FUND_NAME_RE)
    if (fundMatch) return normalizeFundDisplayName(fundMatch[0])
    return normalizeFundDisplayName(guotaiSubj[1])
  }

  const withoutInvestor = subject.replace(/【[^】]*】/g, " ")
  const m = withoutInvestor.match(
    /[\u4e00-\u9fff][\u4e00-\u9fff\d]{2,}(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?/,
  )
  return m ? normalizeFundDisplayName(m[0]) : null
}

function resolveFromStructuredSubject(subject: string): { code: string; fundName: string } | null {
  for (const parser of [
    parseCmsCustodyNavSubject,
    parseVirtualEstSubject,
    parseAssetNavAnnouncementSubject,
    parseVirtualPerfSubject,
    parseValuationTableSubject,
  ]) {
    const parsed = parser(subject)
    if (parsed) return parsed
  }
  return null
}

function parseVirtualEstSubject(text: string): { code: string; fundName: string } | null {
  const m = text.match(
    new RegExp(`【基金虚拟净值表现估算】([A-Z0-9]+)_(${FUND_NAME_RE.source})_(\\d{4}-\\d{2}-\\d{2})`),
  )
  if (!m) return null
  return { code: m[1], fundName: normalizeFundDisplayName(m[2]) }
}

/** Parse CODE_FUNDNAME_DATE tail shared by Huatai 虚拟业绩报酬 subject variants. */
function parseVirtualPerfSubject(text: string): { code: string; fundName: string } | null {
  const m = text.match(
    new RegExp(`([A-Z0-9]{4,8})_(${FUND_NAME_RE.source})_(\\d{4}-\\d{2}-\\d{2})`),
  )
  if (!m) return null
  return { code: m[1], fundName: normalizeFundDisplayName(m[2]) }
}

/** Parse CODE_FUNDNAME_4级科目估值表_YYYYMMDD (Guotai Junan etc.). */
function parseValuationTableSubject(text: string): { code: string; fundName: string } | null {
  const m = text.match(
    /^([A-Z0-9]+)_([\u4e00-\u9fffA-Za-z0-9]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?)_(?:\d级科目)?估值表_(20\d{6})/u,
  )
  if (m) return { code: m[1], fundName: normalizeFundDisplayName(m[2]) }

  const tail = text.match(
    /^([A-Z0-9]+)_([\u4e00-\u9fffA-Za-z0-9]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?)_(20\d{6})_估值表/u,
  )
  if (tail) return { code: tail[1], fundName: normalizeFundDisplayName(tail[2]) }
  return null
}

/** Short display name: 百奕小天鹅2号私募证券投资基金B → 百奕小天鹅2号B类 */
export function normalizeFundDisplayName(raw: string): string {
  const s = raw.trim()
  const m = s.match(/^(.+?)(?:私募证券投资基金|私募基金|证券投资基金|投资基金)?([ABC]类|[ABC])?$/)
  if (!m?.[1]) return s
  const base = m[1].trim()
  let shareClass = (m[2] ?? "").trim()
  if (shareClass.length === 1 && /[ABC]/.test(shareClass)) shareClass += "类"
  return `${base}${shareClass}`
}

export function extractProductCodeFromText(text: string): string | null {
  const labeled = text.match(/基金代码\s*[：:]\s*([A-Z0-9]+)/)
  if (labeled) return labeled[1]

  const productRef = text.match(/请查阅产品\s*([A-Z0-9]+)\s*[（(]/)
  if (productRef) return productRef[1]

  const firstLine = text.split("\n")[0] ?? text
  const structured = resolveFromStructuredSubject(firstLine)
  if (structured) return structured.code

  const assetNavSubj = text.match(/资产净值公告_([A-Z0-9]+)_/i)
  if (assetNavSubj) return assetNavSubj[1]

  const virtualSubj = text.match(/】([A-Z]{1,6}\d{2,6}[A-Z]?)_/)
  if (virtualSubj) return virtualSubj[1]

  const bracketVirtualSubj = text.match(/【虚拟净值】([A-Z0-9]+)_/)
  if (bracketVirtualSubj) return bracketVirtualSubj[1]

  // Typical codes: SBPC20, ASX73A, BSJ74B — allow underscore-delimited codes
  const m = text.match(/(?:^|[^A-Z0-9])_?([A-Z]{1,6}\d{2,6}[A-Z]?)(?:_|[^A-Z0-9]|$)/)
    ?? text.match(/(?:^|[^A-Z0-9])([A-Z]{1,6}\d{2,6}[A-Z]?)(?![A-Z0-9])/)
  return m?.[1] ?? null
}

export function extractFundNameFromText(text: string): string | null {
  const labeled = text.match(/基金名称\s*[：:]\s*([^\n\r]+)/)
  if (labeled) return normalizeFundDisplayName(labeled[1])

  const firstLine = text.split("\n")[0] ?? ""
  const fromSubject = extractFundNameFromSubject(firstLine)
  if (fromSubject) return fromSubject

  const m = text.match(FUND_NAME_RE)
  return m ? normalizeFundDisplayName(m[0]) : null
}

function shareClassFromProductCode(code: string | null): string {
  const m = code?.match(/([ABC])$/)
  return m ? `${m[1]}类` : ""
}

function ensureShareClass(
  fundName: string | null,
  productCode: string | null,
  subject: string,
): string | null {
  if (!fundName) return null
  let name = normalizeFundDisplayName(fundName)
  if (/[ABC]类$/.test(name)) return name

  const fromEstSubj = parseVirtualEstSubject(subject)
  if (fromEstSubj?.fundName && /[ABC]类$/.test(fromEstSubj.fundName)) return fromEstSubj.fundName

  const fromAssetSubj = parseAssetNavAnnouncementSubject(subject)
  if (fromAssetSubj?.fundName && /[ABC]类$/.test(fromAssetSubj.fundName)) return fromAssetSubj.fundName

  const fromCode = shareClassFromProductCode(productCode)
  if (fromCode) return `${name}${fromCode}`

  const subjClass = subject.match(/私募证券投资基金([ABC])【/)
    ?? subject.match(/私募证券投资基金([ABC])类_/)
  if (subjClass) return `${name}${subjClass[1]}类`

  return name
}

export function extractNavMetadata(subject: string, bodyText: string) {
  const structured = resolveFromStructuredSubject(subject)
  if (structured) {
    return { productCode: structured.code, fundName: structured.fundName }
  }

  const metaText = `${subject}\n${bodyText}`
  const productCode =
    extractProductCodeFromText(subject) ??
    extractProductCodeFromText(metaText)
  const fundName = ensureShareClass(
    extractFundNameFromSubject(subject) ?? extractFundNameFromText(metaText),
    productCode,
    subject,
  )
  return { productCode, fundName }
}

// ── date candidates from subject ──────────────────────────────────────────────

function subjectDate(subject: string): string | null {
  // YYYY-MM-DD
  const iso = subject.match(/(\d{4}-\d{2}-\d{2})/)
  if (iso) return iso[1]
  // YYYYMMDD (8 consecutive digits that look like a valid date)
  const compact = subject.match(/(\d{4})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/)
  if (compact) return normaliseDate(compact[0])
  return null
}

// ── main extractor ────────────────────────────────────────────────────────────

/**
 * Try to extract NAV data from a fund email.
 *
 * @param subject  Raw email subject string
 * @param bodyText Stripped plain-text body (HTML already removed)
 * @returns ExtractedNavData or null if no NAV could be found
 */
export function extractNavData(
  subject: string,
  bodyText: string,
): ExtractedNavData | null {
  const shared = extractNavMetadata(subject, bodyText)

  // ── 1. Subject: 单位净值：1.2269 ──────────────────────────────────────────
  const subjNavM = subject.match(/单位净值\s*[：:]\s*(\d+\.\d{3,8})/)
  if (subjNavM) {
    return {
      nav: parseFloat(subjNavM[1]),
      navDate: subjectDate(subject),
      cumulativeNav: null,
      adjustedNav: null,
      ...shared,
      source: "subject",
    }
  }

  // ── 2. Body: colon-label or table-header style ─────────────────────────────
  const unitNavM =
    bodyText.match(/单位净值\s*[：:]\s*(\d+\.\d{3,8})/) ||
    bodyText.match(/单位净值\s+(\d+\.\d+)/)
  const cumNavM =
    bodyText.match(/累计(?:单位)?净值\s*[：:]\s*(\d+\.\d{3,8})/) ||
    bodyText.match(/累计单位净值\s+(\d+\.\d+)/)

  if (unitNavM || cumNavM) {
    const bodyDateM =
      bodyText.match(/净值日期\s*[：:\s]\s*(\d{4}[-年/]\d{1,2}[-月/]\d{1,2}(?:[-日]?\d{0,2})?)/) ||
      bodyText.match(/净值日期\s+(\d{8})/) ||
      bodyText.match(/(\d{4}-\d{2}-\d{2})/)
    const navDate =
      bodyDateM
        ? normaliseDate(bodyDateM[1])
        : subjectDate(subject)

    const isTable = /净值日期|┌|│|虚拟单位净值/u.test(bodyText)
    return {
      nav:          unitNavM ? parseFloat(unitNavM[1]) : null,
      navDate,
      cumulativeNav: cumNavM ? parseFloat(cumNavM[1]) : null,
      adjustedNav: null,
      ...shared,
      source: isTable ? "body_table" : "body_post_table",
    }
  }

  // ── 2b. Body: Huatai 虚拟业绩报酬 table row (no colons) ───────────────────
  // TA891A 瀛岳核心...A类 20260326 S18852474004 荣熙共赢... 996412.91 2.0085 ...
  // AVH67B 倍致灵泰...B类 20260529 S18852498101 上海荣熙... - 荣熙共赢... 2000000 0.9506 ...
  if (/虚拟业绩报酬/.test(subject) || /虚拟单位净值/.test(bodyText)) {
    const perfRowM = bodyText.match(
      /([A-Z0-9]{4,8})\s+([\u4e00-\u9fff\d]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?)\s+(\d{8})\s+S[A-Z0-9]+\s+(.+?)\s+([\d,]+(?:\.\d+)?)\s+(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)/,
    )
    if (perfRowM) {
      return {
        nav:          parseFloat(perfRowM[6]),
        navDate:      normaliseDate(perfRowM[3]) ?? subjectDate(subject),
        cumulativeNav: parseFloat(perfRowM[7]),
        adjustedNav: null,
        productCode:  shared.productCode ?? perfRowM[1],
        fundName:       shared.fundName ?? normalizeFundDisplayName(perfRowM[2]),
        source: "body_table",
      }
    }
  }

  // ── 3. Body: CMS/招商 净值表 table row ────────────────────────────────────
  // 2026年06月08日 SBNX55 荣熙共赢私募证券投资基金 1.0065 1.0065
  const cmsRowM = bodyText.match(
    /(\d{4})年(\d{1,2})月(\d{1,2})日\s+([A-Z0-9]{4,8})\s+([\u4e00-\u9fff\d]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?)\s+(\d+\.\d+)\s+(\d+\.\d+)/u,
  )
  if (cmsRowM) {
    return {
      nav: parseFloat(cmsRowM[6]),
      navDate: normaliseDate(`${cmsRowM[1]}-${cmsRowM[2]}-${cmsRowM[3]}`),
      cumulativeNav: parseFloat(cmsRowM[7]),
      adjustedNav: null,
      productCode: shared.productCode ?? cmsRowM[4],
      fundName: shared.fundName ?? normalizeFundDisplayName(cmsRowM[5]),
      source: "body_table",
    }
  }

  // ── 3b. Body: table row – date followed by a NAV decimal ─────────────────
  const tableRowM = bodyText.match(
    /(\d{4}-\d{2}-\d{2})\s+(\d+\.\d{3,8})(?:\s+(\d+\.\d{3,8}))?/,
  )
  if (tableRowM) {
    return {
      nav:          parseFloat(tableRowM[2]),
      navDate:      tableRowM[1],
      cumulativeNav: tableRowM[3] ? parseFloat(tableRowM[3]) : null,
      adjustedNav: null,
      ...shared,
      source: "body_table",
    }
  }

  // ── 4. Body: 虚拟净值表现估算 table format ─────────────────────────────────
  // Subject: 【基金虚拟净值表现估算】PRODUCT_NAVDATE_INVESTOR
  // Table columns: ...虚拟净值 | 实际净值 | 实际累计净值
  // Data row:  ...YYYY-MM-DD TA计提 2,473,410.83 0 1.2100 1.21 1.6282
  // Holdings have commas; 实际净值 may be rounded to 2 decimals on first send.
  // The subject date is authoritative (body table date can be off by one day on
  // the first send of a new fund), so prefer subjectDate over the regex-matched date.
  if (/虚拟净值/.test(subject) || /虚拟净值\s+实际净值/.test(bodyText)) {
    const taRowM = bodyText.match(
      /(\d{4}-\d{2}-\d{2})\s+TA计提\s+[\d,.]+\s+\d+\s+(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)/,
    )
    if (taRowM) {
      return {
        nav:          parseFloat(taRowM[2]),
        navDate:      subjectDate(subject) ?? taRowM[1],
        cumulativeNav: parseFloat(taRowM[4]),
        adjustedNav: null,
        ...shared,
        source: "body_table",
      }
    }

    const virtualNavM = bodyText.match(
      /(\d{4}-\d{2}-\d{2})[^\n]*?(\d+\.\d{3,8})\s+(\d+\.\d{3,8})\s+(\d+\.\d{3,8})/,
    )
    if (virtualNavM) {
      return {
        nav:          parseFloat(virtualNavM[2]),
        navDate:      subjectDate(subject) ?? virtualNavM[1],
        cumulativeNav: parseFloat(virtualNavM[4]),
        adjustedNav: null,
        ...shared,
        source: "body_table",
      }
    }
  }

  return null
}

/** Full fund-name segment in 资产净值公告 body tables (code name date unit cum). */
const HISTORY_TABLE_ROW_RE =
  /([A-Z0-9]{4,8})\s+([\u4e00-\u9fff\d]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?)\s+(\d{4}-\d{2}-\d{2})\s+(\d+\.\d+)\s+(\d+\.\d+)/g

function hasNavHistoryTable(bodyText: string, subject: string): boolean {
  return (
    /产品代码\s+产品名称\s+净值日期/u.test(bodyText) ||
    /资产净值公告/u.test(subject)
  )
}

/**
 * Extract all historical NAV rows from a multi-row body table (e.g. 资产净值公告).
 * Only rows whose product code matches the subject metadata are returned.
 */
export function extractNavHistoryFromBody(
  subject: string,
  bodyText: string,
): ExtractedNavData[] {
  if (!hasNavHistoryTable(bodyText, subject)) return []

  const shared = extractNavMetadata(subject, bodyText)
  const expectedCode = shared.productCode?.toUpperCase()

  const rows: ExtractedNavData[] = []
  const seenDates = new Set<string>()

  for (const m of bodyText.matchAll(HISTORY_TABLE_ROW_RE)) {
    const code = m[1].toUpperCase()
    if (expectedCode && code !== expectedCode) continue

    const navDate = m[3]
    if (seenDates.has(navDate)) continue
    seenDates.add(navDate)

    rows.push({
      nav: parseFloat(m[4]),
      navDate,
      cumulativeNav: parseFloat(m[5]),
      adjustedNav: null,
      productCode: code,
      fundName: shared.fundName ?? normalizeFundDisplayName(m[2]),
      source: "body_table",
    })
  }

  return rows
}
