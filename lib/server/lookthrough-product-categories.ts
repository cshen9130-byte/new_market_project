import { query } from "@/lib/db"
import {
  isProductCategory,
  type ProductCategory,
} from "@/lib/ma/lookthrough-compliance-types"

export type LookthroughCategoryItem = {
  product_id: number
  beian_hao?: string | null
  category: ProductCategory
}

export async function ensureLookthroughProductCategoriesTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS lookthrough_product_categories (
      managed_product_id BIGINT PRIMARY KEY,
      beian_hao VARCHAR(64),
      category VARCHAR(32) NOT NULL,
      updated_by VARCHAR(255) NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

export async function loadLookthroughProductCategories(): Promise<Map<number, ProductCategory>> {
  await ensureLookthroughProductCategoriesTable()
  const rows = await query<{ managed_product_id: string | number; category: string }>(
    `SELECT managed_product_id, category FROM lookthrough_product_categories`,
  )
  const map = new Map<number, ProductCategory>()
  for (const row of rows) {
    if (!isProductCategory(row.category)) continue
    map.set(Number(row.managed_product_id), row.category)
  }
  return map
}

export async function loadLookthroughCategoryByBeian(
  beianHao: string,
): Promise<ProductCategory | null> {
  const code = beianHao.trim()
  if (!code) return null
  await ensureLookthroughProductCategoriesTable()
  const rows = await query<{ category: string }>(
    `SELECT c.category
     FROM lookthrough_product_categories c
     WHERE (
       NULLIF(BTRIM(c.beian_hao), '') IS NOT NULL
       AND UPPER(BTRIM(c.beian_hao)) = UPPER(BTRIM($1))
     ) OR c.managed_product_id IN (
       SELECT cache.managed_product_id
       FROM ops_managed_products_list_cache cache
       WHERE NULLIF(BTRIM(cache.beian_hao), '') IS NOT NULL
         AND UPPER(BTRIM(cache.beian_hao)) = UPPER(BTRIM($1))
     )
     ORDER BY c.updated_at DESC
     LIMIT 1`,
    [code],
  )
  const category = rows[0]?.category
  return isProductCategory(category) ? category : null
}

export async function resolveManagedProductIdByBeian(
  beianHao: string,
): Promise<number | null> {
  const code = beianHao.trim()
  if (!code) return null
  const rows = await query<{ managed_product_id: string | number }>(
    `SELECT managed_product_id
     FROM ops_managed_products_list_cache
     WHERE NULLIF(BTRIM(beian_hao), '') IS NOT NULL
       AND UPPER(BTRIM(beian_hao)) = UPPER(BTRIM($1))
     LIMIT 1`,
    [code],
  )
  const id = Number(rows[0]?.managed_product_id)
  return Number.isFinite(id) && id > 0 ? id : null
}

export async function saveLookthroughProductCategories(
  items: LookthroughCategoryItem[],
  updatedBy: string,
): Promise<number> {
  await ensureLookthroughProductCategoriesTable()
  let saved = 0
  for (const item of items) {
    const productId = Number(item.product_id)
    if (!Number.isFinite(productId) || productId <= 0) continue
    if (!isProductCategory(item.category)) continue
    const beian = item.beian_hao?.trim() || null
    await query(
      `INSERT INTO lookthrough_product_categories (
         managed_product_id, beian_hao, category, updated_by, updated_at
       ) VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (managed_product_id) DO UPDATE SET
         beian_hao = COALESCE(EXCLUDED.beian_hao, lookthrough_product_categories.beian_hao),
         category = EXCLUDED.category,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      [productId, beian, item.category, updatedBy],
    )
    saved += 1
  }
  return saved
}
