/**
 * 最新变动日期: the Shanghai calendar day of the most recent write to a product
 * (NAV ingest/edit, 要素表, 团队策略/标签, 估值表, notes, NAV debug rules).
 * This is not 最新净值日期 (the NAV point's price_date).
 */

import { query } from "@/lib/db"
import { expandBeianLookupKeys } from "@/lib/server/fund-elements-lookup"
import { listFundNavCorrectionRules } from "@/lib/server/fund-nav-correction-rules"

const SHANGHAI_DAY = (col: string) => `(${col} AT TIME ZONE 'Asia/Shanghai')::date`

/** ORDER BY expression: greatest write timestamp for an exact 备案号. */
export function sqlLatestChangeAt(beianExpr: string, firstAddedExpr = "i.first_added_at"): string {
  return `(
    SELECT MAX(ts) FROM (
      SELECT MAX(updated_at) AS ts
        FROM basicinfo_bfl_track
       WHERE register_number = ${beianExpr} OR record_key = ${beianExpr}
      UNION ALL
      SELECT MAX(updated_at)
        FROM type6_ops_team_full
       WHERE register_number = ${beianExpr}
      UNION ALL
      SELECT MAX(created_at)
        FROM ops_email_nav_records
       WHERE product_code = ${beianExpr}
      UNION ALL
      SELECT ${firstAddedExpr}::timestamptz
    ) _product_chg(ts)
  )`
}

