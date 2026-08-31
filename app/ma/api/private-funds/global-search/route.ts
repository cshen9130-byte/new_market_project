import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { searchPrivateFundProductsForFastPicker } from "@/lib/server/private-fund-product-search"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export type GlobalSearchProduct = {
  beian_hao: string
  product_name: string
  short_name: string | null
  strategy_one: string | null
}

export type GlobalSearchManager = {
  registration_no: string
  manager_name: string
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

  try {
    const [products, managers] = await Promise.all([
      searchPrivateFundProductsForFastPicker(q, 8).catch((err) => {
        console.error("[private-funds/global-search] products", err)
        return [] as GlobalSearchProduct[]
      }),
      searchManagers(q, 8),
    ])
    return NextResponse.json({ products, managers })
  } catch (err) {
    console.error("[private-funds/global-search]", err)
    return NextResponse.json({ error: "db_error" }, { status: 500 })
  }
}
