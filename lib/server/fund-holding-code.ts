/**
 * Extract 估值表 product codes for fund holdings (uppercase A–Z / 0–9 only).
 * Example: ALF51B, TA891A, 004373, 512000
 */

import { query } from "@/lib/db"
import { sqlFundNameMatch } from "@/lib/server/fund-name-match"
import { canonicalizeShareClassBeianCode } from "@/lib/server/share-class-product"
import { stripValuationSubjectPathPrefix } from "@/lib/valuation-holding-display-name"

function compactSubjectCode(code: string | null | undefined): string {
  return String(code ?? "")
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(/(SH|SZ|BJ|OTC)$/i, "")
}

/** 3003 证券清算款 (e.g. 理财产品申购款) — not a fund holding, even if the leaf name is a 私募. */
export function isValuationClearingSubjectCode(code: string | null | undefined): boolean {
  return compactSubjectCode(code).startsWith("3003")
}

export function sqlSubjectCodeIsClearing(codeExpr: string): string {
  return `REPLACE(REPLACE(COALESCE(${codeExpr}, ''), ' ', ''), '.', '') LIKE '3003%'`
}

/**
 * 1109.06.99 / 1108.02.99 估值增值 leaf (11090699STX591).
 * Does not match product codes that merely contain "99" (11090601BAH99C).
 */
export function isValuationIncrementSubjectCode(code: string | null | undefined): boolean {
  return /^110[89]\d{2}99/i.test(compactSubjectCode(code))
}

export function sqlSubjectCodeIsValuationIncrement(codeExpr: string): string {
  return `REPLACE(REPLACE(COALESCE(${codeExpr}, ''), ' ', ''), '.', '') ~ '^110[89][0-9]{2}99'`
}

export type ValuationFundSubjectRole =
  | "position"
  | "valuation_adj"
  | "subscription"
  | "redemption"
  | "clearing"

export function classifyValuationFundSubjectRole(
  code: string | null | undefined,
): ValuationFundSubjectRole {
  const c = compactSubjectCode(code)
  if (isValuationIncrementSubjectCode(c)) return "valuation_adj"
  if (c.startsWith("30032002")) return "redemption"
  if (c.startsWith("30032001") || c.startsWith("30032003")) return "subscription"
  if (c.startsWith("3003")) return "clearing"
  return "position"
}

function extractCodeFromDottedSubject(original: string): string | null {
  const text = String(original ?? "").trim()
  if (!text) return null
  const parts = text.split(/[.\s]+/).filter(Boolean)
  for (let i = parts.length - 1; i >= 0; i--) {
    const token = parts[i].replace(/(SH|SZ|BJ|OTC)$/i, "").trim()
    if (/^\d{6}$/.test(token)) return formatFundHoldingCode(token)
  }
  return null
}

/**
 * Explicit name → code overrides for funds whose beian codes cannot be
 * reliably inferred from their 估值表 subject code or DB lookup.
 * Key: normalized fund name (strip 私募证券投资基金/私募基金 suffix + share class).
 */
const FUND_NAME_CODE_OVERRIDES: Record<string, string> = {
  "金和和善对冲1号":                    "STA933",
  "宁苑沛华稳定增长一号":               "TG733C",
  "磐松红利指数增强1号":                "SAGF05",
  "棕榈滩泰来":                         "AVF39",
  "棕榈滩泰来三号":                     "BVC41",
  "乾上泉对冲一号":                     "ALF51",
  "交睿宏观配置1号":                    "JX860B",
}

/** 估值表 subject code (often S-prefix / no share-class suffix) → canonical 备案号. */
export const FOF_VALUATION_CODE_ALIASES: Readonly<Record<string, string>> = {
  SALF51: "ALF51B",
  SVN917: "VN917B",
  SATL22: "ATL22A",
  STG733: "TG733C",
  // Citics Auto-Disclosure virtual-NAV codes for the same underlying (C类 / OCR).
  T07998: "TG733C",
  TG7998: "TG733C",
  SNW169: "NW169B",
  SSJ392: "SJ392B",
  STA891: "TA891A",
  STA891A: "TA891A",
  SZG868: "ZG868A",
  SBTH74B: "BTH74B",
  // 金舆锡泰一号 估值表 uses custodian ticker JRHG02 / JRHG02B for the same B类.
  JRHG02: "JX860B",
  JRHG02B: "JX860B",
}

