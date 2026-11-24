export type ProductWeeklyRow = {
  reportId: string
  product_name: string
  beian_hao: string | null
  title: string
  short_name?: string | null
  full_name?: string | null
  weekStart: string
  weekEnd: string
  templateName?: string
  createdAt?: string
}

function fold(value: string): string {
  return value
    .replace(/私募证券投资基金/g, "")
    .replace(/证券投资基金/g, "")
    .replace(/\s+/g, "")
    .toLowerCase()
}

function namesOf(row: ProductWeeklyRow): string[] {
  return [row.product_name, row.title, row.short_name || "", row.full_name || "", row.beian_hao || ""]
    .map((item) => item.trim())
    .filter(Boolean)
}

export function rowMatchesProduct(row: ProductWeeklyRow, query: string): boolean {
  const q = fold(query)
  if (!q) return false
  return namesOf(row).some((name) => fold(name).includes(q))
}

export function pickProductWeeklyReport(
  rows: ProductWeeklyRow[],
  query: string,
  weekEnd?: string,
):
  | { status: "empty" }
  | { status: "ambiguous"; products: string[] }
  | { status: "missing_week"; weeks: string[] }
  | { status: "ok"; row: ProductWeeklyRow; weeks: string[] } {
  const q = query.trim()
  if (!q) return { status: "empty" }
  const hits = rows.filter((row) => rowMatchesProduct(row, q))
  const products = [...new Set(hits.map((row) => row.product_name))]
  if (products.length === 0) return { status: "empty" }
  if (products.length > 1) return { status: "ambiguous", products }
  const mine = hits.filter((row) => row.product_name === products[0])
  const weeks = [...new Set(mine.map((row) => row.weekEnd))].sort()
  const wanted = (weekEnd || "").trim().slice(0, 10)
  const row = wanted
    ? mine.find((item) => item.weekEnd.slice(0, 10) === wanted)
    : [...mine].sort((a, b) => b.weekEnd.localeCompare(a.weekEnd))[0]
  if (!row) return { status: "missing_week", weeks }
  return { status: "ok", row, weeks }
}
