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

const KIND_LABEL: Record<MomUnderlyingKind, string> = {
  compare: "对比账户",
  account: "单账户",
}

export type MomUnderlyingApiRow = {
  product_name: string
  reg_code: string | null
  kind: MomUnderlyingKind
  kind_label: string
  account: string
  account_note: string | null
  strategy: string | null
  latest_nav: number | null
  latest_nav_date: string | null
  price_change_pct: number | null
  equity: number | null
  equity_date: string | null
  link_source: MomUnderlyingLinkSource
}

function numOrNull(value: string | null, digits: number): number | null {
  if (value == null || value === "") return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const scale = 10 ** digits
  return Math.round(n * scale) / scale
}

/** Same columns as 投资分析 → MOM底层. price_change_pct is percentage points. */
export function shapeMomUnderlyingTable(
  rows: MomUnderlyingRow[],
  options: { q?: string; kind?: MomUnderlyingKind | "all" } = {},
): {
  total: number
  compare_count: number
  account_count: number
  rows: MomUnderlyingApiRow[]
} {
  const kind = options.kind ?? "all"
  const q = (options.q ?? "").trim().toLowerCase()
  const filtered = rows.filter((row) => {
    if (kind !== "all" && row.kind !== kind) return false
    if (!q) return true
    return [row.product_name, row.beian_hao, row.account, row.account_note, row.strategy]
      .some((value) => String(value ?? "").toLowerCase().includes(q))
  })
  return {
    total: filtered.length,
    compare_count: rows.filter((row) => row.kind === "compare").length,
    account_count: rows.filter((row) => row.kind === "account").length,
    rows: filtered.map((row) => {
      const change = numOrNull(row.latest_price_change, 6)
      return {
        product_name: row.product_name,
        reg_code: row.beian_hao,
        kind: row.kind,
        kind_label: KIND_LABEL[row.kind],
        account: row.account,
        account_note: row.account_note,
        strategy: row.strategy,
        latest_nav: numOrNull(row.latest_nav, 4),
        latest_nav_date: row.latest_nav_date,
        price_change_pct: change == null ? null : Math.round(change * 10000) / 100,
        equity: numOrNull(row.equity, 2),
        equity_date: row.equity_date,
        link_source: row.link_source,
      }
    }),
  }
}