export function resolveFofValuationCodeAlias(code: string | null | undefined): string | null {
  const c = String(code ?? "").trim().toUpperCase()
  if (!c) return null
  if (FOF_VALUATION_CODE_ALIASES[c]) return FOF_VALUATION_CODE_ALIASES[c]
  // Mistaken S-prefixed share-class codes: SBTH74B → BTH74B
  const canonical = canonicalizeShareClassBeianCode(c)
  if (canonical && canonical !== c) return canonical
  return null
}

/** Known A-share ETF name patterns → 6-digit ticker code. */
const ETF_NAME_PATTERNS: Array<{ test: RegExp; code: string }> = [
  { test: /华宝.*证券.*ETF/u, code: "512000" },
  { test: /嘉实.*科创板.*芯片.*ETF/u, code: "588200" },
  { test: /广发.*恒生.*港股通.*科技.*ETF/u, code: "159262" },
]

export function isListedFundCode(code: string | null | undefined): boolean {
  return /^\d{6}$/.test(String(code ?? "").trim())
}

const EXCHANGE_ETF_TICKER_RE =
  /^(50[0-9]{4}|51[0-9]{4}|52[0-9]{4}|53[0-9]{4}|56[0-9]{4}|588[0-9]{3}|159[0-9]{3}|16[0-3][0-9]{3})$/

const ASHARE_STOCK_TICKER_RE =
  /^(000|001|002|003|300|301|600|601|603|605|688|689)[0-9]{3}$/

/** Whether a 6-digit code is an exchange-listed ETF ticker (not open-end fund). */
export function isExchangeEtfTicker(code: string | null | undefined): boolean {
  const c = String(code ?? "").trim()
  return EXCHANGE_ETF_TICKER_RE.test(c)
}

/** Whether a 6-digit code looks like an A-share stock ticker. */
export function isAshareStockTicker(code: string | null | undefined): boolean {
  const c = String(code ?? "").trim()
  if (!/^\d{6}$/.test(c) || isExchangeEtfTicker(c)) return false
  return ASHARE_STOCK_TICKER_RE.test(c)
}

function resolveHoldingTicker(
  subjectCode: string | null | undefined,
  subjectName: string | null | undefined,
  symbol: string | null | undefined,
): string {
  const resolved =
    resolveFundHoldingCode(String(subjectCode ?? ""), String(subjectName ?? ""), symbol)
    ?? String(symbol ?? "").trim().toUpperCase()
  return resolved.replace(/\.(SH|SZ|BJ)$/i, "")
}

/** True when name/code looks like an exchange-listed ETF, not a 私募 with "ETF" in the strategy name. */
function isExchangeEtfNameOrCode(name: string, code: string): boolean {
  if (/私募/u.test(name)) return false
  if (code && !/^\d{6}$/.test(code)) return false
  if (/ETF/u.test(name)) {
    // Private-fund short names like 绵烁ETF套利3号A类 must stay in FOF底层.
    if (/[0-9]+号|[ABC]类/u.test(name) && !/^\d{6}$/.test(code)) return false
    if (/^\d{6}$/.test(code)) return isExchangeEtfTicker(code)
    return !/[0-9]+号/u.test(name)
  }
  return /^\d{6}$/.test(code) && isExchangeEtfTicker(code)
}

/** Direct A-share stock or exchange ETF — not an FOF underlying fund holding. */
export function isDirectEquityOrListedEtfHolding(input: {
  subjectCode?: string | null
  subjectName?: string | null
  symbol?: string | null
  rowKind?: string | null
}): boolean {
  const name = String(input.subjectName ?? "")
  const kind = String(input.rowKind ?? "")
  const compactSubj = compactSubjectCode(input.subjectCode)

  if (kind === "private_fund" || /私募/u.test(name)) return false
  if (kind === "stock") return true

  const ticker = resolveHoldingTicker(input.subjectCode, name, input.symbol)
  if (isExchangeEtfNameOrCode(name, ticker)) return true

  if (/基金|私募/u.test(name)) return false

  if (
    /^\d{6}$/.test(ticker)
    && isAshareStockTicker(ticker)
    && (kind === "fund_or_stock" || compactSubj.startsWith("1102") || compactSubj.startsWith("1001"))
  ) {
    return true
  }

  if (kind === "fund" && compactSubj.startsWith("1105") && /^\d{6}$/.test(ticker) && isExchangeEtfTicker(ticker)) {
    return true
  }

  return false
}

