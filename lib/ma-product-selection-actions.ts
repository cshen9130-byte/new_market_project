import type { PortfolioFundPickerItem } from "@/components/ma/portfolio-fund-picker-dialog"
import { createFundCompareFromPicker, saveFundCompare } from "@/lib/ma-fund-compare-storage"

const PORTFOLIO_PREFILL_KEY = "ma_portfolio_create_prefill"

export type SelectableProduct = {
  id: string
  product_name: string
  beian_hao: string | null
  latest_nav_date?: string | null
}

export function toPickerItems(products: SelectableProduct[]): PortfolioFundPickerItem[] {
  return products
    .filter((p) => p.beian_hao)
    .map((p) => ({
      beian_hao: p.beian_hao!,
      product_name: p.product_name,
      manager: null,
      latest_nav_date: p.latest_nav_date ?? null,
      ret_ytd: null,
      ret_ann_since_inception: null,
      inception_date: null,
    }))
}

export function openFundCompareWithProducts(
  products: SelectableProduct[],
  scope: "team" | "mine" = "team",
) {
  const items = toPickerItems(products)
  if (items.length === 0) return
  const compare = createFundCompareFromPicker(items, scope)
  saveFundCompare(compare)
  window.open(
    `/ma/dashboard/private-funds/fund-compare/${encodeURIComponent(compare.id)}`,
    "_blank",
    "noopener,noreferrer",
  )
}

export function openPortfolioWithProducts(products: SelectableProduct[]) {
  const items = toPickerItems(products)
  if (items.length > 0) {
    sessionStorage.setItem(PORTFOLIO_PREFILL_KEY, JSON.stringify(items))
  }
  window.open(
    "/ma/dashboard/private-funds/portfolio/create?build=free",
    "_blank",
    "noopener,noreferrer",
  )
}

export function consumePortfolioPrefill(): PortfolioFundPickerItem[] {
  if (typeof window === "undefined") return []
  try {
    const raw = sessionStorage.getItem(PORTFOLIO_PREFILL_KEY)
    sessionStorage.removeItem(PORTFOLIO_PREFILL_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
