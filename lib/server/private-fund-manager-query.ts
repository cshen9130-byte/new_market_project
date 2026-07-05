import { query, fmtIso } from "@/lib/db"
import { extractManagerBrand } from "@/lib/server/fund-company-query"

export interface ManagerListDetail {
  id: number
  seq_no: number | null
  manager_name: string
  core_strategy: string | null
  mgmt_scale: string | null
  active_product_count: number | null
  inception_date: string | null
  member_type: string | null
  registration_no: string
}

export interface ManagerScaleTrendPoint {
  period: string
  active_product_count: number
  mgmt_scale: string | null
  mgmt_scale_value: number | null
}

const SCALE_MIDPOINTS: Record<string, number> = {
  "0-5亿元": 2.5,
  "0-5亿": 2.5,
  "5-10亿元": 7.5,
  "5-10亿": 7.5,
  "10-20亿元": 15,
  "10-20亿": 15,
  "20-50亿元": 35,
  "20-50亿": 35,
  "50-100亿元": 75,
  "50-100亿": 75,
  "100亿元以上": 100,
  "100亿以上": 100,
}

export function managerDisplayName(fullName: string): string {
  const name = fullName.trim()
  if (!name) return "—"
  const m = name.match(
    /^(上海|北京|深圳|广州|杭州|南京|成都|重庆|天津|苏州|宁波|武汉|厦门|青岛|大连|香港)([\u4e00-\u9fff]{2})/,
  )
  if (m) return `${m[1]}${m[2]}`
  return name.length > 8 ? name.slice(0, 8) : name
}

export function mgmtScaleToValue(scale: string | null | undefined): number | null {
  if (!scale) return null
  const normalized = scale.trim()
  if (SCALE_MIDPOINTS[normalized] != null) return SCALE_MIDPOINTS[normalized]
  for (const [key, value] of Object.entries(SCALE_MIDPOINTS)) {
    if (normalized.includes(key.replace(/亿元?/, ""))) return value
  }
  return null
}

export async function lookupManagerByRegistrationNo(
  registrationNo: string,
): Promise<ManagerListDetail | null> {
  const rows = await query<{
    id: number
    seq_no: number | null
    manager_name: string
    core_strategy: string | null
    mgmt_scale: string | null
    active_product_count: number | null
    inception_date: string | Date | null
    member_type: string | null
    registration_no: string
  }>(
    `SELECT id, seq_no, manager_name, core_strategy, mgmt_scale, active_product_count,
            inception_date, member_type, registration_no
     FROM private_fund_managers_list
     WHERE registration_no = $1
     LIMIT 1`,
    [registrationNo.trim()],
  )
  const row = rows[0]
  if (!row) return null
  return {
    ...row,
    inception_date: row.inception_date ? fmtIso(row.inception_date) : null,
  }
}

function quarterEndDates(start: Date, end: Date): string[] {
  const points: string[] = []
  const cursor = new Date(start.getFullYear(), Math.floor(start.getMonth() / 3) * 3 + 2, 1)
  while (cursor <= end) {
    const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
    points.push(lastDay.toISOString().slice(0, 10))
    cursor.setMonth(cursor.getMonth() + 3)
  }
  if (points.length === 0) {
    points.push(end.toISOString().slice(0, 10))
  }
  return points
}

export async function buildManagerScaleTrend(
  manager: ManagerListDetail,
): Promise<ManagerScaleTrendPoint[]> {
  const brand = extractManagerBrand(manager.manager_name)
  const productRows = await query<{ inception_date: string | null }>(
    `SELECT inception_date::text AS inception_date
     FROM private_fund_info
     WHERE manager ILIKE $1
        OR ($2 <> '' AND product_name ILIKE $3)
     ORDER BY inception_date ASC NULLS LAST`,
    [`%${manager.manager_name}%`, brand ?? "", brand ? `%${brand}%` : ""],
  )

  const inceptionDates = productRows
    .map((r) => r.inception_date?.slice(0, 10))
    .filter((d): d is string => !!d)

  const managerStart = manager.inception_date?.slice(0, 10)
  const earliestProduct = inceptionDates[0]
  const startStr = managerStart && earliestProduct
    ? (managerStart < earliestProduct ? managerStart : earliestProduct)
    : managerStart ?? earliestProduct ?? new Date().toISOString().slice(0, 10)

  const start = new Date(startStr)
  const end = new Date()
  const quarters = quarterEndDates(start, end)
  const scaleValue = mgmtScaleToValue(manager.mgmt_scale)

  return quarters.map((period) => {
    const count = inceptionDates.filter((d) => d <= period).length
    return {
      period: period.slice(0, 7),
      active_product_count: count || manager.active_product_count || 0,
      mgmt_scale: manager.mgmt_scale,
      mgmt_scale_value: scaleValue,
    }
  })
}
