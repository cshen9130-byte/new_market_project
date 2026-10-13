import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { lookupBeianCodesWithNav } from "@/lib/server/fund-nav-presence"
import { searchPrivateFundProductsForFastPicker } from "@/lib/server/private-fund-product-search"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export type GlobalSearchProduct = {
  beian_hao: string
  product_name: string
  short_name: string | null
  strategy_one: string | null
  /** null when the NAV lookup failed and the client should hide the label. */
  has_nav: boolean | null
}

export type GlobalSearchManager = {
  registration_no: string
  manager_name: string
}

/** 有净值 first, then 无净值. A failed lookup stays after both so it is not treated as 无净值. */
function navPresenceRank(hasNav: boolean | null): number {
  if (hasNav === true) return 0
  if (hasNav === false) return 1
  return 2
}

async function searchManagers(q: string, limit = 8): Promise<GlobalSearchManager[]> {
  const like = `%${q}%`
  const prefix = `${q}%`
  try {
    return await query<GlobalSearchManager>(
      `SELECT registration_no, manager_name
       FROM (
         SELECT registration_no, manager_name
         FROM amac_managers
         WHERE TRIM(COALESCE(manager_name, '')) <> ''
           AND (manager_name ILIKE $1 OR registration_no ILIKE $1)
         UNION
         SELECT registration_no, manager_name
         FROM private_fund_managers_list
         WHERE TRIM(COALESCE(manager_name, '')) <> ''
           AND TRIM(COALESCE(registration_no, '')) <> ''
           AND (manager_name ILIKE $1 OR registration_no ILIKE $1)
       ) t
       ORDER BY
         CASE
           WHEN registration_no ILIKE $2 THEN 0
           WHEN manager_name ILIKE $2 THEN 1
           ELSE 2
         END,
         LENGTH(manager_name) ASC
       LIMIT $3`,
      [like, prefix, limit],
    )
  } catch (err) {
    console.error("[private-funds/global-search] managers", err)
    return []
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get("q") || "").trim()
  if (!q) {
    return NextResponse.json({ products: [], managers: [] })
  }

  const parsedLimit = Number.parseInt(searchParams.get("limit") || "8", 10)
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 40) : 8
  // Name search is capped at 40. Rank that pool by 有无净值, then keep the requested page size
  // so 有净值 products are not dropped just because a 无净值 name ranked higher.
  const productPool = 40

  try {
    const [products, managers] = await Promise.all([
      searchPrivateFundProductsForFastPicker(q, productPool).catch((err) => {
        console.error("[private-funds/global-search] products", err)
        return [] as Omit<GlobalSearchProduct, "has_nav">[]
      }),
      searchManagers(q, limit),
    ])
    const present = await lookupBeianCodesWithNav(products.map((row) => row.beian_hao))
    const annotated: GlobalSearchProduct[] = products.map((row) => ({
      ...row,
      has_nav: present ? present.has(row.beian_hao.trim().toUpperCase()) : null,
    }))
    annotated.sort((a, b) => navPresenceRank(a.has_nav) - navPresenceRank(b.has_nav))
    return NextResponse.json({ products: annotated.slice(0, limit), managers })
  } catch (err) {
    console.error("[private-funds/global-search]", err)
    return NextResponse.json({ error: "db_error" }, { status: 500 })
  }
}