/** For fof_underlying_summary rows (product name + optional beian/code). */
export function isDirectEquityOrListedEtfProduct(
  productName: string,
  beianHao?: string | null,
): boolean {
  const name = String(productName ?? "")
  if (/私募/u.test(name)) return false

  const code = String(beianHao ?? "").trim().toUpperCase() || extractListedFundCodeFromName(name) || ""
  const ticker = code.replace(/\.(SH|SZ|BJ)$/i, "")

  if (isExchangeEtfNameOrCode(name, ticker)) return true
  if (/基金|私募|资管|信托|专户/u.test(name)) return false
  // Private-fund short names like 策行9号 / 径灵成长1号A类 are not equities.
  if (/[0-9]+号/u.test(name)) return false
  // Non-6-digit pure-numeric codes (e.g. 杰理科技 / 1920138) are not fund beians.
  if (/^\d+$/.test(ticker) && ticker.length !== 6) return true
  if (!/^\d{6}$/.test(ticker)) return false

  return isAshareStockTicker(ticker)
}

export type FofUnderlyingFundClass = "private" | "public"

/**
 * SQL fragment: true when a FOF底层 summary row is a 私募基金
 * (AMAC letter beian, 私募 in name, or typical N号 short name — not 公募/个股).
 */
export function sqlIsPrivateFofUnderlying(productNameExpr: string, beianExpr: string): string {
  const beian = `COALESCE(NULLIF(BTRIM(${beianExpr}), ''), '')`
  return `(
    ${productNameExpr} ~* '私募'
    OR ${beian} ~ '[A-Za-z]'
    OR (
      ${productNameExpr} ~* '[0-9]+号'
      AND ${beian} !~ '^[0-9]{6}$'
    )
  )`
}

/** SQL fragment filtering FOF底层 by 基金分类 (私募 / 公募). */
export function sqlFofUnderlyingFundClassFilter(
  fundClass: FofUnderlyingFundClass,
  productNameExpr: string,
  beianExpr: string,
): string {
  const beian = `COALESCE(NULLIF(BTRIM(${beianExpr}), ''), '')`
  const isPrivate = sqlIsPrivateFofUnderlying(productNameExpr, beianExpr)
  if (fundClass === "private") return isPrivate
  return `(
    NOT ${isPrivate}
    AND (
      ${productNameExpr} ~* '公募'
      OR ${beian} ~ '^[0-9]{6}$'
    )
  )`
}

/** SQL fragment: true when a summary-row product should be excluded from FOF底层 tables. */
export function sqlExcludeFofUnderlyingProduct(productNameExpr: string, beianExpr: string): string {
  const beian = `COALESCE(NULLIF(BTRIM(${beianExpr}), ''), '')`
  // "ETF" in a 私募 short name (e.g. 绵烁ETF套利3号A类 / BBZ20A) is not an exchange ETF.
  return `NOT (
    (
      ${productNameExpr} ~* 'ETF'
      AND ${productNameExpr} !~* '私募'
      AND ${beian} ~ '^[0-9]{6}$'
    )
    OR (
      ${productNameExpr} !~* '基金|私募|ETF'
      AND ${beian} ~ '^(50[0-9]{4}|51[0-9]{4}|52[0-9]{4}|53[0-9]{4}|56[0-9]{4}|588[0-9]{3}|159[0-9]{3}|16[0-3][0-9]{3})$'
    )
    OR (
      ${productNameExpr} !~* '基金|私募|ETF'
      AND ${beian} ~ '^(000|001|002|003|300|301|600|601|603|605|688|689|430|820|830|831|832|833|834|835|836|837|838|839|870|871|872|873|920)[0-9]{3}$'
    )
    OR (
      ${productNameExpr} !~* '基金|私募|资管|信托|专户|ETF'
      AND ${productNameExpr} !~* '[0-9]+号'
      AND ${beian} ~ '^[0-9]+$'
      AND ${beian} !~ '^[0-9]{6}$'
    )
    OR (
      ${productNameExpr} ~ '^[A-Z]?[\u4e00-\u9fff]{1,4}$'
      AND ${productNameExpr} !~* '基金|私募|号'
      AND ${beian} ~ '^[0-9]+$'
    )
  )`
}

