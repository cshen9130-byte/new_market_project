/** Known private-fund ↔ MOM settlement account links (same advisor / strategy book). */
export type FundMomAccountLink = {
  account: string
  note?: string
}

const LINKS_BY_BEIAN: Record<string, FundMomAccountLink[]> = {
  SXM695: [{ account: "rx348", note: "与产品管理人同一投顾" }],
}

const LINKS_BY_PRODUCT_NAME: Array<{ match: string; links: FundMomAccountLink[] }> = [
  { match: "淳德行稳致远", links: LINKS_BY_BEIAN.SXM695 },
]

export function resolveLinkedMomAccounts(
  beianHao: string,
  productName?: string | null,
): FundMomAccountLink[] {
  const code = beianHao.trim().toUpperCase()
  if (code && LINKS_BY_BEIAN[code]) return LINKS_BY_BEIAN[code]
  const name = (productName ?? "").trim()
  if (name) {
    const hit = LINKS_BY_PRODUCT_NAME.find((row) => name.includes(row.match))
    if (hit) return hit.links
  }
  return []
}

export function defaultMomAccount(
  beianHao: string,
  productName?: string | null,
): string | null {
  return resolveLinkedMomAccounts(beianHao, productName)[0]?.account ?? null
}
