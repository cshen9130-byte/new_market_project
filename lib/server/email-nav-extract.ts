/**
 * NAV extraction from fund email subjects and body text.
 * Handles three sources in priority order:
 *   1. subject  – direct 单位净值：value mention in the subject line
 *   2. body_post_table – colon-separated 单位净值／累计净值 labels in plain text
 *   3. body_table – date + decimal columns found in a table row
 */

export type ExtractedNavData = {
  nav: number | null
  navDate: string | null       // ISO "YYYY-MM-DD"
  cumulativeNav: number | null
  productCode: string | null
  fundName: string | null
  source: "subject" | "body_table" | "body_post_table"
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

function extractProductCode(subject: string): string | null {
  // Typical codes: SBPC20, SBTX45, SBPU97 – pattern: 2-6 uppercase letters + 2-6 digits
  const m = subject.match(/\b([A-Z]{2,6}\d{2,6}[A-Z]?)\b/)
  return m?.[1] ?? null
}

function extractFundName(subject: string): string | null {
  // Match a Chinese phrase ending with 基金, trying to avoid very short matches
  const m = subject.match(
    /[\u4e00-\u9fff][\u4e00-\u9fff\w]{3,}(?:私募证券投资基金|私募基金|证券投资基金|投资基金)/,
  )
  return m?.[0]?.trim() ?? null
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
  const shared = {
    productCode: extractProductCode(subject),
    fundName: extractFundName(subject),
  }

  // ── 1. Subject: 单位净值：1.2269 ──────────────────────────────────────────
  const subjNavM = subject.match(/单位净值\s*[：:]\s*(\d+\.\d{3,8})/)
  if (subjNavM) {
    return {
      nav: parseFloat(subjNavM[1]),
      navDate: subjectDate(subject),
      cumulativeNav: null,
      ...shared,
      source: "subject",
    }
  }

  // ── 2. Body: colon-label style ────────────────────────────────────────────
  const unitNavM = bodyText.match(/单位净值\s*[：:]\s*(\d+\.\d{3,8})/)
  const cumNavM  = bodyText.match(/累计净值\s*[：:]\s*(\d+\.\d{3,8})/)

  if (unitNavM || cumNavM) {
    // Look for a date label in the body first, then fall back to subject
    const bodyDateM =
      bodyText.match(/净值日期\s*[：:\s]\s*(\d{4}[-年/]\d{1,2}[-月/]\d{1,2}(?:[-日]?\d{0,2})?)/) ||
      bodyText.match(/(\d{4}-\d{2}-\d{2})/)
    const navDate =
      bodyDateM
        ? normaliseDate(bodyDateM[1])
        : subjectDate(subject)

    const isTable = /净值日期|┌|│/.test(bodyText)
    return {
      nav:          unitNavM ? parseFloat(unitNavM[1]) : null,
      navDate,
      cumulativeNav: cumNavM ? parseFloat(cumNavM[1]) : null,
      ...shared,
      source: isTable ? "body_table" : "body_post_table",
    }
  }

  // ── 3. Body: table row – date followed by a NAV decimal ───────────────────
  const tableRowM = bodyText.match(
    /(\d{4}-\d{2}-\d{2})\s+(\d+\.\d{3,8})(?:\s+(\d+\.\d{3,8}))?/,
  )
  if (tableRowM) {
    return {
      nav:          parseFloat(tableRowM[2]),
      navDate:      tableRowM[1],
      cumulativeNav: tableRowM[3] ? parseFloat(tableRowM[3]) : null,
      ...shared,
      source: "body_table",
    }
  }

  return null
}