/** JS equivalent of SQL_VALUATION_HOLDING_IS_DIRECT_EQUITY_OR_ETF for JSONB row parsing. */
export function isDirectEquityOrEtfValuationHolding(
  subjectName: string,
  subjectCode: string,
  symbol: string | null | undefined,
  rowKind: string | null | undefined,
): boolean {
  const name = String(subjectName ?? "")
  const kind = String(rowKind ?? "")
  const sym = String(symbol ?? "").trim()
  const compactCode = String(subjectCode ?? "").replace(/\s/g, "").replace(/\./g, "")

  if (kind === "private_fund" || /私募/u.test(name)) return false
  if (kind === "stock") return true
  const ticker = sym.replace(/\.(SH|SZ|BJ)$/i, "")
  if (isExchangeEtfNameOrCode(name, ticker)) return true
  if (
    kind === "fund_or_stock"
    && !/基金|私募|ETF/i.test(name)
    && /^\d{6}$/.test(sym)
    && (compactCode.startsWith("1102") || compactCode.startsWith("1001"))
    && isAshareStockTicker(sym)
  ) {
    return true
  }
  if (
    (kind === "fund" || kind === "fund_or_stock")
    && !/基金|私募/i.test(name)
    && isExchangeEtfTicker(sym)
  ) {
    return true
  }
  if (
    !/基金|私募|资管|信托|专户|ETF/i.test(name)
    && !/[0-9]+号/u.test(name)
    && /^\d+$/.test(ticker)
    && ticker.length !== 6
  ) {
    return true
  }
  return false
}

/** SQL fragment: true when valuation holding alias should be excluded from FOF底层 extraction. */
export const SQL_VALUATION_HOLDING_IS_DIRECT_EQUITY_OR_ETF = `(
  (
    h.subject_name ~* 'ETF'
    AND h.subject_name !~* '私募'
    AND h.row_kind IS DISTINCT FROM 'private_fund'
    AND NULLIF(BTRIM(h.symbol), '') ~ '^\\d{6}$'
  )
  OR h.row_kind = 'stock'
  OR (
    h.row_kind = 'fund_or_stock'
    AND h.subject_name !~* '基金|私募|ETF'
    AND NULLIF(BTRIM(h.symbol), '') ~ '^\\d{6}$'
    AND (
      REPLACE(REPLACE(h.subject_code, ' ', ''), '.', '') LIKE '1102%'
      OR REPLACE(REPLACE(h.subject_code, ' ', ''), '.', '') LIKE '1001%'
    )
    AND NULLIF(BTRIM(h.symbol), '') ~ '^(000|001|002|003|300|301|600|601|603|605|688|689)[0-9]{3}$'
  )
  OR (
    h.row_kind IN ('fund', 'fund_or_stock')
    AND h.subject_name !~* '基金|私募'
    AND NULLIF(BTRIM(h.symbol), '') ~ '^(50[0-9]{4}|51[0-9]{4}|52[0-9]{4}|53[0-9]{4}|56[0-9]{4}|588[0-9]{3}|159[0-9]{3}|16[0-3][0-9]{3})$'
  )
  OR (
    h.row_kind IS DISTINCT FROM 'private_fund'
    AND h.subject_name !~* '基金|私募|资管|信托|专户|ETF'
    AND h.subject_name !~* '[0-9]+号'
    AND NULLIF(BTRIM(h.symbol), '') ~ '^[0-9]+$'
    AND NULLIF(BTRIM(h.symbol), '') !~ '^[0-9]{6}$'
  )
)`

