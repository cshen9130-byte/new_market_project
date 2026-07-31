/**
 * Canonical 备案号 for 在管产品 rows — overrides fuzzy auto-resolution when
 * the business defines a fixed product ↔ code mapping.
 */
import { shareClassFromProductName, stripShareClassSuffix } from "@/lib/server/share-class-product"

export const MANAGED_PRODUCT_BEIAN_OVERRIDES: Readonly<Record<string, string>> = {
  荣熙恒盈2号: "SBAH99",
  抱朴聚融祥和一号: "SSG947",
  衡颐海泰1号: "SBPU97",
  衡颐海宸1号: "SBPC69",
  衡颐承和FOF1号: "SBTX45",
  木莲安澜1号A类: "ATL22A",
  锐耐稳健对冲11号: "SBDF95",
  // Auto-resolution sometimes maps 金舆基石一号 → SXN097 (古曲祥辰5号).
  // Custody emails use SAVW72_金舆基石一号…估值表.
  金舆基石一号: "SAVW72",
  古曲祥辰5号: "SXN097",
  荣熙共赢: "SBNX55",
  // Guotai TA虚拟净值 mails tag the 在管产品 in 【…】; underlying fund is outside the brackets.
  金舆追风1号: "SCJ536",
  // FOF virtual-NAV mails like 金舆守安一号【SBYC86-峰云汇高山一号】… mis-link 守安 → SBYC86.
  // AMAC + custody 估值表: SCN504_金舆守安一号… (legacy mis-map used SBVC25).
  金舆守安一号: "SCN504",
}

/** Known 托管券商 for 在管产品 when registration tables are incomplete. */
export const MANAGED_PRODUCT_CUSTODIAN_OVERRIDES: Readonly<Record<string, string>> = {
  抱朴聚融祥和一号: "招商证券股份有限公司",
  衡颐海宸1号: "光大证券股份有限公司",
  衡颐承和FOF1号: "国泰海通证券股份有限公司",
}

/** Alternate 备案号 stored in legacy tables / custody Excel — map to canonical code. */
const MANAGED_PRODUCT_BEIAN_ALIASES: Readonly<Record<string, string>> = {
  S52247: "SSG947",
  SBP097: "SBPU97",
  SBFC69: "SBPC69",
  SBHX45: "SBTX45",
  SBVC25: "SCN504",
  // Custody 产品净值 Excel uses SBT723; AMAC 备案号 is SET723 (墨雪顺遂二号).
  SBT723: "SET723",
  // Bad parse: share-class letter + year from …桫罗稳鸿…基金2026-07-30 → C2026.
  C2026: "SBDU00",
}

/** Parent managed-product name must not swallow A/B/C share-class variants. */
function managedProductOverrideNameMatches(
  overrideProductName: string,
  identifier: string,
): boolean {
  if (identifier === overrideProductName) return true
  if (overrideProductName.length < 4 || !identifier.includes(overrideProductName)) return false
  return shareClassFromProductName(overrideProductName) === shareClassFromProductName(identifier)
}

export function resolveManagedProductBeian(
  productName: string,
  autoResolved?: string | null,
): string | null {
  const name = (productName ?? "").trim()
  const auto = autoResolved?.trim() || null
  if (!name) {
    if (!auto) return null
    return MANAGED_PRODUCT_BEIAN_ALIASES[auto.toUpperCase()] ?? auto
  }
  const exact = MANAGED_PRODUCT_BEIAN_OVERRIDES[name]
  if (exact) return exact
  for (const [product_name, beian_hao] of Object.entries(MANAGED_PRODUCT_BEIAN_OVERRIDES)) {
    if (managedProductOverrideNameMatches(product_name, name)) return beian_hao
  }
  if (!auto) return null
  return MANAGED_PRODUCT_BEIAN_ALIASES[auto.toUpperCase()] ?? auto
}

