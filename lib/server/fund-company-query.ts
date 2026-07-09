import { query, fmtIso } from "@/lib/db"
import { lookupManagedProductOverride } from "@/lib/server/managed-product-beian"
import { lookupAmacFundMetadata, lookupAmacManagerByName } from "@/lib/server/amac-fund-metadata"

export interface ManagerListRow {
  manager_name: string
  inception_date: string | Date | null
  active_product_count: number | null
  mgmt_scale: string | null
  registration_no: string
}

export interface RepresentativeProduct {
  beian_hao: string
  product_name: string
}

export function extractBrandPrefix(productName: string): string | null {
  const name = productName.trim()
  if (!name) return null
  const m = name.match(/^([\u4e00-\u9fff]{2})/)
  return m?.[1] ?? null
}

/** Up to 4 leading CJK chars from a product name — e.g. 抱朴聚融祥和一号 → 抱朴聚融. */
export function extractProductBrand(productName: string): string | null {
  const name = productName.trim()
  if (!name) return null
  const m = name.match(/^([\u4e00-\u9fff]{4})/)
  if (m) return m[1]
  return extractBrandPrefix(name)
}

export function extractManagerBrand(managerName: string): string | null {
  const name = managerName.trim()
  if (!name) return null
  const stripped = name.replace(/^(上海|北京|深圳|广州|杭州|南京|成都|重庆|天津|苏州|宁波|武汉|厦门|青岛|大连|香港)/, "")
  if (stripped.length >= 2) return stripped.slice(0, 4)
  return extractBrandPrefix(name)
}

export async function resolveManagerAndProduct(beian_hao: string): Promise<{ manager: string; productName: string }> {
  let manager = ""
  let productName = ""

  try {
    const rows = await query<{ manager: string | null; product_name: string | null }>(
      `SELECT manager, product_name FROM private_fund_info WHERE beian_hao = $1 LIMIT 1`,
      [beian_hao],
    )
    manager = rows[0]?.manager?.trim() ?? ""
    productName = rows[0]?.product_name?.trim() ?? ""
  } catch {
    // optional table
  }

  if (!manager || !productName) {
    try {
      const rows = await query<{ manager: string | null; product_name: string | null }>(
        `SELECT COALESCE(NULLIF(BTRIM(advisor), ''), NULLIF(BTRIM(advisor2), ''), '') AS manager,
                COALESCE(NULLIF(BTRIM(fund_short_name), ''), NULLIF(BTRIM(fund_name), ''), '') AS product_name
         FROM basicinfo_bfl_track
         WHERE register_number = $1 OR record_key = $1
         ORDER BY updated_at DESC NULLS LAST, id DESC
         LIMIT 1`,
        [beian_hao],
      )
      if (!manager) manager = rows[0]?.manager?.trim() ?? ""
      if (!productName) productName = rows[0]?.product_name?.trim() ?? ""
    } catch {
      // optional table/column
    }
  }

  if (!productName) {
    const managed = lookupManagedProductOverride(beian_hao)
    if (managed) productName = managed.product_name
  }

  if (!manager && productName) {
    try {
      const rows = await query<{ manager: string | null }>(
        `SELECT manager
         FROM private_fund_info
         WHERE manager IS NOT NULL AND BTRIM(manager) <> ''
           AND product_name ILIKE $1
         ORDER BY CASE WHEN product_name ILIKE $2 THEN 0 ELSE 1 END
         LIMIT 1`,
        [`%${productName}%`, `${productName}%`],
      )
      manager = rows[0]?.manager?.trim() ?? ""
    } catch {
      // optional table
    }
  }

  if (!manager && productName) {
    try {
      const rows = await query<{ manager: string | null }>(
        `SELECT COALESCE(NULLIF(BTRIM(advisor), ''), NULLIF(BTRIM(advisor2), ''), '') AS manager
         FROM basicinfo_bfl_track
         WHERE fund_name ILIKE $1 OR fund_short_name ILIKE $1
         ORDER BY updated_at DESC NULLS LAST, id DESC
         LIMIT 1`,
        [`%${productName}%`],
      )
      manager = rows[0]?.manager?.trim() ?? ""
    } catch {
      // optional table/column
    }
  }

  return { manager, productName }
}

