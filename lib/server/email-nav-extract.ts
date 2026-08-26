/**
 * NAV extraction from fund email subjects and body text.
 * Handles three sources in priority order:
 *   1. subject  – direct 单位净值：value mention in the subject line
 *   2. body_post_table – colon-separated 单位净值／累计净值 labels in plain text
 *   3. body_table – date + decimal columns found in a table row
 */

import { normalizeFundDisplayName } from "@/lib/fund-display-name"
import { resolveFundHoldingCode } from "@/lib/server/fund-holding-code"
import {
  lookupManagedProductOverride,
  remapManagedProductBeianCode,
  resolveManagedProductBeian,
  resolveManagedProductBeianIgnoringShareClass,
} from "@/lib/server/managed-product-beian"

export { normalizeFundDisplayName }

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

/**
 * Legal fund-type suffix.
 * Negative lookahead on 私募基金 avoids matching inside 私募基金管理有限公司.
 */
const FUND_LEGAL_SUFFIX =
  "(?:私募证券投资基金|私募基金(?!管理)|证券投资基金|投资基金)"

/** Allow ASCII letters in names (e.g. 衡颐承和FOF1号). */
const FUND_NAME_RE = new RegExp(
  `[\\u4e00-\\u9fffA-Za-z0-9]+${FUND_LEGAL_SUFFIX}(?:[ABC]类|[ABC])?`,
  "u",
)

const MANAGER_COMPANY_PREFIX_SOURCE =
  "[\\u4e00-\\u9fffA-Za-z0-9]*?(?:私募)?基金管理(?:（[^）]*）|\\([^)]*\\))?有限公司"

function stripManagerCompanyPrefixes(value: string, replacement = ""): string {
  return value.replace(new RegExp(MANAGER_COMPANY_PREFIX_SOURCE, "gu"), replacement)
}

/** Drop announcement / company glue left by subject regexes. */
function finalizeExtractedFundName(raw: string | null | undefined): string | null {
  if (!raw) return null
  let s = raw.trim()
  if (!s) return null
  s = s.replace(/^关于+/u, "")
  s = stripManagerCompanyPrefixes(s)
  s = s.replace(/^有限公司/u, "")
  s = s.replace(/^管理有限公司/u, "")
  const normalized = normalizeFundDisplayName(s)
  if (!normalized) return null
  if (/管理有限公司|基金管理有限公司/u.test(normalized)) return null
  if (/^有限公司/u.test(normalized)) return null
  if (/有限公司/u.test(normalized) && !/号/u.test(normalized)) return null
  if (/^关于/u.test(normalized)) return null
  return normalized
}

function prepareSubjectForFundName(subject: string): string {
  return stripManagerCompanyPrefixes(
    subject.replace(/【[^】]*】/g, " ").replace(/^关于+/u, ""),
    " ",
  )
}

/** Pick the most product-like fund name from a subject (prefer …号 over manager labels). */
function pickBestFundNameMatch(text: string): string | null {
  const prepared = prepareSubjectForFundName(text)
  const bracketStripped = text.replace(/【[^】]*】/g, " ").replace(/^关于+/u, "")
  const candidates: string[] = []
  for (const blob of [prepared, bracketStripped]) {
    const re = new RegExp(FUND_NAME_RE.source, "gu")
    let m: RegExpExecArray | null
    while ((m = re.exec(blob)) !== null) {
      const cleaned = finalizeExtractedFundName(m[0])
      if (cleaned) candidates.push(cleaned)
    }
  }
  if (candidates.length === 0) return null
  const uniq = [...new Set(candidates)]
  uniq.sort((a, b) => {
    const score = (n: string) =>
      (/号/u.test(n) ? 20 : 0) +
      (/[ABC]类/u.test(n) ? 5 : 0) -
      (/有限公司/u.test(n) ? 50 : 0) +
      Math.min(n.length, 40) * 0.01
    return score(b) - score(a)
  })
  return uniq[0] ?? null
}

/** CMS/招商证券 净值表 subject: 管理人旗下"产品名-CODE" (optional quotes; may be 等N个产品). */
function parseCmsCustodyNavSubject(text: string): { code: string; fundName: string } | null {
  const quoted = text.match(
    new RegExp(
      `管理人旗下[""''\\u201c\\u201d]([\\u4e00-\\u9fff\\d]+${FUND_LEGAL_SUFFIX}(?:[ABC]类|[ABC])?)-([A-Z0-9]+)[""''\\u201c\\u201d]`,
      "u",
    ),
  )
  if (quoted) {
    const fundName = finalizeExtractedFundName(quoted[1])
    if (fundName) return { code: quoted[2], fundName }
  }

  // Unquoted: 管理人旗下 山信至诚一号证券投资基金-SBA005等2个产品…
  const unquoted = text.match(
    new RegExp(
      `管理人旗下\\s*([\\u4e00-\\u9fff\\d]+${FUND_LEGAL_SUFFIX}(?:[ABC]类|[ABC])?)-([A-Z0-9]+)`,
      "u",
    ),
  )
  if (!unquoted) return null
  const fundName = finalizeExtractedFundName(unquoted[1])
  if (!fundName) return null
  return { code: unquoted[2], fundName }
}

/** Parse CODE_FUNDNAME from 资产净值公告 subjects / filenames. */
function parseAssetNavAnnouncementSubject(text: string): { code: string; fundName: string } | null {
  const underscored = text.match(
    new RegExp(
      `资产净值公告_([A-Z0-9]+)_([\\u4e00-\\u9fff\\d]+${FUND_LEGAL_SUFFIX}(?:[ABC]类|[ABC])?)_`,
      "u",
    ),
  )
  if (underscored) {
    const fundName = finalizeExtractedFundName(underscored[2])
    if (fundName) return { code: underscored[1], fundName }
  }
  // Filename: 资产净值公告_SVP460墨雪鑫瑞1号私募证券投资基金_20260805.xls
  const glued = text.match(
    new RegExp(
      `资产净值公告_([A-Z0-9]{4,10})(${FUND_NAME_RE.source})_(20\\d{6})`,
      "u",
    ),
  )
  if (glued) {
    const fundName = finalizeExtractedFundName(glued[2])
    if (fundName) return { code: glued[1], fundName }
  }

  // Subject: 20260805墨雪鑫瑞1号私募证券投资基金SVP460资产净值公告
  const dated = text.match(
    new RegExp(`^(20\\d{6})(${FUND_NAME_RE.source})([A-Z0-9]{4,10})资产净值公告`, "u"),
  )
  if (dated) {
    const fundName = finalizeExtractedFundName(dated[2])
    if (fundName) return { code: dated[3], fundName }
  }

  return null
}