function maxDay(a: string | null | undefined, b: string | null | undefined): string | null {
  const left = (a ?? "").slice(0, 10)
  const right = (b ?? "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(left)) return /^\d{4}-\d{2}-\d{2}$/.test(right) ? right : null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(right)) return left
  return left >= right ? left : right
}

function putDay(map: Map<string, string>, rawKey: string | null | undefined, day: string | null | undefined) {
  const key = String(rawKey ?? "").trim().toUpperCase()
  const value = (day ?? "").slice(0, 10)
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return
  const prev = map.get(key)
  map.set(key, prev && prev >= value ? prev : value)
}

async function loadChangeDaysByCode(codes: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (codes.length === 0) return out

  const q = <T,>(sql: string) =>
    query<T>(sql, [codes]).catch(() => [] as T[])

  const [
    elements,
    strategy,
    manualNav,
    emailNav,
    valuation,
    notes,
    personalTags,
  ] = await Promise.all([
    q<{ code: string; ts: string }>(
      `SELECT UPPER(BTRIM(code)) AS code, MAX(ts)::text AS ts
       FROM (
         SELECT register_number AS code, ${SHANGHAI_DAY("updated_at")} AS ts
           FROM basicinfo_bfl_track
          WHERE register_number = ANY($1::text[]) OR record_key = ANY($1::text[])
         UNION ALL
         SELECT record_key, ${SHANGHAI_DAY("updated_at")}
           FROM basicinfo_bfl_track
          WHERE register_number = ANY($1::text[]) OR record_key = ANY($1::text[])
       ) s
       WHERE NULLIF(BTRIM(code), '') IS NOT NULL
       GROUP BY 1`,
    ),
    q<{ code: string; ts: string }>(
      `SELECT UPPER(BTRIM(register_number)) AS code, MAX(${SHANGHAI_DAY("updated_at")})::text AS ts
         FROM type6_ops_team_full
        WHERE register_number = ANY($1::text[])
        GROUP BY 1`,
    ),
    q<{ code: string; ts: string }>(
      `SELECT UPPER(BTRIM(beian_hao)) AS code, MAX(${SHANGHAI_DAY("created_at")})::text AS ts
         FROM ops_team_nav_manual
        WHERE beian_hao = ANY($1::text[])
        GROUP BY 1`,
    ),
    q<{ code: string; ts: string }>(
      `SELECT UPPER(BTRIM(product_code)) AS code, MAX(${SHANGHAI_DAY("created_at")})::text AS ts
         FROM ops_email_nav_records
        WHERE product_code = ANY($1::text[])
        GROUP BY 1`,
    ),
    q<{ code: string; ts: string }>(
      `SELECT UPPER(BTRIM(product_code)) AS code, MAX(${SHANGHAI_DAY("created_at")})::text AS ts
         FROM ops_email_valuation_records
        WHERE product_code = ANY($1::text[])
        GROUP BY 1`,
    ),
    q<{ code: string; ts: string }>(
      `SELECT UPPER(BTRIM(beian_hao)) AS code, MAX(${SHANGHAI_DAY("updated_at")})::text AS ts
         FROM ops_fund_notes
        WHERE beian_hao = ANY($1::text[])
        GROUP BY 1`,
    ),
    q<{ code: string; ts: string }>(
      `SELECT UPPER(BTRIM(beian_hao)) AS code, MAX(${SHANGHAI_DAY("created_at")})::text AS ts
         FROM ops_personal_fund_tags
        WHERE beian_hao = ANY($1::text[])
        GROUP BY 1`,
    ),
  ])

  for (const rows of [elements, strategy, manualNav, emailNav, valuation, notes, personalTags]) {
    for (const row of rows) putDay(out, row.code, row.ts)
  }
  return out
}

async function loadChangeDaysByName(names: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const labels = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  if (labels.length === 0) return out
  const rows = await query<{ name: string; ts: string }>(
    `SELECT BTRIM(fund_name) AS name, MAX(${SHANGHAI_DAY("created_at")})::text AS ts
       FROM ops_email_nav_records
      WHERE fund_name = ANY($1::text[])
      GROUP BY 1`,
    [labels],
  ).catch(() => [] as Array<{ name: string; ts: string }>)
  for (const row of rows) putDay(out, row.name, row.ts)
  return out
}

function correctionRuleDay(
  beian: string,
  productName: string | null | undefined,
  shortName: string | null | undefined,
): string | null {
  const beianU = beian.trim().toUpperCase()
  const names = new Set(
    [productName, shortName].map((v) => (v ?? "").trim()).filter(Boolean),
  )
  let best: string | null = null
  for (const rule of listFundNavCorrectionRules()) {
    const matchesBeian = rule.beian_hao.trim().toUpperCase() === beianU
    const matchesName = (rule.product_names ?? []).some((n) => names.has(n.trim()))
    if (!matchesBeian && !matchesName) continue
    best = maxDay(best, rule.updated_at)
  }
  return best
}

/** Attach 最新变动日期 (YYYY-MM-DD, Asia/Shanghai) onto list rows. */
export async function overlayLatestChangeDate<T extends {
  beian_hao?: string | null
  product_name?: string | null
  short_name?: string | null
  first_added_at?: string | null
  first_entry_date?: string | null
}>(rows: T[]): Promise<Array<T & { latest_change_date: string | null }>> {
  if (rows.length === 0) {
    return rows.map((row) => ({ ...row, latest_change_date: null }))
  }
  try {
    const beianCodes = [...new Set(rows.map((r) => String(r.beian_hao ?? "").trim()).filter(Boolean))]
    const lookupCodes = expandBeianLookupKeys(beianCodes)
    const names = rows.flatMap((r) => [r.product_name, r.short_name])
    const [byCode, byName] = await Promise.all([
      loadChangeDaysByCode(lookupCodes),
      loadChangeDaysByName(names.filter((n): n is string => Boolean(n))),
    ])

    return rows.map((row) => {
      const beian = String(row.beian_hao ?? "").trim()
      let day: string | null = null
      if (beian) {
        for (const key of expandBeianLookupKeys([beian])) {
          day = maxDay(day, byCode.get(key.toUpperCase()))
        }
      }
      day = maxDay(day, byName.get(String(row.product_name ?? "").trim().toUpperCase()))
      day = maxDay(day, byName.get(String(row.short_name ?? "").trim().toUpperCase()))
      day = maxDay(day, correctionRuleDay(beian, row.product_name, row.short_name))
      day = maxDay(day, (row.first_added_at ?? row.first_entry_date ?? "").slice(0, 10))
      return { ...row, latest_change_date: day }
    })
  } catch (err) {
    console.warn("[overlayLatestChangeDate] skipped:", err)
    return rows.map((row) => ({
      ...row,
      latest_change_date: maxDay(
        (row as { latest_change_date?: string | null }).latest_change_date,
        row.first_added_at ?? row.first_entry_date,
      ),
    }))
  }
}
