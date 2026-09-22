/**
 * Parse product identity out of 估值表 / 估值报表 filenames and workbook titles.
 * Custody files often glue 备案号 + short name + date + 估值报表四级 with no
 * underscores and no legal 「基金」suffix:
 *   SAJX62稳博鹏瑞套利2号2026年08月31日估值报表四级.xls
 */

const VALUATION_DATE =
  "(?:20\\d{2}年\\d{1,2}月\\d{1,2}日|20\\d{6}|20\\d{2}-\\d{2}-\\d{2})"
const VALUATION_TAIL =
  "(?:每日)?(?:产品)?(?:[三四]级(?:科目)?)?(?:估值报表|估值表)(?:[三四]级(?:科目)?)?"
const NAME_BODY = "[\\u4e00-\\u9fff][\\u4e00-\\u9fffA-Za-z0-9]*?"

/** Basename of a zip-inner path (`archive.zip::SCP742….xlsx`). */
export function valuationFilenameBase(text: string): string {
  const inner = text.includes("::") ? text.slice(text.lastIndexOf("::") + 2) : text
  const file = inner.split(/[/\\]/).pop() ?? inner
  return file.replace(/\.(xlsx?|xls|csv|pdf)$/i, "").trim()
}

/** True when a stored "product name" is actually a 估值表 filename / title. */
export function isValuationReportTitle(raw: string | null | undefined): boolean {
  const n = String(raw ?? "").trim()
  if (!n) return false
  return /估值报表|估值表/u.test(n) && /20\d{2}/.test(n)
}

/**
 * `CODE + 短名 + 日期 + 估值报表[四级]` (underscores optional).
 * Legal-suffix names (`…私募证券投资基金估值表20260825`) stay with the older parsers.
 */
export function parseValuationWorkbookFilename(
  text: string,
): { code: string; fundName: string } | null {
  const file = valuationFilenameBase(text)
  if (!file || !/估值报表|估值表/u.test(file)) return null

  const glued = file.match(
    new RegExp(`^([A-Z0-9]{4,10})(${NAME_BODY})${VALUATION_DATE}${VALUATION_TAIL}$`, "u"),
  )
  if (glued?.[2]) return { code: glued[1], fundName: glued[2] }

  const underscored = file.match(
    new RegExp(
      `^([A-Z0-9]{4,10})[_\\s-]+(${NAME_BODY})[_\\s-]*${VALUATION_DATE}[_\\s-]*${VALUATION_TAIL}$`,
      "u",
    ),
  )
  if (underscored?.[2]) return { code: underscored[1], fundName: underscored[2] }

  const noCode = file.match(
    new RegExp(`^(${NAME_BODY})${VALUATION_DATE}${VALUATION_TAIL}$`, "u"),
  )
  if (noCode?.[1]) return { code: "", fundName: noCode[1] }

  return null
}

/** Replace a 估值表 title with the embedded product short name; drop unparseable titles. */
export function cleanValuationDerivedFundName(
  raw: string | null | undefined,
): string | null {
  const s = String(raw ?? "").trim()
  if (!s) return null
  const parsed = parseValuationWorkbookFilename(s)
  if (parsed?.fundName) return parsed.fundName
  if (isValuationReportTitle(s)) return null
  return s
}
