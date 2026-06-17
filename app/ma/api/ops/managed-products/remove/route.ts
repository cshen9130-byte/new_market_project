import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { ensureManagedProductsListCacheTable } from "@/lib/server/managed-products-list-cache-pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function mapDbError(err: unknown): { status: number; error: string } {
  const code = typeof err === "object" && err && "code" in err ? String((err as { code: string }).code) : ""
  if (code === "42501") return { status: 500, error: "permission_denied" }
  return { status: 500, error: "db_error" }
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 })
  }

  const id = String((body as Record<string, unknown>).id ?? "").trim()
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 })
  }

  try {
    const existing = await query<{ id: string }>(
      `SELECT id::text AS id
       FROM managed_products
       WHERE id = $1::bigint AND product_name <> '合计'
       LIMIT 1`,
      [id],
    )
    if (!existing[0]?.id) {
      return NextResponse.json({ error: "not_found" }, { status: 404 })
    }

    await ensureManagedProductsListCacheTable()
    await query(`DELETE FROM ops_managed_products_list_cache WHERE managed_product_id = $1::bigint`, [id])
    await query(`DELETE FROM managed_products WHERE id = $1::bigint`, [id])

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[managed-products/remove]", err)
    const mapped = mapDbError(err)
    return NextResponse.json({ error: mapped.error }, { status: mapped.status })
  }
}
