/**
 * Canonical 备案号 for 在管产品 rows — overrides fuzzy auto-resolution when
 * the business defines a fixed product ↔ code mapping.
 */
export const MANAGED_PRODUCT_BEIAN_OVERRIDES: Readonly<Record<string, string>> = {
  荣熙恒盈2号: "SBAH99",
}

export function resolveManagedProductBeian(
  productName: string,
  autoResolved?: string | null,
): string | null {
  const name = (productName ?? "").trim()
  if (!name) return autoResolved?.trim() || null
  const override = MANAGED_PRODUCT_BEIAN_OVERRIDES[name]
  if (override) return override
  return autoResolved?.trim() || null
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
  return null
}

export function lookupManagedProductOverride(
  identifier: string,
): { product_name: string; beian_hao: string } | null {
  const id = (identifier ?? "").trim()
  if (!id) return null
  const upper = id.toUpperCase()
  for (const [product_name, beian_hao] of Object.entries(MANAGED_PRODUCT_BEIAN_OVERRIDES)) {
    if (id === product_name || upper === beian_hao.toUpperCase()) {
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
