import { query, fmtIso } from "@/lib/db"
import { lookupManagedProductOverride } from "@/lib/server/managed-product-beian"

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

export function extractManagerBrand(managerName: string): string | null {
  const name = managerName.trim()
  if (!name) return null
  const stripped = name.replace(/^(上海|北京|深圳|广州|杭州|南京|成都|重庆|天津|苏州|宁波|武汉|厦门|青岛|大连|香港)/, "")
  if (stripped.length >= 2) return stripped.slice(0, 4)
  return extractBrandPrefix(name)
}

export async function resolveManagerAndProduct(beian_hao: string): Promise<{ manager: string; productName: string }> {
  for (const sql of [
    `SELECT manager, product_name FROM private_fund_info WHERE beian_hao = $1 LIMIT 1`,
    `SELECT COALESCE(advisor, advisor2, '') AS manager,
            COALESCE(fund_short_name, fund_name, '') AS product_name
     FROM basicinfo_bfl_track
     WHERE register_number = $1
     ORDER BY updated_at DESC NULLS LAST, id DESC
     LIMIT 1`,
  ]) {
    try {
      const rows = await query<{ manager: string | null; product_name: string | null }>(sql, [beian_hao])
      const manager = rows[0]?.manager?.trim() ?? ""
      const productName = rows[0]?.product_name?.trim() ?? ""
      if (manager || productName) return { manager, productName }
    } catch {
      // optional table/column
    }
  }

  const managed = lookupManagedProductOverride(beian_hao)
  if (managed) return { manager: "", productName: managed.product_name }

  return { manager: "", productName: "" }
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
    if (exact[0]) return exact[0]

    const fuzzy = await query<ManagerListRow>(
      `SELECT manager_name, inception_date, active_product_count, mgmt_scale, registration_no
       FROM private_fund_managers_list
       WHERE manager_name ILIKE $1
       ORDER BY LENGTH(manager_name) ASC
       LIMIT 1`,
      [`%${manager}%`],
    )
    if (fuzzy[0]) return fuzzy[0]
  }

  const prefix = extractBrandPrefix(productName)
  if (!prefix) return null

  const byPrefix = await query<ManagerListRow>(
    `SELECT manager_name, inception_date, active_product_count, mgmt_scale, registration_no
     FROM private_fund_managers_list
     WHERE manager_name ILIKE $1
     ORDER BY LENGTH(manager_name) ASC
     LIMIT 1`,
    [`%${prefix}%`],
  )
  return byPrefix[0] ?? null
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
