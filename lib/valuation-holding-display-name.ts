/**
 * Display helpers for 估值表 holding subject names.
 * Shared by server allocation + client FOF panels (no DB imports).
 */

const CASH_NAME_RE = /^(银行存款|结算备付金|存出保证金)/u

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
    .replace(/／/g, "/")

  const before = raw

  // Prefer explicit prefix chop (works for both `.` and `_` after 成本/市价).
  raw = raw
    .replace(/^场外[_/\s]*已上市[_/\s]*开放式[_/\s]*私募[_/\s]*(?:成本|市价)[._/\s]+/u, "")
    .replace(/^场外[_/\s]*已上市[_/\s]*开放式[_/\s]*私募[._/\s]+/u, "")
    .replace(/^私募[_/\s]*(?:成本|市价)[._/\s]+/u, "")
    .replace(/^其他交易性金融资产投资[._/\s]+/u, "")
    .replace(/^交易性金融资产[._/\s]+/u, "")
    .trim()

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

  return before
}
