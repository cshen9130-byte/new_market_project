/**
 * Rank fund-contract files so 要素 extraction prefers the latest 合同 / 补充协议.
 */

export type ContractDocumentKind = "supplement" | "contract" | "announcement" | "other"

export type ContractDocumentRecency = {
  kind: ContractDocumentKind
  kindRank: number
  date: string | null
  dateMs: number
  uploadedMs: number
}

const KIND_RANK: Record<ContractDocumentKind, number> = {
  supplement: 3,
  contract: 2,
  other: 1,
  announcement: 0,
}

const SUPPLEMENT_RE = /补充协议|补充合同|修订协议|变更协议|合同变更|条款变更|修正案|修订案|减免说明|业绩报酬减免|费率调整|要素变更/
const CONTRACT_RE = /基金合同|产品合同|私募基金合同|私募合同|合同/
const ANNOUNCEMENT_RE = /公告|意见征询|通知|告知函/

export function contractDocumentKind(fileName: string): ContractDocumentKind {
  const name = fileName || ""
  if (SUPPLEMENT_RE.test(name)) return "supplement"
  if (ANNOUNCEMENT_RE.test(name) && !CONTRACT_RE.test(name)) return "announcement"
  if (CONTRACT_RE.test(name)) return "contract"
  return "other"
}

function padDay(year: string, month: string, day?: string): string | null {
  const y = parseInt(year, 10)
  const m = parseInt(month, 10)
  const d = day ? parseInt(day, 10) : 1
  if (!Number.isFinite(y) || y < 1990 || y > 2100) return null
  if (!Number.isFinite(m) || m < 1 || m > 12) return null
  if (!Number.isFinite(d) || d < 1 || d > 31) return null
  return `${year}-${month.padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

/** Best document/version date from a filename such as 20260805, 2026-07-22, 202602. */
export function contractDocumentDate(fileName: string): string | null {
  const name = fileName || ""
  const full = name.match(/(?:^|[^\d])(20\d{2})[-._]?([01]\d)[-._]?([0-3]\d)(?:[^\d]|$)/)
  if (full) return padDay(full[1], full[2], full[3])
  const month = name.match(/(?:^|[^\d])(20\d{2})[-._]?([01]\d)(?:[^\d]|$)/)
  if (month) return padDay(month[1], month[2])
  return null
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) return 0
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : 0
}

export function contractDocumentRecency(input: {
  fileName: string
  uploadedAt?: string | null
}): ContractDocumentRecency {
  const kind = contractDocumentKind(input.fileName)
  const date = contractDocumentDate(input.fileName)
  const dateMs = date ? Date.parse(`${date}T00:00:00`) : 0
  return {
    kind,
    kindRank: KIND_RANK[kind],
    date,
    dateMs: Number.isFinite(dateMs) ? dateMs : 0,
    uploadedMs: parseTimestamp(input.uploadedAt),
  }
}

/** Positive if `a` is a newer source of 要素 than `b`. */
export function compareContractDocumentRecency(
  a: ContractDocumentRecency,
  b: ContractDocumentRecency,
): number {
  if (a.dateMs && b.dateMs && a.dateMs !== b.dateMs) return a.dateMs - b.dateMs
  if (a.dateMs && !b.dateMs) return 1
  if (!a.dateMs && b.dateMs) return -1
  if (a.kindRank !== b.kindRank) return a.kindRank - b.kindRank
  return a.uploadedMs - b.uploadedMs
}

export function isLatestContractDocument(
  current: ContractDocumentRecency,
  others: ContractDocumentRecency[],
): boolean {
  if (current.kind === "announcement") return false
  if (current.kind === "supplement") {
    const otherSupplements = others.filter((row) => row.kind === "supplement")
    return otherSupplements.every((row) => compareContractDocumentRecency(current, row) >= 0)
  }
  if (others.some((row) => row.kind === "supplement")) return false
  for (const other of others) {
    if (compareContractDocumentRecency(current, other) < 0) return false
  }
  return true
}