/** Same as above for ops_managed_fof_underlying (alias m). */
export const SQL_MANAGED_FOF_UNDERLYING_IS_DIRECT_EQUITY_OR_ETF = `(
  (
    m.underlying_name ~* 'ETF'
    AND m.underlying_name !~* '私募'
    AND m.row_kind IS DISTINCT FROM 'private_fund'
    AND NULLIF(BTRIM(m.underlying_product_code), '') ~ '^\\d{6}$'
  )
  OR m.row_kind = 'stock'
  OR (
    m.row_kind = 'fund_or_stock'
    AND m.underlying_name !~* '基金|私募|ETF'
    AND NULLIF(BTRIM(m.underlying_product_code), '') ~ '^\\d{6}$'
    AND (
      REPLACE(REPLACE(m.subject_code, ' ', ''), '.', '') LIKE '1102%'
      OR REPLACE(REPLACE(m.subject_code, ' ', ''), '.', '') LIKE '1001%'
    )
    AND NULLIF(BTRIM(m.underlying_product_code), '') ~ '^(000|001|002|003|300|301|600|601|603|605|688|689)[0-9]{3}$'
  )
  OR (
    m.row_kind IN ('fund', 'fund_or_stock')
    AND m.underlying_name !~* '基金|私募'
    AND NULLIF(BTRIM(m.underlying_product_code), '') ~ '^(50[0-9]{4}|51[0-9]{4}|52[0-9]{4}|53[0-9]{4}|56[0-9]{4}|588[0-9]{3}|159[0-9]{3}|16[0-3][0-9]{3})$'
  )
  OR (
    m.row_kind IS DISTINCT FROM 'private_fund'
    AND m.underlying_name !~* '基金|私募|资管|信托|专户|ETF'
    AND m.underlying_name !~* '[0-9]+号'
    AND NULLIF(BTRIM(m.underlying_product_code), '') ~ '^[0-9]+$'
    AND NULLIF(BTRIM(m.underlying_product_code), '') !~ '^[0-9]{6}$'
  )
)`

/** Resolve 6-digit exchange-traded fund code from product name. */
export function extractListedFundCodeFromName(name: string): string | null {
  const trimmed = String(name ?? "").trim()
  if (!trimmed) return null

  for (const { test, code } of ETF_NAME_PATTERNS) {
    if (test.test(trimmed)) return formatFundHoldingCode(code)
  }

  if (!/ETF/u.test(trimmed)) return null

  const embedded = trimmed.match(/\b(5[012]\d{4}|159\d{3}|588\d{3}|16[0-3]\d{3})\b/)
  return embedded ? formatFundHoldingCode(embedded[1]) : null
}

/** Map 6-digit fund code to likely EmQuant / DB tickers (SH first). */
export function listedFundCodeToTickers(code: string): string[] {
  const c = String(code ?? "").trim()
  if (!/^\d{6}$/.test(c)) return []
  if (c.startsWith("159") || c.startsWith("16")) return [`${c}.SZ`, `${c}.SH`]
  return [`${c}.SH`, `${c}.SZ`]
}

function normalizeFundNameForLookup(name: string): string {
  const stripped = stripValuationSubjectPathPrefix(name) || name
  return stripped
    .replace(/私募证券投资基金|私募基金|证券投资基金|投资基金/g, "")
    .replace(/[ABC]类$/g, "")
    .trim()
}

/** Keys for matching FOF underlying funds to 估值表 NAV history maps. */
export function fofUnderlyingNavLookupKeys(
  productName: string,
  beianHao: string | null,
  shortName?: string | null,
): string[] {
  const keys = new Set<string>()
  const beian = (beianHao ?? "").trim().toUpperCase()
  if (beian) {
    keys.add(beian)
    const parent = beian.replace(/[ABC]$/u, "")
    if (parent !== beian) keys.add(parent)
    if (beian === "ALF51B") keys.add("SALF51")
  }

  const trimmed = productName.trim()
  if (trimmed) {
    keys.add(trimmed)
    const norm = normalizeFundNameForLookup(trimmed)
    if (norm) keys.add(norm)
    const override = FUND_NAME_CODE_OVERRIDES[norm]
    if (override) keys.add(override.toUpperCase())
  }

  const short = (shortName ?? "").trim()
  if (short) {
    keys.add(short)
    const shortNorm = normalizeFundNameForLookup(short)
    if (shortNorm) keys.add(shortNorm)
  }

  return [...keys].filter(Boolean)
}

