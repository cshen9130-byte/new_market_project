import { NextResponse } from "next/server"
import { listManagedFofUnderlying } from "@/lib/server/managed-fof-underlying-pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Latest 底层产品 holdings per 在管产品 FOF fund (excludes 荣熙恒盈2号). */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const managedProductId = searchParams.get("managedProductId")
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)))
    const offset = (page - 1) * pageSize

    const { rows, total } = await listManagedFofUnderlying({
      managedProductId: managedProductId ? parseInt(managedProductId, 10) : undefined,
      fofProductCode: searchParams.get("fofProductCode") ?? undefined,
      fofProductName: searchParams.get("fofProductName") ?? undefined,
      limit: pageSize,
      offset,
    })

    return NextResponse.json({
      data: rows.map((r) => ({
        id: r.id,
        managedProductId: r.managed_product_id,
        fofProductName: r.fof_product_name,
        fofProductCode: r.fof_product_code,
        valuationDate: r.valuation_date,
        valuationRecordId: r.valuation_record_id,
        underlyingProductCode: r.underlying_product_code,
        underlyingName: r.underlying_name,
        subjectCode: r.subject_code,
        rowKind: r.row_kind,
        marketValue: r.market_value,
        quantity: r.quantity,
        cost: r.cost,
        marketWeight: r.market_weight,
        refreshedAt: r.refreshed_at,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (err) {
    console.error("[managed-fof-underlying/list]", err)
    const message = err instanceof Error ? err.message : "读取失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