/** SQL expression applying {@link MANAGED_PRODUCT_BEIAN_OVERRIDES} on top of auto-resolved beian. */
export function managedProductsResolvedBeianSqlExpr(
  productNameExpr: string,
  autoBeianExpr: string,
): string {
  const escape = (s: string) => s.replace(/'/g, "''")
  const cases = Object.entries(MANAGED_PRODUCT_BEIAN_OVERRIDES)
    .map(
      ([name, code]) =>
        `WHEN TRIM(${productNameExpr}) = '${escape(name)}' THEN '${escape(code)}'`,
    )
    .join("\n      ")
  const aliasCases = Object.entries(MANAGED_PRODUCT_BEIAN_ALIASES)
    .map(
      ([alias, code]) =>
        `WHEN UPPER(BTRIM(${autoBeianExpr})) = '${escape(alias)}' THEN '${escape(code)}'`,
    )
    .join("\n      ")
  return `CASE
      ${cases}
      ${aliasCases}
      ELSE NULLIF(BTRIM(${autoBeianExpr}), '')
    END`
}

/** Map known wrong share-class codes back to the canonical 在管产品 beian. */
export function remapManagedProductBeianCode(code: string): string | null {
  const normalized = (code ?? "").trim().toUpperCase()
  if (!normalized) return null
  for (const canonical of Object.values(MANAGED_PRODUCT_BEIAN_OVERRIDES)) {
    if (normalized === canonical.toUpperCase()) return canonical
  }
  const aliased = MANAGED_PRODUCT_BEIAN_ALIASES[normalized]
  if (aliased) return aliased
  return null
}

/** Custody / legacy codes that should resolve to this canonical 备案号. */
export function alternateBeianCodesFor(canonical: string): string[] {
  const target = (canonical ?? "").trim().toUpperCase()
  if (!target) return []
  return Object.entries(MANAGED_PRODUCT_BEIAN_ALIASES)
    .filter(([, code]) => code.toUpperCase() === target)
    .map(([alias]) => alias)
}

export function lookupManagedProductOverride(
  identifier: string,
): { product_name: string; beian_hao: string } | null {
  const id = (identifier ?? "").trim()
  if (!id) return null
  const upper = id.toUpperCase()
  for (const [product_name, beian_hao] of Object.entries(MANAGED_PRODUCT_BEIAN_OVERRIDES)) {
    if (
      id === product_name
      || upper === beian_hao.toUpperCase()
      || managedProductOverrideNameMatches(product_name, id)
    ) {
      return { product_name, beian_hao }
    }
  }
  const remapped = remapManagedProductBeianCode(id)
  if (remapped) {
    for (const [product_name, beian_hao] of Object.entries(MANAGED_PRODUCT_BEIAN_OVERRIDES)) {
      if (beian_hao === remapped) return { product_name, beian_hao }
    }
  }
  return null
}

/**
 * Looser managed-product name hit used to reject TA-virtual investor labels
 * (e.g. "荣熙共赢A类") that fail the strict share-class guard.
 */
export function resolveManagedProductBeianIgnoringShareClass(
  productName: string | null | undefined,
): string | null {
  const name = (productName ?? "").trim()
  if (!name) return null
  const strict = resolveManagedProductBeian(name)
  if (strict) return strict

  const stripped = stripShareClassSuffix(
    name
      .replace(/(私募证券投资基金|私募基金|证券投资基金|投资基金)$/u, "")
      .trim(),
  )
  if (!stripped) return null
  const exact = MANAGED_PRODUCT_BEIAN_OVERRIDES[stripped]
  if (exact) return exact
  for (const [product_name, beian_hao] of Object.entries(MANAGED_PRODUCT_BEIAN_OVERRIDES)) {
    if (stripped === product_name || stripped.startsWith(product_name)) return beian_hao
  }
  return null
}

export function lookupManagedProductCustodian(
  productName: string | null | undefined,
  beianHao?: string | null,
): string | null {
  const managed = beianHao ? lookupManagedProductOverride(beianHao) : null
  if (managed?.product_name) {
    const byCode = MANAGED_PRODUCT_CUSTODIAN_OVERRIDES[managed.product_name]
    if (byCode) return byCode
  }

  const name = (productName ?? managed?.product_name ?? "").trim()
  if (!name) return null
  const exact = MANAGED_PRODUCT_CUSTODIAN_OVERRIDES[name]
  if (exact) return exact
  for (const [product, custodian] of Object.entries(MANAGED_PRODUCT_CUSTODIAN_OVERRIDES)) {
    if (product.length >= 4 && name.includes(product)) return custodian
  }
  return null
}
