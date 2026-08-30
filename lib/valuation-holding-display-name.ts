/**
 * Display helpers for 估值表 holding subject names.
 * Shared by server allocation + client FOF panels (no DB imports).
 */

const CASH_NAME_RE = /^(银行存款|结算备付金|存出保证金)/u

/** Classification / account-path tokens that precede the real fund name. Longer tokens first. */
const SUBJECT_PATH_TOKEN =
  "(?:私募证券投资基金|私募股权投资基金|证券投资基金|股权投资基金|私募基金|公募基金|投资基金|已上市|开放式|封闭式|私募|公募|基金|成本|市价|份额)"

const LEADING_PATH_TOKENS_RE = new RegExp(`^(?:${SUBJECT_PATH_TOKEN}[_/\\s.]*)+`, "u")
// Allow glued custody exports (no separator between 私募 and 证券投资基金).
const OTC_PATH_RE = new RegExp(`^场外(?:[_/\\s]*${SUBJECT_PATH_TOKEN})+[._/\\s]*`, "u")

/** 中金所_投机_买方_债券期货_成本.30年期国债2412 → 30年期国债2412 */
const DERIVATIVE_EXCHANGE =
  "(?:中国金融期货交易所|上海国际能源交易中心|上海期货交易所|大连商品交易所|郑州商品交易所|广州期货交易所|中金所|上期所|大商所|郑商所|广期所|能源中心|CFFEX|SHFE|INE|DCE|CZCE|GFEX)"
const DERIVATIVE_SUBJECT_PATH_RE = new RegExp(
  `^${DERIVATIVE_EXCHANGE}[_/\\s.]*` +
    `(?:投机|套期保值|套保|套利)[_/\\s.]*` +
    `(?:买方|卖方)[_/\\s.]*` +
    `(?:债券期货|股指期货|商品期货|国债期货|股指期权|商品期权)[_/\\s.]*` +
    `(?:成本|市价)[._/\\s]*`,
  "u",
)

/** True for custody cash / reserve subject labels that must not appear as FOF 基金. */
export function isValuationCashHoldingName(name: string): boolean {
  return CASH_NAME_RE.test(String(name ?? "").trim())
}

/** 场外_已上市_开放式_私募_成本.百奕传家五号 → 百奕传家五号 */
export function stripValuationSubjectPathPrefix(name: string): string {
  let raw = String(name ?? "").trim()
  if (!raw) return ""

  // Normalize fullwidth / alternate separators from some custody exports.
  raw = raw
    .replace(/．/g, ".")
    .replace(/。/g, ".")
    .replace(/／/g, "/")
    .replace(/＿/g, "_")
    .replace(/\u3000/g, " ")

  const before = raw
  const startedWithOtc = /^场外[_/\s]/u.test(before)

  // Broad chop: 场外 + any run of classification tokens (已上市/开放式/私募/成本…).
  raw = raw
    .replace(DERIVATIVE_SUBJECT_PATH_RE, "")
    .replace(OTC_PATH_RE, "")
    .replace(
      /^场外[_/\s]*已上市[_/\s]*开放式[_/\s]*私募(?:证券投资基金|股权投资基金|基金)?[_/\s]*(?:成本|市价)?[._/\s]*/u,
      "",
    )
    .replace(/^场外[_/\s]*已上市[_/\s]*开放式[_/\s]*私募[_/\s]*(?:成本|市价)[._/\s]+/u, "")
    .replace(/^场外[_/\s]*已上市[_/\s]*开放式[_/\s]*私募[._/\s]+/u, "")
    .replace(/^私募[_/\s]*(?:成本|市价)[._/\s]+/u, "")
    .replace(/^其他交易性金融资产投资[._/\s]+/u, "")
    .replace(/^交易性金融资产[._/\s]+/u, "")
    .trim()

  // Drop leftover leading path tokens (e.g. 基金_xxx after partial 场外 chop).
  if (startedWithOtc) {
    raw = raw.replace(LEADING_PATH_TOKENS_RE, "").trim()
  }

  if (raw && raw !== before) return raw

  // Fallback: take leaf after last `.` when left side looks like a subject path.
  const dot = before.lastIndexOf(".")
  if (dot > 0 && dot < before.length - 1) {
    const prefix = before.slice(0, dot)
    const leaf = before.slice(dot + 1).trim()
    if (
      leaf
      && (/场外|已上市|开放式|私募|交易性金融资产|银行存款|结算备付金|存出保证金|成本|市价/.test(prefix))
    ) {
      return leaf
    }
  }

  // Underscore-only paths: …私募_成本_真实名称
  const costLeaf = before.match(/私募[_/\s]*(?:成本|市价)[_/\s]+(.+)$/u)
  if (costLeaf?.[1]?.trim()) return costLeaf[1].trim()

  // Last resort for stubborn 场外… paths: keep the final underscore/slash segment.
  if (startedWithOtc) {
    const parts = before.split(/[_/]+/u).map((p) => p.trim()).filter(Boolean)
    const leaf = parts[parts.length - 1]
    if (
      leaf
      && !/^(场外|已上市|开放式|封闭式|私募|公募|基金|成本|市价|份额|证券投资基金|股权投资基金|投资基金|私募基金|公募基金)$/u.test(leaf)
    ) {
      return leaf
    }
  }

  return before
}
