import { NextResponse } from "next/server"
import { invalidateListResponseCache } from "@/lib/server/list-response-cache"
import { refreshManagedProductsListCache } from "@/lib/server/managed-products-list-cache-pg"
import { invalidateTeamDataListCaches } from "@/lib/server/team-data-query-pg"
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

    const { beian_hao, nav_type, rows, product_name: bodyProductName } = body as {
      beian_hao?: string
      nav_type?: string
      product_name?: string
      rows?: Array<{
        nav_date?: string
        unit_nav?: string
        cumulative_nav?: string
        adjusted_nav?: string
      }>
    }

    const result = await uploadTeamNavRows({
      beian_hao: beian_hao ?? "",
      nav_type: nav_type === "virtual" ? "virtual" : "pre_fee",
      rows: Array.isArray(rows)
        ? rows.map((row) => ({
            nav_date: row.nav_date ?? "",
            unit_nav: row.unit_nav ?? "",
            cumulative_nav: row.cumulative_nav,
            adjusted_nav: row.adjusted_nav,
          }))
        : [],
    })

    if ("error" in result) {
      if (result.error === "missing_fields") {
        return NextResponse.json({ error: "missing_fields" }, { status: 400 })
      }
      return NextResponse.json({ error: "invalid_rows" }, { status: 400 })
    }

    // Bust tracking + 团队数据 list caches so the next fetch overlays fresh manual NAV.
    invalidateListResponseCache()
    invalidateTeamDataListCaches()

    const beian = (beian_hao ?? "").trim().toUpperCase()
    let productName = (bodyProductName ?? "").trim() || beian
    let shortName: string | null = null

    // Resolve identity + rewrite detail/list caches *before* responding so the
    // product chart cannot keep serving a pre-upload sawtooth series.
    if (beian) {
      try {
        const { query } = await import("@/lib/db")
        const nameRows = await query<{ product_name: string; short_name: string | null }>(
          `SELECT product_name, short_name
           FROM ops_managed_products_list_cache
           WHERE UPPER(BTRIM(beian_hao)) = $1
           LIMIT 1`,
          [beian],
        ).catch(() => [] as { product_name: string; short_name: string | null }[])
        if (nameRows[0]) {
          productName = nameRows[0].product_name || productName
          shortName = nameRows[0].short_name ?? null
        } else {
          const trackRows = await query<{ product_name: string; short_name: string | null }>(
            `SELECT product_name, short_name
             FROM ops_tracking_funds_list_cache
             WHERE UPPER(BTRIM(beian_hao)) = $1
             LIMIT 1`,
            [beian],
          ).catch(() => [] as { product_name: string; short_name: string | null }[])
          if (trackRows[0]) {
            productName = trackRows[0].product_name || productName
            shortName = trackRows[0].short_name ?? null
          } else {
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
        }
      } catch (err) {
        console.error("[team-data/nav/upload] product name resolve failed:", err)
      }

      if (Array.isArray(rows) && rows.length > 0) {
        try {
          const { patchTrackingFundsListCacheTipFromSeries } = await import(
            "@/lib/server/tracking-funds-list-cache-pg"
          )
          const series = [...rows]
            .map((row) => ({
              price_date: (row.nav_date ?? "").trim().slice(0, 10),
              nav: String(row.unit_nav ?? ""),
              // tipFields treats cumulative_nav as 复权 for period returns
              cumulative_nav: String(
                row.adjusted_nav ?? row.cumulative_nav ?? row.unit_nav ?? "",
              ),
            }))
            .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.price_date))
            .sort((a, b) => a.price_date.localeCompare(b.price_date))
          if (series.length > 0) {
            await patchTrackingFundsListCacheTipFromSeries({
              beian_hao: beian,
              product_name: productName,
              series,
            })
          }
        } catch (err) {
          console.error("[team-data/nav/upload] tracking tip patch failed:", err)
        }
      }

      try {
        const { invalidateDetailNavCache, refreshDetailNavCacheForFund } = await import(
          "@/lib/server/fund-detail-nav-cache-pg"
        )
        await invalidateDetailNavCache([beian])
        await refreshDetailNavCacheForFund({
          beian_hao: beian,
          product_name: productName,
          short_name: shortName,
          nav_data_source: "team",
        })
      } catch (err) {
        console.error("[team-data/nav/upload] detail NAV cache refresh failed:", err)
      }
    }

    invalidateListResponseCache()

    // Managed-products full rebuild can be slow — keep it best-effort in background.
    void refreshManagedProductsListCache()
      .catch((err) => {
        console.error("[team-data/nav/upload] cache refresh failed:", err)
      })
      .finally(() => {
        invalidateListResponseCache()
      })

    return NextResponse.json({ ok: true, count: result.count })
  } catch (err) {
    console.error("[team-data/nav/upload]", err)
    return NextResponse.json({ error: "Failed to upload team nav rows" }, { status: 500 })
  }
}
