const LEGAL_SUFFIX_RE =
  /(?:私募证券投资基金|私募股权投资基金|私募基金|证券投资基金|投资基金)$/u
const BARE_LEGAL_RE =
  /^(?:私募证券投资基金|私募股权投资基金|私募基金|证券投资基金|投资基金)([ABC]类|[ABC])?$/u
const SHARE_CLASS_RE = /([ABC]类|[ABC])$/u
const BARE_FRAGMENT_RE = /^(?:私募|基金|证券|投资|证券投资)$/u

/** Strip legal fund-type suffixes for UI display; preserve A/B/C share class. */
export function normalizeFundDisplayName(raw: string): string {
  const s = raw.trim()
  if (!s) return s
  // Bare legal suffixes (or fragments like "私募") are not real product names.
  if (BARE_LEGAL_RE.test(s)) return ""

  let shareClass = ""
  let base = s
  const sc = s.match(SHARE_CLASS_RE)
  if (sc) {
    shareClass = sc[1]
    base = s.slice(0, -shareClass.length)
    if (shareClass.length === 1) shareClass += "类"
  }

  base = base.replace(LEGAL_SUFFIX_RE, "").trim()
  if (!base || BARE_FRAGMENT_RE.test(base)) return ""
  return `${base}${shareClass}`
}

/** Preferred table/chart label: shortened short_name or product_name (whichever is cleaner). */
export function resolveFundDisplayLabel(
  shortName: string | null | undefined,
  productName: string,
): string {
  const labels = [shortName, productName]
    .map((v) => (v ?? "").trim())
    .filter(Boolean)
    .map((v) => normalizeFundDisplayName(v) || v)
  if (labels.length === 0) return ""
  // Prefer the shortest label so inverted full-name-in-short_name fields still shorten.
  return labels.reduce((a, b) => (a.length <= b.length ? a : b))
}