function overrideCodeFromName(subjectName: string): string | null {
  const key = normalizeFundNameForLookup(String(subjectName ?? "").trim())
  const code = FUND_NAME_CODE_OVERRIDES[key]
  if (!code) return null
  const shareFromName = shareClassFromFundName(String(subjectName ?? ""))
  return appendShareClass(code, shareFromName)
}

/** Share class letter from fund name, e.g. "B类" → "B". */
export function shareClassFromFundName(name: string): string {
  const m = String(name ?? "").match(/([ABC])类/u)
  return m ? m[1].toUpperCase() : ""
}

/** Valid codes: uppercase letters + digits only (e.g. ALF51B, 512000). */
export function formatFundHoldingCode(code: string | null | undefined): string | null {
  const trimmed = String(code ?? "").trim().toUpperCase()
  if (!trimmed) return null
  if (!/^[A-Z0-9]+$/.test(trimmed)) return null
  return trimmed
}

function appendShareClass(base: string, shareClass: string): string | null {
  const code = base.toUpperCase()
  const cls = shareClass.toUpperCase()
  if (!cls) return formatFundHoldingCode(code)
  if (/[ABC]$/.test(code)) return formatFundHoldingCode(code)
  return formatFundHoldingCode(code + cls)
}

/** Extract valuation-table fund code from subject code + name. */
export function extractFundHoldingCode(subjectCode: string, subjectName: string): string | null {
  const compact = compactSubjectCode(subjectCode)
  const name = String(subjectName ?? "").trim()
  const shareFromName = shareClassFromFundName(name)

  // 1109 / 1108 private funds: 11090601TA891A, 11080201BVC41AOTC, 11080201AVF39AOTC
  if (/^110[89]/.test(compact)) {
    const embedded = compact.match(/110[89]\d+(?:01)?([A-Z]{2}[A-Z0-9]{3,5}[ABC]?)/i)
    if (embedded) {
      const code = embedded[1].toUpperCase()
      if (/[ABC]$/.test(code)) return formatFundHoldingCode(code)
      return appendShareClass(code, shareFromName)
    }
  }

  // 1105 open-end / ETF on exchange: 11050201512000SH → 512000, 1105.02.01.512000 SH
  if (compact.startsWith("1105")) {
    const listed = compact.match(
      /1105(?:\d{2})*?(5[012]\d{4}|588\d{3}|159\d{3}|16[0-3]\d{3})(?:SH|SZ|BJ)?$/i,
    )
    if (listed) return formatFundHoldingCode(listed[1])
    const tail = compact.match(/(\d{6})$/)
    if (tail) return formatFundHoldingCode(tail[1])
  }

  // 1102 ETF / exchange-traded fund: ...512000, ...159262, ...588200
  if (compact.startsWith("1102")) {
    const etf = compact.match(/(588\d{3}|1[59]\d{5}|5[12]\d{4,5})$/i)
    if (etf) return formatFundHoldingCode(etf[1])
    const six = compact.match(/(\d{6})$/)
    if (six) return formatFundHoldingCode(six[1])
  }

  // Name contains explicit beian-style code (SBCE40, STA933, etc.)
  const beianMatch = name.match(/\b([A-Z]{2}[A-Z0-9]{3,6})\b/u)
  if (beianMatch) {
    return appendShareClass(beianMatch[1], shareFromName)
  }

  return null
}

/** Normalize an existing symbol / beian code with share class from fund name. */
export function normalizeFundHoldingCode(
  rawCode: string | null | undefined,
  subjectName: string,
): string | null {
  const trimmed = String(rawCode ?? "").trim()
  if (!trimmed) return null
  const shareFromName = shareClassFromFundName(subjectName)
  // Numeric fund codes (004373, 512000) — no share class suffix
  if (/^\d+$/.test(trimmed)) return formatFundHoldingCode(trimmed)
  return appendShareClass(trimmed, shareFromName)
}

