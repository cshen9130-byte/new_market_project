/**
 * Same fund filed under two 备案号.
 *
 * 在跟踪池 matches tracking_pool by 备案号. Email and 估值表 imports sometimes
 * store the right fund name with a wrong code, so one fund becomes two rows.
 * This check compares the name instead: the pool's own product name, and the
 * catalog name shown on 平台数据. A类 / B类 / C类 stay separate. A leading S
 * and a parent / share-class pair are the same filing, not a duplicate.
 */

import {
  fundNameKey,
  shareClassLetterFromName,
  sqlFundNameKey,
  sqlPreferAmacOfficialName,
  sqlShareClassLetter,
  sqlStripValuationSubjectPathPrefix,
} from "@/lib/server/fund-name-match"
import { beianFamilyKey, sqlBeianFamilyKey } from "@/lib/server/share-class-product"
import { stripValuationSubjectPathPrefix } from "@/lib/valuation-holding-display-name"

export type FundNameIdentity = {
  family: string
  nameKey: string
  share: string
}

/** Normalized name + share class + 备案号 family. Null when the name or code is empty. */
export function fundNameIdentity(beian: string, name: string): FundNameIdentity | null {
  const cleaned = stripValuationSubjectPathPrefix(name).trim() || name.trim()
  const nameKey = fundNameKey(cleaned)
  const family = beianFamilyKey(beian)
  if (!nameKey || !family) return null
  return {
    family,
    nameKey,
    share: shareClassLetterFromName(cleaned),
  }
}

/** True when two rows are one fund name on two different filings. */
export function sameFundNameDifferentFiling(
  a: { beian: string; name: string },
  b: { beian: string; name: string },
): boolean {
  const left = fundNameIdentity(a.beian, a.name)
  const right = fundNameIdentity(b.beian, b.name)
  if (!left || !right) return false
  return left.nameKey === right.nameKey && left.share === right.share && left.family !== right.family
}

/**
 * One row per in-pool code and name.
 * Pool product_name catches an email code whose catalog name is a different fund.
 * The catalog display name is what 平台数据 shows.
 */
export function sqlInPoolFundNameKeys(): string {
  const catalogName = sqlPreferAmacOfficialName("i2.product_name", "a2.fund_name")
  return `
    SELECT
      UPPER(BTRIM(clean.code)) AS code,
      ${sqlBeianFamilyKey("clean.code")} AS family_key,
      ${sqlFundNameKey("clean.name")} AS name_key,
      ${sqlShareClassLetter("clean.name")} AS share_class,
      BTRIM(clean.name) AS name
    FROM (
      SELECT
        raw.code,
        ${sqlStripValuationSubjectPathPrefix("raw.name")} AS name
      FROM (
        SELECT p.register_number AS code, p.product_name AS name
        FROM tracking_pool p
        WHERE NULLIF(BTRIM(p.register_number), '') IS NOT NULL
          AND NULLIF(BTRIM(p.product_name), '') IS NOT NULL
        UNION
        SELECT named.code, named.name
        FROM (
          SELECT i2.beian_hao AS code, ${catalogName} AS name
          FROM private_fund_info i2
          JOIN tracking_pool p2
            ON NULLIF(BTRIM(p2.register_number), '') IS NOT NULL
           AND UPPER(BTRIM(p2.register_number)) = UPPER(BTRIM(i2.beian_hao))
          LEFT JOIN amac_private_funds a2 ON a2.fund_no = i2.beian_hao
        ) named
        WHERE NULLIF(BTRIM(named.name), '') IS NOT NULL
      ) raw
    ) clean
    WHERE NULLIF(BTRIM(clean.name), '') IS NOT NULL
  `
}

/** 备案号 of in-pool funds whose name is shared by another filing. */
export function sqlInPoolNameDuplicateCodes(): string {
  return `
    WITH keyed AS MATERIALIZED (
      ${sqlInPoolFundNameKeys()}
    )
    SELECT DISTINCT k.code
    FROM keyed k
    WHERE k.name_key IS NOT NULL
      AND k.family_key IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM keyed o
        WHERE o.name_key = k.name_key
          AND o.share_class = k.share_class
          AND o.family_key IS NOT NULL
          AND o.family_key <> k.family_key
      )
  `
}

/** Other 备案号 that share a duplicated fund name with the given codes. */
export function sqlInPoolNameDuplicatePeers(): string {
  return `
    WITH keyed AS MATERIALIZED (
      ${sqlInPoolFundNameKeys()}
    )
    SELECT
      self.code AS beian_hao,
      sib.code AS peer_code,
      sib.name AS peer_name
    FROM keyed self
    JOIN keyed sib
      ON sib.name_key = self.name_key
     AND sib.share_class = self.share_class
     AND sib.name_key IS NOT NULL
     AND self.family_key IS NOT NULL
     AND sib.family_key IS NOT NULL
     AND sib.family_key <> self.family_key
    WHERE self.code = ANY($1::text[])
      AND self.name_key IS NOT NULL
  `
}
