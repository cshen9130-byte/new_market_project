/**
 * SQL helpers for matching fund display names across tables with different formats
 * (e.g. 木莲安澜1号A类 vs 木莲安澜1号私募证券投资基金A类).
 */

import { stripValuationSubjectPathPrefix } from "@/lib/valuation-holding-display-name"

/**
 * Drop 估值表 subject-path prefixes so matching uses the real fund name.
 * 场外_已上市_开放式_私募_成本.交睿宏观配置1号… → 交睿宏观配置1号…
 */
export function sqlStripValuationSubjectPathPrefix(nameExpr: string): string {
  return `COALESCE(NULLIF(BTRIM(
    CASE
      WHEN ${nameExpr} LIKE '场外%' AND STRPOS(${nameExpr}, '.') > 0
        THEN SUBSTRING(${nameExpr} FROM '([^.]+)$')
      WHEN ${nameExpr} LIKE '场外%'
        THEN REGEXP_REPLACE(${nameExpr}, '^场外[_/[:space:].]+', '')
      ELSE ${nameExpr}
    END
  ), ''), ${nameExpr})`
}

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
  const colExpr = sqlStripValuationSubjectPathPrefix(columnExpr)
  const tgtExpr = sqlStripValuationSubjectPathPrefix(targetExpr)
  const col = `BTRIM(${colExpr})`
  const tgt = `BTRIM(${tgtExpr})`
  const colBase = sqlFundNameBase(colExpr)
  const tgtBase = sqlFundNameBase(tgtExpr)
  const serialGuard = sqlFundSerialMatchGuard(colExpr, tgtExpr)
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
  const col = `BTRIM(${sqlStripValuationSubjectPathPrefix(columnExpr)})`
  const tgt = `BTRIM(${sqlStripValuationSubjectPathPrefix(targetExpr)})`
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

/**
 * Citics 基金净值 workbook codes: `SX4966(总)` / `SX4966(A类)` / `SX4966（B）`.
 * Parent `(总)` → base code; share-class parens → trailing A/B/C.
 */
export function canonicalizeEmailProductCode(code: string): string {
  const raw = String(code ?? "").trim().toUpperCase()
  if (!raw) return ""
  // CSC 资产净值公告 workbooks tag the parent series: SAHZ51_总层面
  const withoutLayer = raw.replace(/[_\-\s]*(总层面|总级)$/u, "")
  const paren = withoutLayer.match(/^([A-Z0-9]+)[\(（](总|[ABC]类?)[\)）]$/u)
  if (!paren) return withoutLayer
  const base = paren[1]
  const tag = paren[2]
  if (tag === "总") return base
  const letter = tag.charAt(0)
  // `BLF14C(C类)` must stay BLF14C, not BLF14CC.
  return base.endsWith(letter) ? base : `${base}${letter}`
}

/** Strip trailing A/B/C share-class suffix from a product / beian code. */
export function stripShareClassFromProductCode(code: string): string {
  return canonicalizeEmailProductCode(code).replace(/[ABC]$/u, "")
}

/** True when email product_code matches beian, including parent codes without share-class suffix. */
export function shareClassProductCodesMatch(emailCode: string, beian: string): boolean {
  const ec = stripShareClassFromProductCode(emailCode)
  const bc = stripShareClassFromProductCode(beian)
  if (!ec || !bc) {
    return String(emailCode ?? "").trim().toUpperCase() === String(beian ?? "").trim().toUpperCase()
  }
  if (ec === bc) return true
  if (`S${ec}` === bc || ec === `S${bc}`) return true
  return false
}

/** SQL: email product_code equals beian base code (parent code without A/B/C suffix). */
export function sqlShareClassParentCodeMatch(codeCol: string, beianCol: string): string {
  return `regexp_replace(UPPER(BTRIM(${beianCol})), '[ABC]$', '') = UPPER(BTRIM(${codeCol}))`
}

/** Email row is not explicitly tagged as a different share class (B/C when target is A, etc.). */
function sqlEmailNavUnclassifiedShareClassGuard(fundNameCol: string, productCodeCol: string): string {
  return `(
    COALESCE(${productCodeCol}, '') !~ '[ABC]$'
    AND COALESCE(${fundNameCol}, '') NOT ILIKE '%A类%'
    AND COALESCE(${fundNameCol}, '') NOT ILIKE '%B类%'
    AND COALESCE(${fundNameCol}, '') NOT ILIKE '%C类%'
  )`
}