export async function lookupManagerList(manager: string, productName: string): Promise<ManagerListRow | null> {
  if (manager) {
    const exact = await query<ManagerListRow>(
      `SELECT manager_name, inception_date, active_product_count, mgmt_scale, registration_no
       FROM private_fund_managers_list
       WHERE manager_name = $1
       LIMIT 1`,
      [manager],
    )
    if (exact[0]) {
      if (exact[0].mgmt_scale) return exact[0]
      const amac = await lookupAmacManagerByName(manager)
      if (amac?.mgmt_scale) {
        return {
          ...exact[0],
          mgmt_scale: amac.mgmt_scale,
          registration_no: exact[0].registration_no || amac.registration_no,
        }
      }
      return exact[0]
    }

    const fuzzy = await query<ManagerListRow>(
      `SELECT manager_name, inception_date, active_product_count, mgmt_scale, registration_no
       FROM private_fund_managers_list
       WHERE manager_name ILIKE $1
       ORDER BY LENGTH(manager_name) DESC
       LIMIT 1`,
      [`%${manager}%`],
    )
    if (fuzzy[0]) {
      if (fuzzy[0].mgmt_scale) return fuzzy[0]
      const amac = await lookupAmacManagerByName(manager)
      if (amac?.mgmt_scale) {
        return {
          ...fuzzy[0],
          mgmt_scale: amac.mgmt_scale,
          registration_no: fuzzy[0].registration_no || amac.registration_no,
        }
      }
      return fuzzy[0]
    }

    const amacOnly = await lookupAmacManagerByName(manager)
    if (amacOnly) {
      return {
        manager_name: amacOnly.manager_name ?? manager,
        inception_date: null,
        active_product_count: null,
        mgmt_scale: amacOnly.mgmt_scale,
        registration_no: amacOnly.registration_no,
      }
    }
  }

  const brand = extractProductBrand(productName)
  if (!brand) return null

  const prefixCandidates = brand.length > 2 ? [brand, brand.slice(0, 2)] : [brand]
  for (const prefix of prefixCandidates) {
    const byPrefix = await query<ManagerListRow>(
      `SELECT manager_name, inception_date, active_product_count, mgmt_scale, registration_no
       FROM private_fund_managers_list
       WHERE manager_name ILIKE $1
       ORDER BY LENGTH(manager_name) DESC
       LIMIT 1`,
      [`%${prefix}%`],
    )
    if (byPrefix[0]) return byPrefix[0]
  }

  return null
}

export async function resolveCompanyManagerName(beian_hao: string): Promise<string | null> {
  const { manager, productName } = await resolveManagerAndProduct(beian_hao)
  const mgr = await lookupManagerList(manager, productName)
  return mgr?.manager_name ?? (manager || null)
}

export async function lookupRepresentativeProduct(managerName: string): Promise<RepresentativeProduct | null> {
  const rows = await query<RepresentativeProduct>(
    `SELECT beian_hao, product_name
     FROM private_fund_info
     WHERE manager ILIKE $1
       AND product_name ~ '优选[0-9]+号'
       AND product_name NOT ILIKE '%类%'
     ORDER BY product_name
     LIMIT 1`,
    [`%${managerName}%`],
  )
  if (rows[0]) return rows[0]

  const fallback = await query<RepresentativeProduct>(
    `SELECT beian_hao, product_name
     FROM private_fund_info
     WHERE manager ILIKE $1
       AND product_name ILIKE '%优选%'
       AND product_name NOT ILIKE '%类%'
     ORDER BY product_name
     LIMIT 1`,
    [`%${managerName}%`],
  )
  return fallback[0] ?? null
}

export function fmtIsoDate(d: Date | string | null | undefined): string | null {
  if (!d) return null
  return fmtIso(d)
}