/** Best-effort code: override map → subject code parse → normalize symbol → null. Never returns Chinese text. */
export function resolveFundHoldingCode(
  subjectCode: string,
  subjectName: string,
  existingSymbol?: string | null,
  originalSubjectCode?: string | null,
): string | null {
  const override = overrideCodeFromName(subjectName)
  if (override) return override

  const fromOriginal = extractCodeFromDottedSubject(String(originalSubjectCode ?? ""))
  if (fromOriginal) return fromOriginal

  const fromSubject = extractFundHoldingCode(subjectCode, subjectName)
  if (fromSubject) return fromSubject

  const existing = String(existingSymbol ?? "").trim()
  if (existing && /[\u4e00-\u9fff]/.test(existing)) {
    return null
  }

  const normalized = normalizeFundHoldingCode(existingSymbol, subjectName)
  if (normalized) return normalized

  return extractListedFundCodeFromName(subjectName)
}

/** Resolve beian / product code from fund name across reference tables. */
export async function lookupFundCodeByProductName(productName: string): Promise<string | null> {
  const name = String(productName ?? "").trim()
  if (!name) return null

  const listed = extractListedFundCodeFromName(name)
  if (listed) return listed

  const rows = await query<{ code: string | null }>(
    `SELECT COALESCE(
       (SELECT beian_hao FROM private_fund_info_bfl bfl
        WHERE (${sqlFundNameMatch("bfl.product_name", "$1")} OR ${sqlFundNameMatch("bfl.short_name", "$1")})
          AND NULLIF(BTRIM(bfl.beian_hao), '') IS NOT NULL
        ORDER BY length(bfl.product_name) ASC LIMIT 1),
       (SELECT beian_hao FROM private_fund_info pi
        WHERE ${sqlFundNameMatch("pi.product_name", "$1")}
          AND NULLIF(BTRIM(pi.beian_hao), '') IS NOT NULL
        LIMIT 1),
       (SELECT register_number FROM type6_ops_team_full o
        WHERE (${sqlFundNameMatch("o.fund_name", "$1")} OR ${sqlFundNameMatch("o.fund_short_name", "$1")})
          AND NULLIF(BTRIM(o.register_number), '') IS NOT NULL
        ORDER BY o.updated_at DESC NULLS LAST, o.id DESC LIMIT 1),
       (SELECT product_code FROM ops_email_nav_records en
        WHERE NULLIF(BTRIM(en.product_code), '') IS NOT NULL
          AND ${sqlFundNameMatch("en.fund_name", "$1")}
        ORDER BY en.nav_date DESC NULLS LAST, en.id DESC LIMIT 1)
     ) AS code`,
    [name],
  )

  const code = rows[0]?.code?.trim()
  return code ? formatFundHoldingCode(code) : null
}

/** Repair symbol column on normalized valuation holdings rows. */
export async function backfillFundHoldingSymbols(): Promise<number> {
  const rows = await query<{
    id: string
    subject_code: string
    subject_name: string
    symbol: string | null
  }>(`SELECT id, subject_code, subject_name, symbol FROM ops_email_valuation_holdings`)

  const nameCache = new Map<string, string | null>()
  const patches: { id: number; code: string }[] = []

  for (const row of rows) {
    let code =
      resolveFundHoldingCode(row.subject_code, row.subject_name, row.symbol)
      ?? normalizeFundHoldingCode(row.symbol, row.subject_name)

    if (!code) {
      const cacheKey = row.subject_name.trim()
      if (!nameCache.has(cacheKey)) {
        nameCache.set(cacheKey, await lookupFundCodeByProductName(cacheKey))
      }
      const lookedUp = nameCache.get(cacheKey)
      if (lookedUp) code = normalizeFundHoldingCode(lookedUp, row.subject_name) ?? lookedUp
    }

    code = formatFundHoldingCode(code)
    if (code && code !== String(row.symbol ?? "").toUpperCase()) {
      patches.push({ id: parseInt(row.id, 10), code })
    }
  }

  const chunkSize = 100
  for (let i = 0; i < patches.length; i += chunkSize) {
    const chunk = patches.slice(i, i + chunkSize)
    const values: string[] = []
    const params: unknown[] = []
    let p = 1
    for (const patch of chunk) {
      values.push(`($${p}::bigint, $${p + 1}::text)`)
      params.push(patch.id, patch.code)
      p += 2
    }
    await query(
      `UPDATE ops_email_valuation_holdings h
       SET symbol = v.code
       FROM (VALUES ${values.join(", ")}) AS v(id, code)
       WHERE h.id = v.id`,
      params,
    )
  }

  return patches.length
}