/** JS: share class in display names must agree (A/B/C class is a distinct product). */
export function shareClassProductNamesMatch(columnName: string, targetName: string): boolean {
  const col = String(columnName ?? "").trim()
  const tgt = String(targetName ?? "").trim()
  const hasClass = (s: string, letter: string) => s.includes(`${letter}类`)
  if (hasClass(tgt, "A")) return hasClass(col, "A")
  if (hasClass(tgt, "B")) return hasClass(col, "B")
  if (hasClass(tgt, "C")) return hasClass(col, "C")
  return !hasClass(col, "A") && !hasClass(col, "B") && !hasClass(col, "C")
}

/** JS equivalent of sqlShareClassCodeGuard. Empty code is treated as neutral. */
export function shareClassCodeMatchesProduct(code: string, productName: string): boolean {
  const c = String(code ?? "").trim().toUpperCase()
  const name = String(productName ?? "").trim()
  if (!c) return true
  if (name.includes("A类")) return /A$/.test(c)
  if (name.includes("B类")) return /B$/.test(c)
  if (name.includes("C类")) return /C$/.test(c)
  return !/[ABC]$/.test(c)
}

/** Allow parent codes without A/B/C suffix when subject name already confirms share class. */
export function shareClassCodeMatchesProductLenient(
  code: string,
  subjectName: string,
  productName: string,
): boolean {
  if (shareClassCodeMatchesProduct(code, productName)) return true
  const c = String(code ?? "").trim().toUpperCase()
  if (!c) return true
  if (shareClassProductNamesMatch(subjectName, productName) && !/[ABC]$/.test(c)) return true
  return false
}

/** Prefer the row whose 备案号 suffix matches A/B/C class in the display name. */
export function shareClassDisplayAlignmentScore(
  beianHao: string | null | undefined,
  productName: string,
): number {
  if (!beianHao?.trim()) return 0
  return shareClassCodeMatchesProduct(beianHao, productName) ? 2 : 1
}

/** Collapse duplicate display names (e.g. SASX73 parent mislabeled as A类 vs ASX73A). */
export function dedupeShareClassDisplayFunds<
  T extends { beian_hao: string | null; product_name: string },
>(rows: T[]): T[] {
  const byName = new Map<string, T>()
  const noName: T[] = []
  for (const row of rows) {
    const key = row.product_name.trim().toLowerCase()
    if (!key) {
      noName.push(row)
      continue
    }
    const prev = byName.get(key)
    if (!prev) {
      byName.set(key, row)
      continue
    }
    if (
      shareClassDisplayAlignmentScore(row.beian_hao, row.product_name)
      > shareClassDisplayAlignmentScore(prev.beian_hao, prev.product_name)
    ) {
      byName.set(key, row)
    }
  }
  return [...byName.values(), ...noName]
}

/** SQL ORDER BY prefix: prefer beian whose suffix matches share class in product_name. */
export const SQL_SHARE_CLASS_DISPLAY_DEDUPE_ORDER = `
  CASE
    WHEN product_name ILIKE '%A类%' AND UPPER(register_number) ~ 'A$' THEN 0
    WHEN product_name ILIKE '%B类%' AND UPPER(register_number) ~ 'B$' THEN 0
    WHEN product_name ILIKE '%C类%' AND UPPER(register_number) ~ 'C$' THEN 0
    ELSE 1
  END,
  register_number`

/** SQL: code suffix guard for valuation holdings when name may carry share class. */
export function sqlShareClassHoldingCodeGuard(
  codeCol: string,
  nameCol: string,
  productNameExpr: string,
): string {
  const codePresent = `NULLIF(BTRIM(${codeCol}), '') IS NOT NULL`
  const strict = sqlShareClassCodeGuard(codeCol, productNameExpr)
  const parentOk = `(
    ${sqlShareClassProductNameGuard(nameCol, productNameExpr)}
    AND NOT (TRIM(UPPER(${codeCol})) ~ '[ABC]$')
  )`
  return `(NOT ${codePresent} OR ${strict} OR ${parentOk})`
}