/**
 * Citics Auto-Disclosure:
 *   【基金净值】SBDF95(总)_产品名_YYYYMMDD-YYYYMMDD
 *   【净值公告】SGC823_量锐28号私募证券投资基金_净值公告_20190304-20260824
 */
function parseCiticsFundNavSubject(text: string): { code: string; fundName: string } | null {
  const bracket = text.match(
    new RegExp(`【(?:基金净值|净值公告)】([A-Z0-9]+)(?:\\([^)]*\\))?_(?:${FUND_NAME_RE.source})_`),
  )
  if (bracket) {
    const fundName = pickBestFundNameMatch(text)
    if (fundName) return { code: bracket[1], fundName }
  }

  // Filename / untagged subject: SGC823_量锐28号私募证券投资基金_净值公告_20190304-20260824
  const underscored = text.match(
    new RegExp(
      `(?:^|[^A-Z0-9])([A-Z0-9]{4,10})_(${FUND_NAME_RE.source})_净值公告_(20\\d{6})`,
      "u",
    ),
  )
  if (!underscored) return null
  const fundName = finalizeExtractedFundName(underscored[2])
  if (!fundName) return null
  return { code: underscored[1], fundName }
}

/** Prefer fund names from the subject line, ignoring investor names in 【】. */
function extractFundNameFromSubject(subject: string): string | null {
  for (const parser of [
    parseXingyePerfTrialSubject,
    parseCfscTaVirtualSubject,
    parseZhongtaiVirtualNavSubject,
    parseCscVirtualNavDisclosureSubject,
    parseFofBracketVirtualNavSubject,
    parseCmsCustodyNavSubject,
    parseCiticsFundNavSubject,
    parseVirtualEstSubject,
    parseAssetNavAnnouncementSubject,
    parseVirtualPerfSubject,
    parseValuationTableSubject,
  ]) {
    const parsed = parser(subject)
    if (parsed?.fundName) {
      return finalizeExtractedFundName(parsed.fundName) ?? parsed.fundName
    }
  }

  const taVirtualInvestor = subject.match(
    new RegExp(
      `【([\\u4e00-\\u9fff\\d]+${FUND_LEGAL_SUFFIX}(?:[ABC]类|[ABC])?)】TA虚拟净值`,
      "u",
    ),
  )
  if (taVirtualInvestor) {
    // Guotai TA虚拟净值: underlying fund is outside 【】; bracket is the 在管/investor.
    // Always prefer the outer name — do not require an override hit (锡泰 was missing).
    const underlying = pickBestFundNameMatch(subject.replace(/【[^】]*】/g, " "))
    if (underlying) return underlying
    return finalizeExtractedFundName(taVirtualInvestor[1])
  }

  const bracketVirtualSubj = subject.match(
    new RegExp(
      `【虚拟净值】[A-Z0-9]+[\\s_]([\\u4e00-\\u9fff\\d]+${FUND_LEGAL_SUFFIX})_`,
      "u",
    ),
  )
  if (bracketVirtualSubj) return finalizeExtractedFundName(bracketVirtualSubj[1])

  const virtualSubj = subject.match(
    new RegExp(
      `】[A-Z0-9]+(?:\\([总]\\))?_(?:[\\u4e00-\\u9fff\\d]+${FUND_LEGAL_SUFFIX}(?:[ABC]类|[ABC])?)_`,
      "u",
    ),
  )
  if (virtualSubj) {
    const fundName = pickBestFundNameMatch(subject)
    if (fundName) return fundName
  }

  const guotaiSubj = subject.match(/发送[：:](.+?)(?:【|$)/)
  if (guotaiSubj && /私募证券|投资基金/.test(guotaiSubj[1])) {
    // The capture may include a leading beian code and trailing date, e.g.
    // "SAVW72_金舆基石一号私募证券投资基金20260617估值表" — apply FUND_NAME_RE
    // to extract just the clean fund name. Never keep bare manager company names.
    const fromCapture = pickBestFundNameMatch(guotaiSubj[1])
    if (fromCapture) return fromCapture
    return finalizeExtractedFundName(guotaiSubj[1])
  }

  return pickBestFundNameMatch(subject)
}

/** Guosen/国信托管: SAUV26邦客鼎成精选私募证券投资基金净值2026-07-09【国信托管】 */
function parseGuosenCustodyNavSubject(text: string): { code: string; fundName: string } | null {
  const m = text.match(
    new RegExp(
      `^([A-Z0-9]{4,8})([\\u4e00-\\u9fff\\d]+${FUND_LEGAL_SUFFIX}(?:[ABC]类|[ABC])?)净值(\\d{4}-\\d{2}-\\d{2}|20\\d{6})`,
      "u",
    ),
  )
  if (!m) return null
  const fundName = finalizeExtractedFundName(m[2])
  if (!fundName) return null
  return { code: m[1], fundName }
}

/**
 * Guotai Junan TA virtual NAV: underlying fund outside 【】, 在管 product / investor inside 【】.
 * Example: …金奥追风1号…A【金舆追风1号私募证券投资基金】TA虚拟净值_2026-07-22
 *
 * Body/table NAV is always the underlying fund's — never ingest it under the managed product.
 */
function isGuotaiTaVirtualManagedProductNavEmail(subject: string): boolean {
  // Any Guotai-style …【investor】TA虚拟净值… — bracket is never the NAV fund.
  return new RegExp(
    `【[\\u4e00-\\u9fff\\d]+${FUND_LEGAL_SUFFIX}(?:[ABC]类|[ABC])?】TA虚拟净值`,
    "u",
  ).test(subject)
}

/**
 * Force Guotai TA虚拟净值 rows onto the underlying fund (outside 【】), never the 在管 investor.
 * Resolves 备案号 from the underlying display name when the subject has no product code.
 */
