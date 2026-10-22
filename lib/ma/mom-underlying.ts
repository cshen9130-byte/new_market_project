export type MomUnderlyingKind = "compare" | "account"
export type MomUnderlyingLinkSource = "saved" | "static"

export type MomUnderlyingRow = {
  id: string
  kind: MomUnderlyingKind
  link_source: MomUnderlyingLinkSource
  beian_hao: string | null
  product_name: string
  account: string
  account_note: string | null
  note: string | null
  strategy: string | null
  latest_nav: string | null
  latest_nav_date: string | null
  latest_price_change: string | null
  equity: string | null
  equity_date: string | null
  updated_by: string | null
  updated_at: string | null
}

export type MomUnderlyingAccountOption = {
  account: string
  label: string
}