function jsFundNameBase(name: string): string {
  return name
    .replace(/(私募证券投资基金|私募基金|证券投资基金|投资基金)$/u, "")
    .replace(/[ABC]类$/u, "")
    .trim()
}

function jsFundSerialSuffix(name: string): string {
  const m = jsFundNameBase(name).match(/[一二三四五六七八九十百千0-9]+号$/u)
  return m?.[0] ?? ""
}

function jsFundSerialMatch(a: string, b: string): boolean {
  return jsFundSerialSuffix(a) === jsFundSerialSuffix(b)
}

/**
 * Short workbook nicknames (`添运1号`) vs full legal names
 * (`众量资产添运1号证券投资私募基金`). Serial suffix must agree so 添运1号
 * does not collide with 添运10号 / 添运进取1号.
 */
export function fundNicknameMatchesFullName(nickname: string, fullName: string): boolean {
  const nick = String(nickname ?? "").trim()
  const full = String(fullName ?? "").trim()
  if (!nick || !full) return false
  if (!shareClassProductNamesMatch(nick, full)) return false
  if (fundDisplayNamesMatch(nick, full)) return true

  const strip = (name: string) =>
    name
      .replace(/(私募证券投资基金|证券投资私募基金|私募基金|证券投资基金|投资基金)$/u, "")
      .replace(/[ABC]类$/u, "")
      .replace(/证券投资$/u, "")
      .trim()
  const nb = strip(nick)
  const fb = strip(full)
  if (!nb || nb.length < 3 || !fb) return false
  const nickSerial = nb.match(/[一二三四五六七八九十百千0-9]+号$/u)?.[0] ?? ""
  const fullSerial = fb.match(/[一二三四五六七八九十百千0-9]+号$/u)?.[0] ?? ""
  if (nickSerial !== fullSerial) return false
  return full.includes(nick) || fb.includes(nb) || fb.endsWith(nb) || nb.endsWith(fb)
}

/** JS equivalent of sqlFundNameMatch with strict A/B/C share-class guard. */
export function fundDisplayNamesMatch(columnName: string, targetName: string): boolean {
  const aRaw = String(columnName ?? "").trim()
  const bRaw = String(targetName ?? "").trim()
  const a = stripValuationSubjectPathPrefix(aRaw) || aRaw
  const b = stripValuationSubjectPathPrefix(bRaw) || bRaw
  if (!a || !b) return false
  if (!shareClassProductNamesMatch(a, b)) return false

  const na = jsFundNameBase(a)
  const nb = jsFundNameBase(b)
  const serialOk = jsFundSerialMatch(a, b)

  return (
    a === b
    || (serialOk && (a.startsWith(b) || b.startsWith(a)))
    || (serialOk && na === nb)
    || (serialOk && (a.startsWith(nb) || b.startsWith(na)))
  )
}

/** Share-class guard for email NAV rows when resolving beian from fund_name. */
export function sqlEmailNavShareClassGuard(fundNameCol: string, productNameExpr: string, productCodeCol: string): string {
  const unclassified = sqlEmailNavUnclassifiedShareClassGuard(fundNameCol, productCodeCol)
  return `(
    CASE
      WHEN ${productNameExpr} ILIKE '%A类%'
        THEN COALESCE(${fundNameCol}, '') ILIKE '%A类%'
          OR COALESCE(${productCodeCol}, '') ~ 'A$'
          OR ${unclassified}
      WHEN ${productNameExpr} ILIKE '%B类%'
        THEN COALESCE(${fundNameCol}, '') ILIKE '%B类%'
          OR COALESCE(${productCodeCol}, '') ~ 'B$'
          OR ${unclassified}
      WHEN ${productNameExpr} ILIKE '%C类%'
        THEN COALESCE(${fundNameCol}, '') ILIKE '%C类%'
          OR COALESCE(${productCodeCol}, '') ~ 'C$'
          OR ${unclassified}
      ELSE (
        COALESCE(${fundNameCol}, '') NOT ILIKE '%A类%'
        AND COALESCE(${fundNameCol}, '') NOT ILIKE '%B类%'
        AND COALESCE(${fundNameCol}, '') NOT ILIKE '%C类%'
        AND NOT (COALESCE(${productCodeCol}, '') ~ '[ABC]$')
      )
    END
  )`
}