function guotaiTaVirtualUnderlyingMeta(
  subject: string,
  shared: { productCode: string | null; fundName: string | null },
): { productCode: string | null; fundName: string | null } {
  if (!isGuotaiTaVirtualManagedProductNavEmail(subject)) return shared

  const underlyingName = pickBestFundNameMatch(subject.replace(/【[^】]*】/g, " "))

  // If extract still landed on a 在管/investor label, force the outer underlying name.
  let fundName = shared.fundName
  if (!fundName || resolveManagedProductBeian(fundName) || resolveManagedProductBeianIgnoringShareClass(fundName)) {
    fundName = underlyingName ?? fundName
  }
  if (!fundName) return shared

  const fromName = resolveFundHoldingCode("", fundName)
  const keepCode =
    shared.productCode
    && !lookupManagedProductOverride(shared.productCode)
    && !resolveManagedProductBeian(shared.fundName ?? "")
    && !resolveManagedProductBeianIgnoringShareClass(shared.fundName)
  return {
    productCode: keepCode ? shared.productCode : (fromName ?? shared.productCode),
    fundName,
  }
}

function resolveFromStructuredSubject(subject: string): { code: string; fundName: string } | null {
  for (const parser of [
    parseXingyePerfTrialSubject,
    parseCfscTaVirtualSubject,
    parseVirtualBracketSubject,
    parseZhongtaiVirtualNavSubject,
    parseFofBracketVirtualNavSubject,
    parseCmsCustodyNavSubject,
    parseCiticsFundNavSubject,
    parseGuosenCustodyNavSubject,
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
  // Citics Auto-Disclosure uses both 估算 and 估值 in the bracket tag.
  const m = text.match(
    new RegExp(`【基金虚拟净值表现估[算值]】([A-Z0-9]+)_(${FUND_NAME_RE.source})_(\\d{4}-\\d{2}-\\d{2})`),
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

/**
 * Xingye/兴证运营 业绩报酬试算表:
 *   20260805_SBBC18贞元强势1号私募证券投资基金_XY8002280517_金舆守安一号…业绩报酬试算表
 *   20260805_ADS17B臻财长雪1号B类_XY8002280517_金舆守安一号…业绩报酬试算表
 * Code is glued to the fund name (no underscore). Investor/FOF is the trailing name.
 */
function parseXingyePerfTrialSubject(text: string): { code: string; fundName: string } | null {
  if (!/业绩报酬试算表/u.test(text)) return null
  const full = text.match(
    new RegExp(`^(20\\d{6})_([A-Z0-9]{4,10})(${FUND_NAME_RE.source})_[A-Z0-9]+_`, "u"),
  )
  if (full) return { code: full[2], fundName: normalizeFundDisplayName(full[3]) }

  // Short display names without 私募证券投资基金 (e.g. 臻财长雪1号B类).
  const short = text.match(
    /^(20\d{6})_([A-Z0-9]{4,10})([\u4e00-\u9fff][\u4e00-\u9fffA-Za-z0-9]*?(?:[ABC]类|[ABC])?)_([A-Z]{1,4}\d{6,}|\d{6,})_/u,
  )
  if (!short) return null
  return { code: short[2], fundName: normalizeFundDisplayName(short[3]) }
}

/** Strip a leading beian/product code glued onto a Chinese fund name (SBBC18贞元…). */
function stripLeadingProductCode(name: string, productCode?: string | null): string {
  const trimmed = name.trim()
  if (!trimmed) return trimmed
  const code = (productCode ?? "").trim().toUpperCase()
  if (code && trimmed.toUpperCase().startsWith(code)) {
    const rest = trimmed.slice(code.length).replace(/^[\s_\-]+/u, "")
    if (/^[\u4e00-\u9fff]/u.test(rest)) return rest
  }
  const glued = trimmed.match(/^([A-Z]{1,6}\d{2,6}[A-Z]?)([\u4e00-\u9fff].+)$/u)
  if (glued) return glued[2]
  return trimmed
}

/**
 * Zhongtai/中泰证券 virtual NAV:
 *   SZJ909_汇融林健CTA9号私募证券投资基金_金舆瑞泰一号私募证券投资基金_虚拟净值_20260731
 * Underlying product is the first fund name; investor/FOF is the second.
 */
function parseZhongtaiVirtualNavSubject(text: string): { code: string; fundName: string } | null {
  const withInvestor = text.match(
    new RegExp(
      `^([A-Z0-9]{4,10})_(${FUND_NAME_RE.source})_(${FUND_NAME_RE.source})_虚拟净值_(20\\d{6})(?:\\.|$)`,
      "u",
    ),
  )
  if (withInvestor) {
    return { code: withInvestor[1], fundName: normalizeFundDisplayName(withInvestor[2]) }
  }
  const simple = text.match(
    new RegExp(`^([A-Z0-9]{4,10})_(${FUND_NAME_RE.source})_虚拟净值_(20\\d{6})(?:\\.|$)`, "u"),
  )
  if (!simple) return null
  return { code: simple[1], fundName: normalizeFundDisplayName(simple[2]) }
}

/**
 * CSC/中信建投 虚拟净值提取信息披露 (subject or attachment filename):
 *   墨雪鑫瑞1号私募证券投资基金-金舆稳健增长1号FOF私募证券投资基金-虚拟净值提取信息披露邮件20260806
 *   自然红启程2号私募证券投资基金（B类份额）-金舆稳健增长1号FOF…-虚拟净值提取…
 *   墨雪鑫瑞1号…_金舆稳健增长1号FOF…_虚拟净值数据20260807.xlsx
 * Underlying is the first fund name; investor/FOF is the second.
 * Code is usually only in the body/xlsx — leave empty so body/attachment can fill it.
 */
function parseCscVirtualNavDisclosureSubject(text: string): { code: string; fundName: string } | null {
  if (!/虚拟净值提取|虚拟净值查询|虚拟净值数据/u.test(text)) return null
  const m = text.match(
    new RegExp(
      `(${FUND_NAME_RE.source})(?:（[^）]*）|\\([^)]*\\))?[\\-_](${FUND_NAME_RE.source})[\\-_]?虚拟净值`,
      "u",
    ),
  )
  if (!m) return null
  const fundName = normalizeFundDisplayName(m[1])
  if (!fundName) return null
  return { code: "", fundName }
}

/**
 * FOF virtual-NAV mail: outer investor/FOF name + bracket underlying code/name.
 * Example: 金舆基石一号私募证券投资基金【SXN097-古曲祥辰5号私募证券投资基金】虚拟净值20260709
 * NAV belongs to the bracket product (SXN097 / 古曲祥辰5号), not the outer FOF name.
 */
function parseFofBracketVirtualNavSubject(text: string): { code: string; fundName: string } | null {
  const m = text.match(
    new RegExp(`【([A-Z0-9]{4,10})[-－](${FUND_NAME_RE.source})】[^】]*虚拟净值`, "u"),
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

  // 华泰: SCQ403_金舆锡泰一号私募证券投资基金_产品估值表_日报_20260817.xls
  const huataiDaily = text.match(
    /^([A-Z0-9]+)_([\u4e00-\u9fffA-Za-z0-9]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?)_产品估值表_日报_(20\d{6})/u,
  )
  if (huataiDaily) return { code: huataiDaily[1], fundName: normalizeFundDisplayName(huataiDaily[2]) }

  // 华泰: SCQ403_金舆锡泰一号私募证券投资基金估值表20260817 (no underscore before 估值表/date)
  const huataiGlued = text.match(
    /^([A-Z0-9]+)_([\u4e00-\u9fffA-Za-z0-9]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?)估值表(20\d{6})/u,
  )
  if (huataiGlued) return { code: huataiGlued[1], fundName: normalizeFundDisplayName(huataiGlued[2]) }

  // 【估值表】SCU622 金舆稳健增长1号FOF私募证券投资基金_20260730
  const bracket = text.match(
    /【估值表】\s*([A-Z0-9]{4,10})\s+([\u4e00-\u9fffA-Za-z0-9]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?)_(20\d{6})/u,
  )
  if (bracket) return { code: bracket[1], fundName: normalizeFundDisplayName(bracket[2]) }
  return null
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

  const virtualSubj = text.match(/】([A-Z]{1,6}\d{2,6}[A-Z]?)(?:\([总]\))?_/)
  if (virtualSubj) return virtualSubj[1]

  const bracketVirtualSubj = text.match(/【虚拟净值】([A-Z0-9]+)[\s_]/)
  if (bracketVirtualSubj) return bracketVirtualSubj[1]

  // Typical codes: SBPC20, ASX73A, BSJ74B — allow underscore-delimited codes
  const m = text.match(/(?:^|[^A-Z0-9])_?([A-Z]{1,6}\d{2,6}[A-Z]?)(?:_|[^A-Z0-9]|$)/)
    ?? text.match(/(?:^|[^A-Z0-9])([A-Z]{1,6}\d{2,6}[A-Z]?)(?![A-Z0-9])/)
  const code = m?.[1] ?? null
  // Reject share-class letter glued to a year (e.g. C2026 from …基金2026-07-30).
  if (code && /^[ABC](?:19|20)\d{2}$/i.test(code)) return null
  return code
}

export function extractFundNameFromText(text: string): string | null {
  const labeled = text.match(/基金名称\s*[：:]\s*([^\n\r]+)/)
  if (labeled) {
    const fromLabel = finalizeExtractedFundName(labeled[1])
    if (fromLabel) return fromLabel
  }

  const firstLine = text.split("\n")[0] ?? ""
  const fromSubject = extractFundNameFromSubject(firstLine)
  if (fromSubject) return fromSubject

  return pickBestFundNameMatch(text)
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
  let name = normalizeFundDisplayName(stripLeadingProductCode(fundName, productCode))
  if (/[ABC]类$/.test(name)) return name

  const fromEstSubj = parseVirtualEstSubject(subject)
  if (fromEstSubj?.fundName && /[ABC]类$/.test(fromEstSubj.fundName)) return fromEstSubj.fundName

  const fromAssetSubj = parseAssetNavAnnouncementSubject(subject)
  if (fromAssetSubj?.fundName && /[ABC]类$/.test(fromAssetSubj.fundName)) return fromAssetSubj.fundName

  // Never append share-class from an underlying code onto a 在管/investor name
  // (…【荣熙共赢…】TA虚拟净值 + AVM35A must not become "荣熙共赢A类").
  if (resolveManagedProductBeian(name) || isGuotaiTaVirtualManagedProductNavEmail(subject)) {
    const subjClassOnly = subject.match(/私募证券投资基金([ABC])【/)
      ?? subject.match(/私募证券投资基金([ABC])类_/)
    if (subjClassOnly && !resolveManagedProductBeian(name)) {
      return `${name}${subjClassOnly[1]}类`
    }
    return name
  }

  const fromCode = shareClassFromProductCode(productCode)
  if (fromCode) return `${name}${fromCode}`

  const subjClass = subject.match(/私募证券投资基金([ABC])【/)
    ?? subject.match(/私募证券投资基金([ABC])类_/)
  if (subjClass) return `${name}${subjClass[1]}类`

  return name
}

/**
 * Custody emails sometimes reuse another product's code in the subject while the
 * fund_name is a different product (SQQ300 appears on both 多资产轮动策略3号 and
 * 文艺复兴26号). Force a stable code so pool sync / NAV history do not collide.
 */
export function applyEmailProductCodeOverride(
  productCode: string | null,
  fundName: string | null,
  subject = "",
): string | null {
  const blob = `${fundName ?? ""} ${subject}`
  if (/文艺复兴\s*26\s*号/u.test(blob) || /文艺复兴26/u.test(blob)) {
    return "SQQ26A"
  }
  // Citics virtual-NAV mails use T07998 / STG733; AMAC / dashboard 备案号 is TG733C.
  if (/宁苑沛华稳定增长一号/u.test(blob)) {
    return "TG733C"
  }
  const code = productCode?.trim().toUpperCase()
  if (!code) return null
  return remapManagedProductBeianCode(code) ?? code
}

export function extractNavMetadata(subject: string, bodyText: string) {
  const structured = resolveFromStructuredSubject(subject)
  // CSC virtual disclosure subjects have no product code — do not short-circuit
  // before body/attachment can supply SVP460 / BSQ40B etc.
  if (structured?.code) {
    return {
      productCode: applyEmailProductCodeOverride(
        structured.code,
        structured.fundName,
        subject,
      ),
      fundName: structured.fundName,
    }
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
  return {
    productCode: applyEmailProductCodeOverride(productCode, fundName, subject),
    fundName,
  }
}

// ── date candidates from subject ──────────────────────────────────────────────

/**
 * Match 单位净值 but not 虚拟单位净值 / 试算单位净值 / 试算后单位净值.
 * Xingye 业绩报酬试算表 lists both official 单位净值 and fee-trial 试算单位净值.
 */
function matchActualUnitNav(bodyText: string): RegExpMatchArray | null {
  return (
    // Exclude 累计单位净值 / 虚拟单位净值 / 试算后单位净值 label bleed.
    bodyText.match(/(?<!累计)(?<!虚拟)(?<!试算)(?<!试算后)单位净值\s*[：:]\s*(\d+\.\d{3,8})/u)
    ?? bodyText.match(/(?<!累计)(?<!虚拟)(?<!试算)(?<!试算后)单位净值\s+(\d+\.\d{3,8})/u)
    // CSC/中信建投 资产净值公告 body labels
    ?? bodyText.match(/基金份额净值\s*[：:]\s*(\d+\.\d{3,8})/u)
    ?? bodyText.match(/基金份额净值\s+(\d+\.\d{3,8})/u)
  )
}

/** Resolve Huatai 虚拟业绩报酬 triple: either UNIT/CUM/VIRTUAL or VIRTUAL/UNIT/CUM. */
function resolveHuataiPerfFeeNavTriple(
  bodyText: string,
  a: number,
  b: number,
  c: number,
): { nav: number; cumulativeNav: number } {
  const near = (x: number, y: number) => Math.abs(x - y) < 1e-4
  const unitIdx = bodyText.search(/(?<!累计)(?<!虚拟)单位净值/u)
  const virtualIdx = bodyText.search(/虚拟单位净值/u)
  if (unitIdx >= 0 && virtualIdx >= 0) {
    if (unitIdx < virtualIdx) {
      // HTML table: 发生份额 单位净值 累计单位净值 虚拟单位净值
      return { nav: near(a, c) ? c : a, cumulativeNav: b }
    }
    // VIRTUAL … UNIT … CUM
    return { nav: a, cumulativeNav: c }
  }
  // Numeric heuristic when headers are missing:
  // UNIT/CUM/VIRTUAL → first≈third (unit≈virtual), middle is distinct cum.
  if (near(a, c) && !near(a, b)) return { nav: a, cumulativeNav: b }
  // VIRTUAL/UNIT/CUM → first≈second, third is cum.
  if (near(a, b) && !near(a, c)) return { nav: a, cumulativeNav: c }
  // Default to documented VIRTUAL/UNIT/CUM (historical parser behaviour).
  return { nav: a, cumulativeNav: c }
}

function matchCumulativeUnitNav(bodyText: string): RegExpMatchArray | null {
  return (
    bodyText.match(/累计单位净值\s*[：:]\s*(\d+\.\d{3,8})/u)
    ?? bodyText.match(/累计单位净值\s+(\d+\.\d{3,8})/u)
    ?? bodyText.match(/(?<!虚拟)累计净值\s*[：:]\s*(\d+\.\d{3,8})/u)
    ?? bodyText.match(/(?<!虚拟)累计净值\s+(\d+\.\d{3,8})/u)
    ?? bodyText.match(/基金份额累计净值\s*[：:]\s*(\d+\.\d{3,8})/u)
    ?? bodyText.match(/基金份额累计净值\s+(\d+\.\d{3,8})/u)
  )
}

function parseVirtualBracketSubject(text: string): { code: string; fundName: string } | null {
  const m = text.match(
    /【虚拟净值】([A-Z0-9]+)[\s_]([\u4e00-\u9fff\d]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金))_/u,
  )
  if (!m) return null
  return { code: m[1], fundName: normalizeFundDisplayName(m[2]) }
}

/**
 * CFSC/财通证券 【TA虚拟净值】-DATE-CODE-FUND-INVESTOR
 * Example: 【TA虚拟净值】-2026-08-03-ZY084A-交睿宏观配置5号私募证券投资基金A-金舆基石一号…
 */
function parseCfscTaVirtualSubject(text: string): { code: string; fundName: string } | null {
  const m = text.match(
    new RegExp(
      `【TA虚拟净值】-\\d{4}-\\d{2}-\\d{2}-([A-Z0-9]{4,10})-(${FUND_NAME_RE.source})-`,
      "u",
    ),
  )
  if (!m) return null
  return { code: m[1], fundName: normalizeFundDisplayName(m[2]) }
}

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
  // Guotai TA虚拟净值 with a 在管 product in 【】: ingest under the underlying fund
  // outside 【】 (never under the investor / 在管 product code).
  const shared = guotaiTaVirtualUnderlyingMeta(subject, extractNavMetadata(subject, bodyText))

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

  // ── 1b. Xingye/兴证 业绩报酬试算表 (official 单位净值, not 试算单位净值) ───
  if (/业绩报酬试算表/u.test(subject) || parseXingyePerfTrialSubject(subject)) {
    const unitNavM = matchActualUnitNav(bodyText)
    const cumNavM = matchCumulativeUnitNav(bodyText)
    const dateM =
      bodyText.match(/基金净值日期\s*[：:\s]\s*(20\d{6}|\d{4}[-年/]\d{1,2}[-月/]\d{1,2}日?)/u)
      ?? bodyText.match(/净值日期\s*[：:\s]\s*(20\d{6}|\d{4}[-年/]\d{1,2}[-月/]\d{1,2}日?)/u)
    const navDate = dateM ? normaliseDate(dateM[1]) : subjectDate(subject)
    if (unitNavM && navDate) {
      return {
        nav: parseFloat(unitNavM[1]),
        navDate,
        cumulativeNav: cumNavM ? parseFloat(cumNavM[1]) : null,
        adjustedNav: null,
        ...shared,
        source: "body_table",
      }
    }
  }

  // ── 2a0. Body: CFSC 【TA虚拟净值】 table (date code fund investor unit cum virtual) ─
  // 净值日期 产品代码 产品名称 客户名称 单位净值 累计单位净值 虚拟单位净值 …
  if (/TA虚拟净值/u.test(subject) && /净值日期/.test(bodyText)) {
    const cfscRowM = bodyText.match(
      /(\d{4}-\d{2}-\d{2})\s+([A-Z0-9]{4,10})\s+([\u4e00-\u9fff\d]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?)\s+[\u4e00-\u9fffA-Za-z0-9]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?\s+(\d+\.\d{3,8})\s+(\d+\.\d{3,8})(?:\s+(\d+\.\d{3,8}))?/u,
    )
    if (cfscRowM) {
      return {
        nav: parseFloat(cfscRowM[4]),
        navDate: cfscRowM[1],
        cumulativeNav: parseFloat(cfscRowM[5]),
        adjustedNav: null,
        productCode: shared.productCode ?? cfscRowM[2],
        fundName: shared.fundName ?? normalizeFundDisplayName(cfscRowM[3]),
        source: "body_table",
      }
    }
  }

  // ── 2a. Body: 【虚拟净值】GJDF table (单位净值 + 累计单位净值 + 虚拟单位净值) ─
  if (/【虚拟净值】/.test(subject) && /净值日期/.test(bodyText)) {
    const bracketRowM = bodyText.match(
      /(\d{4}-\d{2}-\d{2})\s+[\s\S]*?\b([A-Z0-9]{4,8})\s+([\u4e00-\u9fff\d]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金))\s+[\d,]+(?:\.\d+)?\s+(\d+\.\d{3,8})\s+(\d+\.\d{3,8})\s+[\d,.]+\s+(\d+\.\d{3,8})/u,
    )
    if (bracketRowM) {
      return {
        nav: parseFloat(bracketRowM[4]),
        navDate: bracketRowM[1],
        cumulativeNav: parseFloat(bracketRowM[5]),
        adjustedNav: null,
        productCode: shared.productCode ?? bracketRowM[2],
        fundName: shared.fundName ?? normalizeFundDisplayName(bracketRowM[3]),
        source: "body_table",
      }
    }
  }

  // ── 2a1. Body: Zhongtai/中泰 CODE_产品_投资者_虚拟净值_YYYYMMDD ─────────────
  // 产品代码 产品名称 基金账号 客户名称 业务日期 持仓份额 单位净值 累计单位净值 拟计业绩报酬 虚拟净值
  // SZJ909 汇融林健CTA9号… QL8059373444 金舆瑞泰一号… 20260731 940,822.28 1.0628 1.5902 0.00 1.0628
  if (
    parseZhongtaiVirtualNavSubject(subject)
    || (/_虚拟净值_\d{8}/u.test(subject) && /业务日期|单位净值/.test(bodyText))
  ) {
    const zhongtaiRowM = bodyText.match(
      new RegExp(
        `([A-Z0-9]{4,10})\\s+(${FUND_NAME_RE.source})\\s+[A-Z0-9]+\\s+${FUND_NAME_RE.source}\\s+(20\\d{6})\\s+[\\d,]+(?:\\.\\d+)?\\s+(\\d+\\.\\d{3,8})\\s+(\\d+\\.\\d{3,8})`,
        "u",
      ),
    )
    if (zhongtaiRowM) {
      return {
        nav: parseFloat(zhongtaiRowM[4]),
        navDate: normaliseDate(zhongtaiRowM[3]),
        cumulativeNav: parseFloat(zhongtaiRowM[5]),
        adjustedNav: null,
        productCode: shared.productCode ?? zhongtaiRowM[1],
        fundName: shared.fundName ?? normalizeFundDisplayName(zhongtaiRowM[2]),
        source: "body_table",
      }
    }
  }

  // ── 2a2. Body: CSC/中信建投 虚拟净值提取信息披露 ───────────────────────────
  // Prefer post-fee unit (扣除净值后的 / 虚拟净值提取后), not pre-fee 未扣除/提取前.
  // Example subject: …虚拟净值提取信息披露邮件20260806
  // Row: SVP460 墨雪鑫瑞1号… 20260806 3.7673 1328127.08 1726.57 3.766 3.7673 …
  if (
    /虚拟净值提取|虚拟净值查询|虚拟净值数据/u.test(subject)
    || /扣除净值后的单位净值|虚拟净值提取后单位净值/u.test(bodyText)
  ) {
    const labeledUnit =
      bodyText.match(/虚拟净值提取后单位净值\s*[：:]\s*(\d+\.\d{2,8})/u)
      ?? bodyText.match(/扣除净值后的单位净值\s*[：:]\s*(\d+\.\d{2,8})/u)
    const labeledCum =
      bodyText.match(/虚拟净值提取后累计单位净值\s*[：:]\s*(\d+\.\d{2,8})/u)
      ?? bodyText.match(/扣除净值后的累计单位净值\s*[：:]\s*(\d+\.\d{2,8})/u)
      ?? bodyText.match(/虚拟净值提取前累计单位净值\s*[：:]\s*(\d+\.\d{2,8})/u)
    const labeledDate =
      bodyText.match(/净值日期\s*[：:]\s*(20\d{6}|\d{4}[-/]\d{1,2}[-/]\d{1,2})/u)
      ?? null
    if (labeledUnit) {
      return {
        nav: parseFloat(labeledUnit[1]),
        navDate: labeledDate
          ? normaliseDate(labeledDate[1])
          : subjectDate(subject),
        cumulativeNav: labeledCum ? parseFloat(labeledCum[1]) : null,
        adjustedNav: null,
        ...shared,
        source: "body_table",
      }
    }

    const cscVirtualRowM = bodyText.match(
      new RegExp(
        `([A-Z0-9]{4,10})\\s+(${FUND_NAME_RE.source})\\s+[\\s\\S]*?(20\\d{6}|\\d{4}-\\d{2}-\\d{2})\\s+(\\d+\\.\\d{3,8})\\s+[\\d,]+(?:\\.\\d+)?\\s+[\\d,]+(?:\\.\\d+)?\\s+(\\d+\\.\\d{2,8})\\s+(\\d+\\.\\d{3,8})`,
        "u",
      ),
    )
    if (cscVirtualRowM) {
      return {
        nav: parseFloat(cscVirtualRowM[5]),
        navDate: normaliseDate(cscVirtualRowM[3]),
        cumulativeNav: parseFloat(cscVirtualRowM[6]),
        adjustedNav: null,
        productCode: shared.productCode ?? cscVirtualRowM[1],
        fundName: shared.fundName ?? normalizeFundDisplayName(cscVirtualRowM[2]),
        source: "body_table",
      }
    }
  }

  // ── 2. Body: colon-label or table-header style ─────────────────────────────
  const unitNavM = matchActualUnitNav(bodyText)
  const cumNavM = matchCumulativeUnitNav(bodyText)

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
  // Two observed layouts after HOLDINGS:
  //   A) UNIT CUM VIRTUAL [withdrawn] — Huatai HTML (单位净值|累计单位净值|虚拟单位净值)
  //   B) VIRTUAL UNIT CUM — older/plain rows
  // TA891A 瀛岳核心...A类 20260326 S18852474004 荣熙共赢... 996412.91 2.0085 <unit> <cum>
  // ABG508 金麦穗...B类 20260805 S18052979410 金辉守望... 945260.93 1.0545 1.2245 1.0545 0
  if (
    !/【虚拟净值】/.test(subject)
    && (/虚拟业绩报酬/.test(subject) || /虚拟单位净值/.test(bodyText))
  ) {
    const perfRowM = bodyText.match(
      /([A-Z0-9]{4,8})\s+([\u4e00-\u9fff\d]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?)\s+(\d{8})\s+S[A-Z0-9]+\s+(.+?)\s+([\d,]+(?:\.\d+)?)\s+(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)/,
    )
    if (perfRowM) {
      const resolved = resolveHuataiPerfFeeNavTriple(
        bodyText,
        parseFloat(perfRowM[6]),
        parseFloat(perfRowM[7]),
        parseFloat(perfRowM[8]),
      )
      return {
        nav: resolved.nav,
        navDate: normaliseDate(perfRowM[3]) ?? subjectDate(subject),
        cumulativeNav: resolved.cumulativeNav,
        adjustedNav: null,
        productCode: shared.productCode ?? perfRowM[1],
        fundName: shared.fundName ?? normalizeFundDisplayName(perfRowM[2]),
        source: "body_table",
      }
    }
  }

  // ── 3. Body: CMS/招商 净值表 table row ────────────────────────────────────
  // 2026年06月08日 SBNX55 荣熙共赢私募证券投资基金 1.0065 1.0065
  // Use the row's own code/name — subject only names the first of 等N个产品.
  const cmsRowM = bodyText.match(
    /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日\s+([A-Z0-9]{4,8})\s+([\u4e00-\u9fff\d]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?)\s+(\d+\.\d+)\s+(\d+\.\d+)/u,
  )
  if (cmsRowM) {
    return {
      nav: parseFloat(cmsRowM[6]),
      navDate: normaliseDate(`${cmsRowM[1]}-${cmsRowM[2]}-${cmsRowM[3]}`),
      cumulativeNav: parseFloat(cmsRowM[7]),
      adjustedNav: null,
      productCode: cmsRowM[4].toUpperCase(),
      fundName: normalizeFundDisplayName(cmsRowM[5]) || shared.fundName,
      source: "body_table",
    }
  }

  // ── 3c. Body: Guosen/国信托管 table row ───────────────────────────────────
  // 1 SAUV26 邦客鼎成精选私募证券投资基金 2026-07-09 未授权 未授权 1.3014 1.3014
  const guosenRowM = bodyText.match(
    /([A-Z0-9]{4,8})\s+([\u4e00-\u9fff\d]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?)\s+(20\d{2}-\d{2}-\d{2})\s+(?:\S+\s+)*?(\d+\.\d{3,8})\s+(\d+\.\d{3,8})/u,
  )
  if (guosenRowM) {
    return {
      nav: parseFloat(guosenRowM[4]),
      navDate: guosenRowM[3],
      cumulativeNav: parseFloat(guosenRowM[5]),
      adjustedNav: null,
      productCode: shared.productCode ?? guosenRowM[1],
      fundName: shared.fundName ?? normalizeFundDisplayName(guosenRowM[2]),
      source: "body_table",
    }
  }

  // ── 3c2. Body: CSC/中信建投 资产净值公告 (DATE CODE NAME UNIT CUM) ─────────
  // 2026-07-24 SADE15 汉鸿景明1号私募证券投资基金 1.0007 1.0007
  const cscRowM = bodyText.match(
    /(20\d{2}-\d{2}-\d{2})\s+([A-Z0-9]{4,8})\s+([\u4e00-\u9fff\d]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?)\s+(\d+\.\d{3,8})\s+(\d+\.\d{3,8})/u,
  )
  if (cscRowM) {
    return {
      nav: parseFloat(cscRowM[4]),
      navDate: cscRowM[1],
      cumulativeNav: parseFloat(cscRowM[5]),
      adjustedNav: null,
      productCode: shared.productCode ?? cscRowM[2],
      fundName: shared.fundName ?? normalizeFundDisplayName(cscRowM[3]),
      source: "body_table",
    }
  }

  // ── 3d. Body: Changjiang 长江证券 虚拟净值 (试算后单位净值 column) ─────────
  // 2026-07-09 2026-07-10 SB969A 铸锋太阿3号...A类 ... 1.0000 1 1 1000000.00
  if (/^虚拟净值-/u.test(subject) || /试算后单位净值/u.test(bodyText)) {
    const cjRowM = bodyText.match(
      /(\d{4}-\d{2}-\d{2})\s+\d{4}-\d{2}-\d{2}\s+([A-Z0-9]{4,8})\s+([\u4e00-\u9fff\d]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?)[\s\S]*?(\d+\.\d{2,8})\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+[\d,]+\.[\d]+/u,
    )
    if (cjRowM) {
      return {
        nav: parseFloat(cjRowM[4]),
        navDate: cjRowM[1],
        cumulativeNav: parseFloat(cjRowM[6]),
        adjustedNav: null,
        productCode: shared.productCode ?? cjRowM[2],
        fundName: shared.fundName ?? normalizeFundDisplayName(cjRowM[3]),
        source: "body_table",
      }
    }
  }

  // ── 4. Body: 虚拟净值表现估算/估值 table format (before generic date+decimal) ───
  // Subject: 【基金虚拟净值表现估算|估值】PRODUCT_NAVDATE_INVESTOR
  // Table columns: ...虚拟净值 | 实际净值 | 实际累计净值
  // Store 实际净值 (not per-investor 虚拟净值).
  if (/虚拟净值表现估[算值]/.test(subject) || /虚拟净值\s+实际净值/.test(bodyText)) {
    const taRowM = bodyText.match(
      /(\d{4}-\d{2}-\d{2})\s+TA计提\s+[\d,.]+\s+\d+\s+(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)/,
    )
    if (taRowM) {
      return {
        nav:          parseFloat(taRowM[3]),
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
        nav:          parseFloat(virtualNavM[3]),
        navDate:      subjectDate(subject) ?? virtualNavM[1],
        cumulativeNav: parseFloat(virtualNavM[4]),
        adjustedNav: null,
        ...shared,
        source: "body_table",
      }
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

  return null
}

/** Full fund-name segment in 资产净值公告 body tables (code name date unit cum). */
const HISTORY_TABLE_ROW_RE =
  /([A-Z0-9]{4,8})\s+([\u4e00-\u9fff\d]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?)\s+(\d{4}-\d{2}-\d{2})\s+(\d+\.\d+)\s+(\d+\.\d+)/g

/** CSC/中信建投 资产净值公告: date code name unit cum. */
const HISTORY_TABLE_ROW_DATE_FIRST_RE =
  /(\d{4}-\d{2}-\d{2})\s+([A-Z0-9]{4,8})\s+([\u4e00-\u9fff\d]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?)\s+(\d+\.\d+)\s+(\d+\.\d+)/g

/** CMS/招商 净值表: 2026年07月24日 CODE NAME unit cum. */
const HISTORY_TABLE_ROW_CMS_RE =
  /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日\s+([A-Z0-9]{4,8})\s+([\u4e00-\u9fff\d]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?)\s+(\d+\.\d+)\s+(\d+\.\d+)/gu

/** `等N个产品` in CMS/招商 【净值表】 subjects. */
export function cmsMultiProductCountFromSubject(subject: string): number | null {
  const m = subject.match(/等\s*(\d+)\s*个产品/u)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** True when a 等N个产品 mail was stored with fewer distinct product_code values than N. */
export function isCmsMultiProductNavIncomplete(
  subject: string,
  distinctProductCodes: number,
): boolean {
  const expected = cmsMultiProductCountFromSubject(subject)
  if (expected == null) return false
  return distinctProductCodes < expected
}

/**
 * Batch 补发 tables sometimes put code/name only in the header/subject and
 * emit one `日期 单位净值 累计净值` row per line.
 */
const HISTORY_TABLE_ROW_DATE_NAV_RE =
  /^(\d{4}-\d{2}-\d{2})\s+(\d+\.\d{3,8})\s+(\d+\.\d{3,8})\s*$/gm

const CMS_CHINESE_DATE_RE = /\d{4}年\s*\d{1,2}月\s*\d{1,2}日/u

function hasNavHistoryTable(bodyText: string, subject: string): boolean {
  return (
    /产品代码\s+产品名称\s+净值日期/u.test(bodyText) ||
    /日期\s+产品代码\s+产品名称/u.test(bodyText) ||
    /产品代码\s+产品名称\s+日期/u.test(bodyText) ||
    /批量补发/u.test(subject) ||
    /资产净值公告/u.test(subject) ||
    (/管理人旗下/u.test(subject) && CMS_CHINESE_DATE_RE.test(bodyText)) ||
    (cmsMultiProductCountFromSubject(subject) != null && CMS_CHINESE_DATE_RE.test(bodyText))
  )
}

type HistoryRowCandidate = {
  code: string
  fundNameRaw: string
  navDate: string
  nav: number
  cumulativeNav: number
}

/**
 * Extract all historical NAV rows from a multi-row body table (e.g. 资产净值公告).
 * Single-product mails keep only the subject product code; CMS multi-product
 * subjects (`等N个产品`) and tables with multiple codes keep every fund.
 */
export function extractNavHistoryFromBody(
  subject: string,
  bodyText: string,
): ExtractedNavData[] {
  const shared = extractNavMetadata(subject, bodyText)
  const expectedCode = shared.productCode?.toUpperCase()
  const candidates: HistoryRowCandidate[] = []
  const seenRaw = new Set<string>()

  const addCandidate = (
    code: string,
    fundNameRaw: string,
    navDate: string,
    nav: number,
    cumulativeNav: number,
  ) => {
    const key = `${code}|${navDate}`
    if (seenRaw.has(key)) return
    seenRaw.add(key)
    candidates.push({ code, fundNameRaw, navDate, nav, cumulativeNav })
  }

  // CMS 年月日 rows are enough to identify 等N个产品 tables even when the
  // subject/header gate would miss them (split cells, missing 等N个产品).
  for (const m of bodyText.matchAll(HISTORY_TABLE_ROW_CMS_RE)) {
    const navDate = normaliseDate(`${m[1]}-${m[2]}-${m[3]}`)
    if (!navDate) continue
    addCandidate(m[4].toUpperCase(), m[5], navDate, parseFloat(m[6]), parseFloat(m[7]))
  }

  if (hasNavHistoryTable(bodyText, subject)) {
    for (const m of bodyText.matchAll(HISTORY_TABLE_ROW_RE)) {
      addCandidate(m[1].toUpperCase(), m[2], m[3], parseFloat(m[4]), parseFloat(m[5]))
    }
    for (const m of bodyText.matchAll(HISTORY_TABLE_ROW_DATE_FIRST_RE)) {
      addCandidate(m[2].toUpperCase(), m[3], m[1], parseFloat(m[4]), parseFloat(m[5]))
    }
  }

  const distinctCodes = new Set(candidates.map((row) => row.code))
  const multiProduct =
    cmsMultiProductCountFromSubject(subject) != null || distinctCodes.size > 1

  // Date/NAV-only rows belong to single-product 补发 mails, not CMS multi-product tables.
  if (expectedCode && !multiProduct && hasNavHistoryTable(bodyText, subject)) {
    for (const m of bodyText.matchAll(HISTORY_TABLE_ROW_DATE_NAV_RE)) {
      addCandidate(
        expectedCode,
        shared.fundName ?? "",
        m[1],
        parseFloat(m[2]),
        parseFloat(m[3]),
      )
    }
  }

  if (candidates.length === 0) return []

  const rows: ExtractedNavData[] = []
  const seenKeys = new Set<string>()
  for (const c of candidates) {
    if (!multiProduct && expectedCode && c.code !== expectedCode) continue
    const key = `${c.code}|${c.navDate}`
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    const rowName = normalizeFundDisplayName(c.fundNameRaw)
    const fundName =
      !multiProduct || !expectedCode || c.code === expectedCode
        ? shared.fundName ?? rowName
        : rowName || shared.fundName
    rows.push({
      nav: c.nav,
      navDate: c.navDate,
      cumulativeNav: c.cumulativeNav,
      adjustedNav: null,
      productCode: c.code,
      fundName,
      source: "body_table",
    })
  }
  return rows
}
