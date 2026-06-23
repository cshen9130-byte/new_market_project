import { query } from "@/lib/db"
import { ensureManagedProductsListCacheTable } from "@/lib/server/managed-products-list-cache-pg"

export type AddManagedProductInput = {
  product_name: string
  beian_hao?: string | null
  short_name?: string | null
}

export type AddManagedProductResult = {
  id: number
  product_name: string
}

export async function addManagedProduct(
  input: AddManagedProductInput,
): Promise<AddManagedProductResult> {
  const productName = input.product_name.trim()
  if (!productName) {
    throw new Error("product_name_required")
  }

  await ensureManagedProductsListCacheTable()

  const existing = await query<{ id: number }>(
    `SELECT id FROM managed_products
     WHERE TRIM(product_name) = $1 AND product_name <> '合计'
     LIMIT 1`,
    [productName],
  )
  if (existing.length > 0) {
    throw new Error("already_exists")
  }

  const inserted = await query<{ id: number; product_name: string }>(
    `INSERT INTO managed_products (product_name, sequence_no)
     SELECT $1, COALESCE((SELECT MAX(sequence_no) FROM managed_products), 0) + 1
     RETURNING id, product_name`,
    [productName],
  )
  const row = inserted[0]
  if (!row) {
    throw new Error("insert_failed")
  }

  const beianHao = input.beian_hao?.trim() || null
  const shortName = input.short_name?.trim() || productName
  const asOfDate = new Date().toISOString().slice(0, 10)

  await query(
    `INSERT INTO ops_managed_products_list_cache (
       managed_product_id, product_name, beian_hao, short_name, as_of_date
     ) VALUES ($1, $2, $3, $4, $5::date)
     ON CONFLICT (managed_product_id) DO UPDATE SET
       product_name = EXCLUDED.product_name,
       beian_hao = EXCLUDED.beian_hao,
       short_name = EXCLUDED.short_name,
       as_of_date = EXCLUDED.as_of_date,
       refreshed_at = NOW()`,
    [row.id, productName, beianHao, shortName, asOfDate],
  )

  return { id: row.id, product_name: row.product_name }
}
