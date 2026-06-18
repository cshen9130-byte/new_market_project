/**
 * Extract 估值表 product codes for fund holdings (uppercase A–Z / 0–9 only).
 * Example: ALF51B, TA891A, 004373, 512000
 */

import { query } from "@/lib/db"
import { sqlFundNameMatch } from "@/lib/server/fund-name-match"

function compactSubjectCode(code: string): string {
  return String(code ?? "").replace(/\s+/g, "").replace(/\./g, "")
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
}

function normalizeFundNameForLookup(name: string): string {
  return name
    .replace(/私募证券投资基金|私募基金|证券投资基金|投资基金/g, "")
    .replace(/[ABC]类$/g, "")
    .trim()
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

  // 1109 / 1108 private funds: 11090601TA891A, 11090601ALF51B
  if (/^110[89]/.test(compact)) {
    const embedded = compact.match(/110[89]\d+(?:01)?([A-Z]{2}[A-Z0-9]{3,5})([ABC])?$/i)
    if (embedded) {
      return appendShareClass(embedded[1], embedded[2] || shareFromName)
    }
  }

  // 1105 open-end / money market: 11050201004373 → 004373
  if (compact.startsWith("1105")) {
    const tail = compact.match(/(\d{6})$/)
    if (tail) return formatFundHoldingCode(tail[1])
  }

  // 1102 ETF / exchange-traded fund: ...512000, ...159262
  if (compact.startsWith("1102")) {
    const etf = compact.match(/(1[59]\d{5}|5[12]\d{4,5})$/i)
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
): string | null {
  const override = overrideCodeFromName(subjectName)
  if (override) return override

  const fromSubject = extractFundHoldingCode(subjectCode, subjectName)
  if (fromSubject) return fromSubject

  const existing = String(existingSymbol ?? "").trim()
  if (existing && /[\u4e00-\u9fff]/.test(existing)) {
    return null
  }

  return normalizeFundHoldingCode(existingSymbol, subjectName)
}

/** Resolve beian / product code from fund name across reference tables. */
export async function lookupFundCodeByProductName(productName: string): Promise<string | null> {
  const name = String(productName ?? "").trim()
  if (!name) return null

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
