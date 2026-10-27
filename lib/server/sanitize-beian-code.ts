/**
 * Never treat a product name or announcement/估值表 filename as 备案编码.
 * Prefer a real AMAC/product code; extract one when it is buried in junk text
 * (e.g. 资产净值公告_SNW169_星阔江月2号 → SNW169).
 */
import {
  normalizeRegisterCode,
} from "@/lib/server/fund-picker-search"
import { isBogusYearProductCode } from "@/lib/server/fund-name-match"
import {
  cleanValuationDerivedFundName,
  isValuationReportTitle,
  parseValuationWorkbookFilename,
} from "@/lib/server/valuation-filename"

const BEIAN_CODE_RE = /(?<![A-Z0-9])([A-Z][A-Z0-9]{4,7}[A-Z]?)(?![A-Z0-9])/gi

/** Filename / announcement fragments that must never be used as 备案编码. */
const JUNK_BEIAN_MARKERS =
  /估值表|净值表|资产净值公告|净值公告|估值报告|披露报告|\.(xlsx?|xls|csv|pdf)$/iu

export function extractRegisterCodesFromText(text: string): string[] {
  const out = new Set<string>()
  const upper = String(text ?? "").toUpperCase()
  for (const match of upper.matchAll(BEIAN_CODE_RE)) {
    const code = normalizeRegisterCode(match[1])
    if (code) out.add(code)
  }
  return Array.from(out)
}

function looksLikeProductName(value: string): boolean {
  const s = value.trim()
  if (!s) return false
  // Chinese product labels, share-class suffixes, or long free text.
  if (/[\u4e00-\u9fff]/.test(s)) return true
  if (s.length > 16) return true
  return false
}

/**
 * Canonicalize a stored beian candidate.
 * Returns null when the value is a product name, filename, or otherwise not a code.
 */
/** Drop share-class annotations and trailing junk after a code token. */
function stripBeianDecorations(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/[（(][ABC]级[）)]/gi, "")
    .replace(/_总层面.*$/u, "")
    .replace(/_汇总.*$/u, "")
    .trim()
}

export function sanitizeBeianCode(
  raw: string | null | undefined,
  productName?: string | null,
): string | null {
  const value = stripBeianDecorations(String(raw ?? ""))
  if (!value) return null

  const direct = normalizeRegisterCode(value)
  if (direct && !isBogusYearProductCode(direct)) return direct

  // Valuation workbook titles often embed CODE+fundName+date.
  const parsed = parseValuationWorkbookFilename(value)
  if (parsed?.code) {
    const fromFile = normalizeRegisterCode(parsed.code)
    if (fromFile && !isBogusYearProductCode(fromFile)) return fromFile
  }

  // Announcement / filename-like junk: extract first plausible code token.
  if (
    JUNK_BEIAN_MARKERS.test(value)
    || isValuationReportTitle(value)
    || value.includes("_")
    || value.includes("/")
    || value.includes("\\")
  ) {
    const embedded = extractRegisterCodesFromText(value)
    if (embedded[0]) return embedded[0]
  }

  // Never fall back to the product name (or any Chinese label) as beian.
  if (looksLikeProductName(value)) {
    const embedded = extractRegisterCodesFromText(value)
    if (embedded[0]) return embedded[0]
    return null
  }

  if (productName) {
    const name = String(productName).trim()
    if (name && value.replace(/\s+/g, "") === name.replace(/\s+/g, "")) {
      return null
    }
  }

  // Leftover non-code tokens (trust tickers, long ids, etc.)
  return null
}

/** True when a stored identity is clearly not a registration code. */
export function isBogusBeianIdentity(
  beian: string | null | undefined,
  productName?: string | null,
): boolean {
  const raw = String(beian ?? "").trim()
  if (!raw) return true
  if (sanitizeBeianCode(raw, productName)) return false
  return true
}

/** Prefer cleaned fund short name when a row stored a 估值表 title as product_name. */
export function sanitizeTrackedProductName(
  raw: string | null | undefined,
): string | null {
  const cleaned = cleanValuationDerivedFundName(raw)
  if (cleaned) return cleaned
  const s = String(raw ?? "").trim()
  return s || null
}
