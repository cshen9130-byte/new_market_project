/**
 * SQL helpers for matching fund display names across tables with different formats
 * (e.g. 木莲安澜1号A类 vs 木莲安澜1号私募证券投资基金A类).
 */

/** Strip common fund suffixes and share-class suffix for fuzzy comparison. */
export function sqlFundNameBase(nameExpr: string): string {
  return `NULLIF(regexp_replace(
    regexp_replace(
      regexp_replace(BTRIM(${nameExpr}), '(私募证券投资基金|私募基金|证券投资基金|投资基金)$', ''),
      '[ABC]类$', ''
    ),
    '\\s+$', ''
  ), '')`
}

/** True when two fund name columns refer to the same product (flexible match). */
export function sqlFundNameMatch(columnExpr: string, targetExpr: string): string {
  const col = `BTRIM(${columnExpr})`
  const tgt = `BTRIM(${targetExpr})`
  const colBase = sqlFundNameBase(columnExpr)
  const tgtBase = sqlFundNameBase(targetExpr)
  return `(
    ${col} <> '' AND ${tgt} <> '' AND (
      ${col} = ${tgt}
      OR ${col} ILIKE ${tgt} || '%'
      OR ${tgt} ILIKE ${col} || '%'
      OR (${colBase} IS NOT NULL AND ${tgtBase} IS NOT NULL AND (
        ${colBase} = ${tgtBase}
        OR ${colBase} ILIKE ${tgtBase} || '%'
        OR ${tgtBase} ILIKE ${colBase} || '%'
      ))
    )
  )`
}

/** ORDER BY fragment: prefer exact / prefix matches over fuzzy base matches. */
export function sqlFundNameMatchPriority(columnExpr: string, targetExpr: string): string {
  const col = `BTRIM(${columnExpr})`
  const tgt = `BTRIM(${targetExpr})`
  return `CASE
    WHEN ${col} = ${tgt} THEN 0
    WHEN ${col} ILIKE ${tgt} || '%' THEN 1
    WHEN ${tgt} ILIKE ${col} || '%' THEN 2
    ELSE 3
  END`
}

/** Share-class guard for email NAV rows when resolving beian from fund_name. */
export function sqlEmailNavShareClassGuard(fundNameCol: string, productNameExpr: string, productCodeCol: string): string {
  return `(
    CASE
      WHEN ${productNameExpr} ILIKE '%A类%'
        THEN COALESCE(${fundNameCol}, '') ILIKE '%A类%'
          OR COALESCE(${productCodeCol}, '') ~ 'A$'
      WHEN ${productNameExpr} ILIKE '%B类%'
        THEN COALESCE(${fundNameCol}, '') ILIKE '%B类%'
          OR COALESCE(${productCodeCol}, '') ~ 'B$'
      WHEN ${productNameExpr} ILIKE '%C类%'
        THEN COALESCE(${fundNameCol}, '') ILIKE '%C类%'
          OR COALESCE(${productCodeCol}, '') ~ 'C$'
      ELSE true
    END
  )`
}
