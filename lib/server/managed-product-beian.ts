/**
 * Canonical 备案号 for 在管产品 rows — overrides fuzzy auto-resolution when
 * the business defines a fixed product ↔ code mapping.
 */
export const MANAGED_PRODUCT_BEIAN_OVERRIDES: Readonly<Record<string, string>> = {
  荣熙恒盈2号: "SBAH99",
  抱朴聚融祥和一号: "SSG947",
  衡颐海泰1号: "SBPU97",
}

/** Alternate 备案号 stored in legacy tables — map to canonical override code. */
const MANAGED_PRODUCT_BEIAN_ALIASES: Readonly<Record<string, string>> = {
  S52247: "SSG947",
  SBP097: "SBPU97",
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
    if (product_name.length >= 4 && name.includes(product_name)) return beian_hao
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
  if (normalized === "SBAH99A" || normalized === "BAH99A") {
    return MANAGED_PRODUCT_BEIAN_OVERRIDES["荣熙恒盈2号"] ?? null
  }
  const aliased = MANAGED_PRODUCT_BEIAN_ALIASES[normalized]
  if (aliased) return aliased
  return null
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
      || (product_name.length >= 4 && id.includes(product_name))
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
