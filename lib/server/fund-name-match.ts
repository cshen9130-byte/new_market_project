/**
 * SQL helpers for matching fund display names across tables with different formats
 * (e.g. 木莲安澜1号A类 vs 木莲安澜1号私募证券投资基金A类).
 */

/** Strip common fund suffixes and share-class suffix for fuzzy comparison. */
export function sqlFundNameBase(nameExpr: string): string {
  return `NULLIF(regexp_replace(
    regexp_replace(
      regexp_replace(BTRIM(${nameExpr}), '[ABC]类$', ''),
      '(私募证券投资基金|私募基金|证券投资基金|投资基金)$', ''
    ),
    '\\s+$', ''
  ), '')`
}

/** Trailing serial token in normalized base, e.g. 三号 / 1号 / CTA1号. */
export function sqlFundSerialSuffix(nameExpr: string): string {
  return `substring(${sqlFundNameBase(nameExpr)} from '[一二三四五六七八九十百千0-9]+号$')`
}

/** Reject matches when serial suffixes differ (e.g. 棕榈滩泰来 vs 棕榈滩泰来三号). */
export function sqlFundSerialMatchGuard(columnExpr: string, targetExpr: string): string {
  const colSerial = sqlFundSerialSuffix(columnExpr)
  const tgtSerial = sqlFundSerialSuffix(targetExpr)
  return `COALESCE(${colSerial}, '') = COALESCE(${tgtSerial}, '')`
}

/** True when two fund name columns refer to the same product (flexible match). */
export function sqlFundNameMatch(columnExpr: string, targetExpr: string): string {
  const col = `BTRIM(${columnExpr})`
  const tgt = `BTRIM(${targetExpr})`
  const colBase = sqlFundNameBase(columnExpr)
  const tgtBase = sqlFundNameBase(targetExpr)
  const serialGuard = sqlFundSerialMatchGuard(columnExpr, targetExpr)
  return `(
    ${col} <> '' AND ${tgt} <> '' AND (
      ${col} = ${tgt}
      OR (${col} ILIKE ${tgt} || '%' AND ${serialGuard})
      OR (${tgt} ILIKE ${col} || '%' AND ${serialGuard})
      OR (${colBase} IS NOT NULL AND ${tgtBase} IS NOT NULL AND (
        ${colBase} = ${tgtBase}
        OR (${colBase} ILIKE ${tgtBase} || '%' AND ${serialGuard})
        OR (${tgtBase} ILIKE ${colBase} || '%' AND ${serialGuard})
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

/** When target has no share class, reject A/B/C share-class product names. */
export function sqlShareClassProductNameGuard(columnExpr: string, targetExpr: string): string {
  return `(
    CASE
      WHEN ${targetExpr} ILIKE '%A类%' THEN ${columnExpr} ILIKE '%A类%'
      WHEN ${targetExpr} ILIKE '%B类%' THEN ${columnExpr} ILIKE '%B类%'
      WHEN ${targetExpr} ILIKE '%C类%' THEN ${columnExpr} ILIKE '%C类%'
      ELSE (
        ${columnExpr} NOT ILIKE '%A类%'
        AND ${columnExpr} NOT ILIKE '%B类%'
        AND ${columnExpr} NOT ILIKE '%C类%'
      )
    END
  )`
}

/** Require product code suffix to match share class in the target fund name (A/B/C). */
export function sqlShareClassCodeGuard(codeCol: string, productNameExpr: string): string {
  return `(
    CASE
      WHEN ${productNameExpr} ILIKE '%A类%' THEN TRIM(UPPER(${codeCol})) ~ 'A$'
      WHEN ${productNameExpr} ILIKE '%B类%' THEN TRIM(UPPER(${codeCol})) ~ 'B$'
      WHEN ${productNameExpr} ILIKE '%C类%' THEN TRIM(UPPER(${codeCol})) ~ 'C$'
      ELSE NOT (TRIM(UPPER(${codeCol})) ~ '[ABC]$')
    END
  )`
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
      ELSE (
        COALESCE(${fundNameCol}, '') NOT ILIKE '%A类%'
        AND COALESCE(${fundNameCol}, '') NOT ILIKE '%B类%'
        AND COALESCE(${fundNameCol}, '') NOT ILIKE '%C类%'
        AND NOT (COALESCE(${productCodeCol}, '') ~ '[ABC]$')
      )
    END
  )`
}
