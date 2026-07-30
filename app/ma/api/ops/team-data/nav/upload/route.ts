import { NextResponse } from "next/server"
import { refreshManagedProductsListCache } from "@/lib/server/managed-products-list-cache-pg"
import { uploadTeamNavRows } from "@/lib/server/team-nav-manage-pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "bad_request" }, { status: 400 })
    }

    const { beian_hao, nav_type, rows } = body as {
      beian_hao?: string
      nav_type?: string
      rows?: Array<{ nav_date?: string; unit_nav?: string; cumulative_nav?: string }>
    }

    const result = await uploadTeamNavRows({
      beian_hao: beian_hao ?? "",
      nav_type: nav_type === "virtual" ? "virtual" : "pre_fee",
      rows: Array.isArray(rows)
        ? rows.map((row) => ({
            nav_date: row.nav_date ?? "",
            unit_nav: row.unit_nav ?? "",
            cumulative_nav: row.cumulative_nav,
          }))
        : [],
    })

    if ("error" in result) {
      if (result.error === "missing_fields") {
        return NextResponse.json({ error: "missing_fields" }, { status: 400 })
      }
      return NextResponse.json({ error: "invalid_rows" }, { status: 400 })
    }

    const beian = (beian_hao ?? "").trim().toUpperCase()
    void (async () => {
      try {
        const { query } = await import("@/lib/db")
        const { invalidateDetailNavCache, refreshDetailNavCacheForFund } = await import(
          "@/lib/server/fund-detail-nav-cache-pg"
        )
        if (beian) {
          await invalidateDetailNavCache([beian])
          const nameRows = await query<{ product_name: string; short_name: string | null }>(
            `SELECT product_name, short_name
             FROM ops_managed_products_list_cache
             WHERE UPPER(BTRIM(beian_hao)) = $1
             LIMIT 1`,
            [beian],
          ).catch(() => [] as { product_name: string; short_name: string | null }[])
          let productName = nameRows[0]?.product_name || beian
          let shortName = nameRows[0]?.short_name ?? null
          if (!nameRows[0]) {
            const fofRows = await query<{ product_name: string; short_name: string | null }>(
              `SELECT product_name, short_name
               FROM ops_fof_overview_list_cache
               WHERE UPPER(BTRIM(beian_hao)) = $1
               LIMIT 1`,
              [beian],
            ).catch(() => [] as { product_name: string; short_name: string | null }[])
            productName = fofRows[0]?.product_name || productName
            shortName = fofRows[0]?.short_name ?? shortName
          }
          await refreshDetailNavCacheForFund({
            beian_hao: beian,
            product_name: productName,
            short_name: shortName,
            nav_data_source: "team",
          })
        }
      } catch (err) {
        console.error("[team-data/nav/upload] detail NAV cache refresh failed:", err)
      }
      try {
        await refreshManagedProductsListCache()
      } catch (err) {
        console.error("[team-data/nav/upload] cache refresh failed:", err)
      }
    })()

    return NextResponse.json({ ok: true, count: result.count })
  } catch (err) {
    console.error("[team-data/nav/upload]", err)
    return NextResponse.json({ error: "Failed to upload team nav rows" }, { status: 500 })
  }
}
