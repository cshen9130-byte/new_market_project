import { createHash } from "crypto"
import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import {
  ensureManagedProductsListCacheTable,
  refreshManagedProductsListCache,
} from "@/lib/server/managed-products-list-cache-pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function managedProductRowHash(productName: string, beian: string): string {
  return createHash("sha256").update(`manual_add::${beian || productName}::${productName}`).digest("hex")
}

async function findExistingManagedProductId(
  productName: string,
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `SELECT id::text AS id
     FROM managed_products
     WHERE product_name = $1 AND product_name <> '合计'
     LIMIT 1`,
    [productName],
  )
  return !!rows[0]?.id
}

async function resolveFundShortName(
  beian: string,
): Promise<string | null> {
  if (!beian) return null
  const rows = await query<{ short_name: string | null }>(
    `SELECT short_name FROM private_fund_info_bfl WHERE beian_hao = $1 LIMIT 1`,
    [beian],
  )
  return rows[0]?.short_name?.trim() || null
}

async function insertManagedProductRow(productName: string, beian: string): Promise<string> {
  const rowHash = managedProductRowHash(productName, beian)
  const rows = await query<{ id: string }>(
    `WITH next AS (
       SELECT
         COALESCE(MAX(source_row_number), 0) + 1 AS sr,
         COALESCE(MAX(sequence_no), 0) + 1 AS seq
       FROM managed_products
     )
     INSERT INTO managed_products (
       source_row_number,
       sequence_no,
       product_name,
       row_hash,
       source_file
     )
     SELECT next.sr, next.seq, $1, $2, 'manual_add'
     FROM next
     RETURNING id::text AS id`,
    [productName, rowHash],
  )
  const id = rows[0]?.id
  if (!id) throw new Error("insert_returned_no_id")
  return id
}

async function upsertMinimalCacheRow(
  managedProductId: string,
  productName: string,
  beian: string,
  shortName: string | null,
): Promise<void> {
  await ensureManagedProductsListCacheTable()
  const today = new Date().toISOString().slice(0, 10)
  await query(
    `INSERT INTO ops_managed_products_list_cache (
       managed_product_id, product_name, beian_hao, short_name, as_of_date, refreshed_at
     ) VALUES ($1::bigint, $2, $3, $4, $5::date, NOW())
     ON CONFLICT (managed_product_id) DO UPDATE SET
       product_name = EXCLUDED.product_name,
       beian_hao = EXCLUDED.beian_hao,
       short_name = EXCLUDED.short_name,
       refreshed_at = NOW()`,
    [managedProductId, productName, beian || null, shortName, today],
  )
}

function mapDbError(err: unknown): { status: number; error: string } {
  const code = typeof err === "object" && err && "code" in err ? String((err as { code: string }).code) : ""
  const constraint = typeof err === "object" && err && "constraint" in err ? String((err as { constraint: string }).constraint) : ""
  if (code === "23505" && (constraint.includes("row_hash") || constraint.includes("product_name"))) {
    return { status: 409, error: "already_exists" }
  }
  if (code === "42501") return { status: 500, error: "permission_denied" }
  // Cache table missing PRIMARY KEY after build-then-swap (fixed by ensureListCachePrimaryKey).
  if (code === "42P10") return { status: 500, error: "cache_schema_error" }
  return { status: 500, error: "db_error" }
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 })
  }

  const { beian_hao, product_name } = body as Record<string, string>
  const name = (product_name || "").trim()
  const beian = (beian_hao || "").trim()
  if (!name) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 })
  }

  try {
    const shortName = await resolveFundShortName(beian)

    const exists = await findExistingManagedProductId(name)
    if (exists) {
      return NextResponse.json({ error: "already_exists" }, { status: 409 })
    }

    const id = await insertManagedProductRow(name, beian)
    await upsertMinimalCacheRow(id, name, beian, shortName)

    void refreshManagedProductsListCache().catch((err) => {
      console.error("[managed-products/add] background cache refresh failed", err)
    })

    return NextResponse.json({ ok: true, id })
  } catch (err) {
    console.error("[managed-products/add]", err)
    const mapped = mapDbError(err)
    return NextResponse.json({ error: mapped.error }, { status: mapped.status })
  }
}
