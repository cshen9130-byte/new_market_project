import { canonicalProductCode, sqlCanonicalProductCode } from "@/lib/server/fund-holding-code"
import { fundNameKey, sqlFundNameKey, sqlStripValuationSubjectPathPrefix } from "@/lib/server/fund-name-match"
import {
  beianFamilyKey,
  canonicalizeShareClassBeianCode,
  sqlBeianFamilyKey,
  sqlCanonicalShareClassBeian,
} from "@/lib/server/share-class-product"
import { stripValuationSubjectPathPrefix } from "@/lib/valuation-holding-display-name"

/**
 * Columns for the materialized `keyed` CTE on 跟踪产品.
 * Regexes stay here so the visibility EXISTS clauses compare plain columns.
 */
export function sqlTrackingIdentityKeyColumns(alias: string): string {
  const code = `UPPER(BTRIM(${alias}.beian_hao))`
  const shareBase = `regexp_replace(${code}, '[ABC]$', '')`
  const nameExpr = sqlStripValuationSubjectPathPrefix(`${alias}.product_name`)
  return `${sqlBeianFamilyKey(`${alias}.beian_hao`)} AS family_key,
    ${sqlFundNameKey(nameExpr)} AS name_key,
    (${code} ~ '[ABC]$') AS is_share_code,
    ${sqlCanonicalShareClassBeian(`${alias}.beian_hao`)} AS canon_share,
    ${sqlCanonicalProductCode(`${alias}.beian_hao`)} AS canon_code,
    CASE WHEN ${code} ~ '[ABC]$' THEN NULLIF(${shareBase}, '') ELSE NULL END AS share_parent_code,
    CASE WHEN ${code} ~ '[ABC]$' THEN NULLIF('S' || ${shareBase}, 'S') ELSE NULL END AS share_s_parent_code`
}

/**
 * One row per product on 跟踪产品.
 *
 * - Hide the parent when its A/B/C share is in the same list. Also match the
 *   share's base and S+base when a short code's family key does not.
 * - Drop a mistaken S-prefix share (SSB595A) when the canonical share (SB595A)
 *   is already listed under the same fund name. Do not rename SB595A to B595A
 *   unless that code is actually in the list.
 * - Drop a known 估值表 / custodian alias when its canonical 备案号 is listed.
 */
export function sqlVisibleTrackingIdentity(rowAlias: string, siblingFrom = "keyed"): string {
  const self = `UPPER(BTRIM(${rowAlias}.beian_hao))`
  return `NOT (
    NOT ${rowAlias}.is_share_code
    AND EXISTS (
      SELECT 1 FROM ${siblingFrom} sib
      WHERE sib.is_share_code
        AND sib.beian_hao <> ${rowAlias}.beian_hao
        AND sib.name_key IS NOT DISTINCT FROM ${rowAlias}.name_key
        AND (
          sib.family_key = ${rowAlias}.family_key
          OR ${self} = sib.share_parent_code
          OR ${self} = sib.share_s_parent_code
        )
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM ${siblingFrom} sib
    WHERE sib.beian_hao <> ${rowAlias}.beian_hao
      AND UPPER(BTRIM(sib.beian_hao)) = UPPER(BTRIM(${rowAlias}.canon_share))
      AND UPPER(BTRIM(${rowAlias}.canon_share)) <> ${self}
      AND sib.name_key IS NOT DISTINCT FROM ${rowAlias}.name_key
  )
  AND NOT EXISTS (
    SELECT 1 FROM ${siblingFrom} sib
    WHERE UPPER(BTRIM(sib.beian_hao)) = UPPER(BTRIM(${rowAlias}.canon_code))
      AND UPPER(BTRIM(${rowAlias}.canon_code)) <> ${self}
  )`
}

export interface TrackingIdentityRow {
  beian_hao: string
  product_name: string
}

function identityNameKey(productName: string): string | null {
  const stripped = stripValuationSubjectPathPrefix(productName) || productName
  return fundNameKey(stripped)
}

/** Same keep/drop rules as {@link sqlVisibleTrackingIdentity}, for tests. */
export function visibleTrackingBeianCodes(rows: TrackingIdentityRow[]): string[] {
  const norm = rows.map((row) => {
    const beian = row.beian_hao.trim().toUpperCase()
    const base = beian.replace(/[ABC]$/u, "")
    return {
      beian,
      nameKey: identityNameKey(row.product_name),
      isShare: /[ABC]$/u.test(beian),
      family: beianFamilyKey(beian),
      canonShare: (canonicalizeShareClassBeianCode(beian) ?? "").toUpperCase(),
      canonCode: canonicalProductCode(beian),
      shareParent: /[ABC]$/u.test(beian) ? base : "",
      shareSParent: /[ABC]$/u.test(beian) ? `S${base}` : "",
    }
  })

  const byBeian = new Map<string, typeof norm>()
  const byName = new Map<string, typeof norm>()
  for (const row of norm) {
    const sameCode = byBeian.get(row.beian)
    if (sameCode) sameCode.push(row)
    else byBeian.set(row.beian, [row])
    const name = row.nameKey ?? ""
    const sameName = byName.get(name)
    if (sameName) sameName.push(row)
    else byName.set(name, [row])
  }

  return norm.filter((row) => {
    if (row.canonShare && row.canonShare !== row.beian) {
      const canonRows = byBeian.get(row.canonShare) ?? []
      if (canonRows.some((sib) => sib.nameKey === row.nameKey)) return false
    }
    if (row.canonCode !== row.beian && byBeian.has(row.canonCode)) return false
    if (!row.isShare) {
      const siblings = byName.get(row.nameKey ?? "") ?? []
      const parentHidden = siblings.some((sib) =>
        sib.isShare
        && sib.beian !== row.beian
        && (
          sib.family === row.family
          || row.beian === sib.shareParent
          || row.beian === sib.shareSParent
        ),
      )
      if (parentHidden) return false
    }
    return true
  }).map((row) => row.beian)
}

/** Drop duplicate identities. Keyword search must use this — it reads the list cache by 备案号 and does not run the list SQL filter. */
export function collapseTrackingIdentities<T extends TrackingIdentityRow>(rows: T[]): T[] {
  const keep = new Set(visibleTrackingBeianCodes(rows))
  const seen = new Set<string>()
  const out: T[] = []
  for (const row of rows) {
    const code = row.beian_hao.trim().toUpperCase()
    if (!keep.has(code) || seen.has(code)) continue
    seen.add(code)
    out.push(row)
  }
  return out
}
