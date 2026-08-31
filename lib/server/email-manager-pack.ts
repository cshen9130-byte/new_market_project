/**
 * First-contact manager packs: a zip of 历史净值 / 产品要素 / 合同, often without
 * the daily 净值表 / 估值表 keywords. Later the same manager sends routine NAV.
 */

export type ManagerPackAttachment = { filename: string }

/** Custody / TA mail we must not treat as an intro pack. */
const ROUTINE_RE =
  /估值表|估值报表|净值公告|净值波动表|每日净值表|【基金净值】|【净值公告】|虚拟净值|确认单|确认函|批量补发|信披报表|信报报表|业绩报酬|份额明细|投资者明细|台账/u

/** Subject or zip name that already means "product pack", even without 净值. */
const STRONG_PACK_RE =
  /尽调|产品材料|代表性产品|代表产品|产品资料|产品介绍|一页通|要素表|产品要素|历史净值|净值序列|全策略|策略代表|产品包|资料包|路演材料/u

/** Greeting / "please see attachment" subjects used on first outreach. */
const WEAK_PACK_SUBJECT_RE = /请查收|烦请查收|详见附件|附件为|附件请|材料|资料|介绍|合作/u

/** Zip or subject is only the manager / shop name. */
const MANAGER_NAME_RE = /投资|资产|资本|量化|私募|基金管理/u

export function isRoutineCustodyEmail(subject: string, filename = ""): boolean {
  return ROUTINE_RE.test(`${subject}\n${filename}`)
}

export function isManagerProductPackSubject(subject: string): boolean {
  const text = (subject || "").trim()
  if (!text || isRoutineCustodyEmail(text)) return false
  return STRONG_PACK_RE.test(text)
}

export function isManagerProductPackZip(filename: string, subject = ""): boolean {
  if (!/\.zip$/i.test(filename.trim())) return false
  if (/估值报表|估值表/i.test(filename) && !/净值序列|历史净值|要素表|产品要素/i.test(filename)) {
    return false
  }
  if (STRONG_PACK_RE.test(filename)) return true
  if (isRoutineCustodyEmail(subject, filename)) return false
  if (STRONG_PACK_RE.test(subject)) return true
  if (WEAK_PACK_SUBJECT_RE.test(subject)) return true
  if (MANAGER_NAME_RE.test(filename) || MANAGER_NAME_RE.test(subject)) return true
  return false
}

export function isManagerProductPackEmail(
  subject: string,
  attachments: ManagerPackAttachment[],
): boolean {
  if (isRoutineCustodyEmail(subject)) return false
  if (isManagerProductPackSubject(subject) && attachments.some((a) => /\.zip$/i.test(a.filename))) {
    return true
  }
  return attachments.some((a) => isManagerProductPackZip(a.filename, subject))
}

/** After unzip: keep extracting only when innards look like a product pack. */
export function zipInnerPathsLookLikeManagerPack(entryNames: string[]): boolean {
  const blob = entryNames.join("\n")
  return /净值序列|历史净值|_净值[.\s]|\/净值|要素表|产品要素|一页通|基金合同|产品合同/u.test(blob)
}
