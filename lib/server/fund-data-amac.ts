/**
 * Read-only AMAC disclosure lookups for the fund-data API.
 * Rows come from PostgreSQL (amac_private_funds, amac_futures_products,
 * amac_managers, amac_manager_details), not a live association request.
 */

import { query } from "@/lib/db"
import { amacFundNoCandidates } from "@/lib/server/amac-fund-metadata"

export type AmacCall<T> =
  | { error_code: 0; data: T }
  | { error_code: 1 | 2; msg: string }

export type AmacFundRow = {
  source: "private" | "futures"
  fund_no: string
  fund_name: string
  manager_name: string | null
  manager_type: string | null
  working_state: string | null
  mandator_name: string | null
  establish_date: string | null
  put_on_record_date: string | null
  due_date: string | null
  fund_type: string | null
  investment_type: string | null
  is_tiered: string | null
  detail_url: string | null
  updated_at: string | null
}

export type AmacFundPage = {
  list: AmacFundRow[]
  total: number
  page: number
  pagesize: number
}

export type AmacManagerRow = {
  registration_no: string
  manager_name: string
  legal_rep_name: string | null
  org_type: string | null
  reg_province: string | null
  reg_city: string | null
  registered_address: string | null
  office_address: string | null
  inception_date: string | null
  registration_date: string | null
  active_fund_count: number | null
  member_type: string | null
  has_alert_info: string | null
  has_integrity_info: string | null
  registered_capital_cny_wan: string | null
  paid_in_capital_cny_wan: string | null
  paid_in_capital_ratio: string | null
  enterprise_nature: string | null
  business_type: string | null
  full_time_staff_count: number | null
  fund_practitioner_count: number | null
  mgmt_scale_range: string | null
  actual_controller: string | null
  is_member: string | null
  website_url: string | null
  detail_url: string | null
  updated_at: string | null
  executives: Array<{
    person_name: string
    title: string | null
    has_fund_qualification: string | null
    qualification_method: string | null
  }>
  shareholders: Array<{
    seq: number | null
    investor_name: string
    holding_ratio: string | null
    shareholder_type: string | null
    subscribed_amount: string | null
  }>
}

type FundSqlRow = {
  source: string
  fund_no: string
  fund_name: string
  manager_name: string | null
  manager_type: string | null
  working_state: string | null
  mandator_name: string | null
  establish_date: string | null
  put_on_record_date: string | null
  due_date: string | null
  fund_type: string | null
  investment_type: string | null
  is_tiered: string | null
  detail_url: string | null
  updated_at: Date | string | null
}

const FUND_SELECT = `
  fund_no,
  fund_name,
  NULLIF(BTRIM(manager_name), '') AS manager_name,
  NULLIF(BTRIM(manager_type), '') AS manager_type,
  NULLIF(BTRIM(working_state), '') AS working_state,
  NULLIF(BTRIM(mandator_name), '') AS mandator_name,
  establish_date::text AS establish_date,
  put_on_record_date::text AS put_on_record_date,
  fund_type,
  NULLIF(BTRIM(detail_url), '') AS detail_url,
  updated_at
`

function fail(errorCode: 1 | 2, msg: string): AmacCall<never> {
  return { error_code: errorCode, msg }
}

function ok<T>(data: T): AmacCall<T> {
  return { error_code: 0, data }
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s || null
}

function dayOrNull(value: unknown): string | null {
  const s = textOrNull(value)?.slice(0, 10) ?? null
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

function tsOrNull(value: unknown): string | null {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString()
  const s = String(value).trim()
  return s || null
}

function intOrNull(value: unknown): number | null {
  if (value == null || value === "") return null
  const n = typeof value === "number" ? value : parseInt(String(value), 10)
  return Number.isFinite(n) ? n : null
}

function parsePage(raw: string | number | null | undefined, fallback: number): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10)
  return Number.isFinite(n) ? n : fallback
}

function likeContains(raw: string): string {
  return `%${raw.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`
}

function isFundCode(raw: string): boolean {
  return /^[A-Za-z0-9]{4,24}$/.test(raw)
}

function mapFund(row: FundSqlRow): AmacFundRow {
  const source = row.source === "futures" ? "futures" : "private"
  return {
    source,
    fund_no: row.fund_no,
    fund_name: row.fund_name,
    manager_name: textOrNull(row.manager_name),
    manager_type: textOrNull(row.manager_type),
    working_state: textOrNull(row.working_state),
    mandator_name: textOrNull(row.mandator_name),
    establish_date: dayOrNull(row.establish_date),
    put_on_record_date: dayOrNull(row.put_on_record_date),
    due_date: dayOrNull(row.due_date),
    fund_type: textOrNull(row.fund_type),
    investment_type: textOrNull(row.investment_type),
    is_tiered: textOrNull(row.is_tiered),
    detail_url: textOrNull(row.detail_url),
    updated_at: tsOrNull(row.updated_at),
  }
}

function fundFilter(
  q: string,
  fundType: string,
  workingState: string,
): { where: string; params: unknown[] } {
  const params: unknown[] = []
  const parts: string[] = []
  if (isFundCode(q)) {
    params.push(amacFundNoCandidates(q))
    parts.push(`UPPER(BTRIM(fund_no)) = ANY($${params.length}::text[])`)
  } else {
    params.push(likeContains(q))
    const idx = params.length
    parts.push(
      `(fund_name ILIKE $${idx} ESCAPE E'\\\\' OR manager_name ILIKE $${idx} ESCAPE E'\\\\' OR fund_no ILIKE $${idx} ESCAPE E'\\\\')`,
    )
  }
  if (fundType) {
    params.push(fundType)
    parts.push(`fund_type = $${params.length}`)
  }
  if (workingState) {
    params.push(workingState)
    parts.push(`working_state = $${params.length}`)
  }
  return { where: parts.join(" AND "), params }
}

const FUND_UNION = (where: string) => `
  SELECT
    'private'::text AS source,
    ${FUND_SELECT},
    NULL::text AS due_date,
    NULL::text AS investment_type,
    NULL::text AS is_tiered
  FROM amac_private_funds
  WHERE ${where}
  UNION ALL
  SELECT
    'futures'::text AS source,
    ${FUND_SELECT},
    due_date::text AS due_date,
    NULLIF(BTRIM(investment_type), '') AS investment_type,
    NULLIF(BTRIM(is_tiered), '') AS is_tiered
  FROM amac_futures_products
  WHERE ${where}
`

export async function queryAmacFund(regCode: string): Promise<AmacCall<AmacFundRow>> {
  const code = regCode.trim()
  if (!code) return fail(1, "reg_code is required")
  const candidates = amacFundNoCandidates(code)
  const rows = await query<FundSqlRow>(
    `SELECT * FROM (${FUND_UNION("UPPER(BTRIM(fund_no)) = ANY($1::text[])")}) s
     ORDER BY CASE WHEN UPPER(BTRIM(fund_no)) = UPPER($2) THEN 0 ELSE 1 END,
              CASE WHEN source = 'private' THEN 0 ELSE 1 END
     LIMIT 1`,
    [candidates, code],
  )
  const row = rows[0]
  if (!row) return fail(2, `amac fund not found: ${code}`)
  return ok(mapFund(row))
}

export async function queryAmacFundSearch(options: {
  q?: string | null
  fund_type?: string | null
  working_state?: string | null
  page?: string | number | null
  pagesize?: string | number | null
}): Promise<AmacCall<AmacFundPage>> {
  const q = String(options.q ?? "").trim()
  if (!q) return fail(1, "q is required")
  if (q.length > 80) return fail(1, "q is too long")
  if (q.length < 2) return fail(1, "q is too short")

  const fundType = String(options.fund_type ?? "").trim()
  const workingState = String(options.working_state ?? "").trim()
  const page = Math.max(1, parsePage(options.page, 1))
  const pagesize = Math.min(50, Math.max(1, parsePage(options.pagesize, 20)))
  const { where, params } = fundFilter(q, fundType, workingState)

  const countRows = await query<{ n: string }>(
    `SELECT (
       (SELECT COUNT(*) FROM amac_private_funds WHERE ${where})
       + (SELECT COUNT(*) FROM amac_futures_products WHERE ${where})
     )::text AS n`,
    params,
  )
  const total = parseInt(countRows[0]?.n ?? "0", 10) || 0
  const offset = (page - 1) * pagesize
  const listParams = [...params, pagesize, offset]
  const rows = await query<FundSqlRow>(
    `SELECT * FROM (${FUND_UNION(where)}) s
     ORDER BY put_on_record_date DESC NULLS LAST, fund_no
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams,
  )
  return ok({
    list: rows.map(mapFund),
    total,
    page,
    pagesize,
  })
}

type ManagerSqlRow = {
  registration_no: string
  list_manager_name: string
  manager_name: string
  legal_rep_name: string | null
  org_type: string | null
  reg_province: string | null
  reg_city: string | null
  registered_address: string | null
  office_address: string | null
  inception_date: string | null
  registration_date: string | null
  active_fund_count: number | null
  member_type: string | null
  has_alert_info: string | null
  has_integrity_info: string | null
  registered_capital_cny_wan: string | null
  paid_in_capital_cny_wan: string | null
  paid_in_capital_ratio: string | null
  enterprise_nature: string | null
  business_type: string | null
  full_time_staff_count: number | null
  fund_practitioner_count: number | null
  mgmt_scale_range: string | null
  actual_controller: string | null
  is_member: string | null
  website_url: string | null
  detail_url: string | null
  updated_at: Date | string | null
}

const MANAGER_SELECT = `
  m.registration_no,
  m.manager_name AS list_manager_name,
  COALESCE(NULLIF(BTRIM(d.manager_name_cn), ''), m.manager_name) AS manager_name,
  NULLIF(BTRIM(m.legal_rep_name), '') AS legal_rep_name,
  NULLIF(BTRIM(COALESCE(d.org_type, m.org_type)), '') AS org_type,
  NULLIF(BTRIM(m.reg_province), '') AS reg_province,
  NULLIF(BTRIM(m.reg_city), '') AS reg_city,
  NULLIF(BTRIM(COALESCE(d.registered_address, m.reg_location)), '') AS registered_address,
  NULLIF(BTRIM(COALESCE(d.office_address, m.office_location)), '') AS office_address,
  COALESCE(d.inception_date, m.inception_date)::text AS inception_date,
  COALESCE(d.registration_date, m.registration_date)::text AS registration_date,
  m.active_fund_count,
  NULLIF(BTRIM(m.member_type), '') AS member_type,
  NULLIF(BTRIM(m.has_alert_info), '') AS has_alert_info,
  NULLIF(BTRIM(m.has_integrity_info), '') AS has_integrity_info,
  NULLIF(BTRIM(d.registered_capital_cny_wan), '') AS registered_capital_cny_wan,
  NULLIF(BTRIM(d.paid_in_capital_cny_wan), '') AS paid_in_capital_cny_wan,
  NULLIF(BTRIM(d.paid_in_capital_ratio), '') AS paid_in_capital_ratio,
  NULLIF(BTRIM(d.enterprise_nature), '') AS enterprise_nature,
  NULLIF(BTRIM(d.business_type), '') AS business_type,
  d.full_time_staff_count,
  d.fund_practitioner_count,
  NULLIF(BTRIM(d.mgmt_scale_range), '') AS mgmt_scale_range,
  NULLIF(BTRIM(d.actual_controller), '') AS actual_controller,
  NULLIF(BTRIM(d.is_member), '') AS is_member,
  NULLIF(BTRIM(d.website_url), '') AS website_url,
  NULLIF(BTRIM(COALESCE(d.detail_url, m.detail_url)), '') AS detail_url,
  GREATEST(m.updated_at, d.updated_at) AS updated_at
`

async function loadManagerByCode(code: string): Promise<ManagerSqlRow | null> {
  const rows = await query<ManagerSqlRow>(
    `SELECT ${MANAGER_SELECT}
     FROM amac_managers m
     LEFT JOIN amac_manager_details d ON d.registration_no = m.registration_no
     WHERE UPPER(BTRIM(m.registration_no)) = UPPER($1)
     LIMIT 1`,
    [code],
  )
  return rows[0] ?? null
}

async function loadManagerByName(name: string): Promise<ManagerSqlRow | null> {
  const rows = await query<ManagerSqlRow>(
    `SELECT ${MANAGER_SELECT}
     FROM amac_managers m
     LEFT JOIN amac_manager_details d ON d.registration_no = m.registration_no
     WHERE m.manager_name = $1
        OR d.manager_name_cn = $1
        OR m.manager_name ILIKE '%' || $1 || '%'
        OR d.manager_name_cn ILIKE '%' || $1 || '%'
     ORDER BY
       CASE
         WHEN m.manager_name = $1 OR d.manager_name_cn = $1 THEN 0
         WHEN m.manager_name ILIKE $1 || '%' OR d.manager_name_cn ILIKE $1 || '%' THEN 1
         ELSE 2
       END,
       LENGTH(m.manager_name) ASC
     LIMIT 1`,
    [name],
  )
  return rows[0] ?? null
}

async function loadManagerExtras(registrationNo: string): Promise<Pick<AmacManagerRow, "executives" | "shareholders">> {
  const [executives, shareholders] = await Promise.all([
    query<{
      person_name: string
      title: string | null
      has_fund_qualification: string | null
      qualification_method: string | null
    }>(
      `SELECT
         person_name,
         NULLIF(BTRIM(title), '') AS title,
         NULLIF(BTRIM(has_fund_qualification), '') AS has_fund_qualification,
         NULLIF(BTRIM(qualification_method), '') AS qualification_method
       FROM amac_manager_executives
       WHERE registration_no = $1
       ORDER BY person_name, title
       LIMIT 80`,
      [registrationNo],
    ).catch(() => []),
    query<{
      seq: number | null
      investor_name: string
      holding_ratio: string | null
      shareholder_type: string | null
      subscribed_amount: string | null
    }>(
      `SELECT
         seq,
         investor_name,
         NULLIF(BTRIM(holding_ratio), '') AS holding_ratio,
         NULLIF(BTRIM(shareholder_type), '') AS shareholder_type,
         NULLIF(BTRIM(subscribed_amount), '') AS subscribed_amount
       FROM amac_manager_shareholders
       WHERE registration_no = $1
       ORDER BY seq NULLS LAST, investor_name
       LIMIT 80`,
      [registrationNo],
    ).catch(() => []),
  ])
  return {
    executives: executives.map((row) => ({
      person_name: row.person_name,
      title: textOrNull(row.title),
      has_fund_qualification: textOrNull(row.has_fund_qualification),
      qualification_method: textOrNull(row.qualification_method),
    })),
    shareholders: shareholders.map((row) => ({
      seq: intOrNull(row.seq),
      investor_name: row.investor_name,
      holding_ratio: textOrNull(row.holding_ratio),
      shareholder_type: textOrNull(row.shareholder_type),
      subscribed_amount: textOrNull(row.subscribed_amount),
    })),
  }
}

function mapManager(row: ManagerSqlRow, extras: Pick<AmacManagerRow, "executives" | "shareholders">): AmacManagerRow {
  return {
    registration_no: row.registration_no,
    manager_name: row.manager_name,
    legal_rep_name: textOrNull(row.legal_rep_name),
    org_type: textOrNull(row.org_type),
    reg_province: textOrNull(row.reg_province),
    reg_city: textOrNull(row.reg_city),
    registered_address: textOrNull(row.registered_address),
    office_address: textOrNull(row.office_address),
    inception_date: dayOrNull(row.inception_date),
    registration_date: dayOrNull(row.registration_date),
    active_fund_count: intOrNull(row.active_fund_count),
    member_type: textOrNull(row.member_type),
    has_alert_info: textOrNull(row.has_alert_info),
    has_integrity_info: textOrNull(row.has_integrity_info),
    registered_capital_cny_wan: textOrNull(row.registered_capital_cny_wan),
    paid_in_capital_cny_wan: textOrNull(row.paid_in_capital_cny_wan),
    paid_in_capital_ratio: textOrNull(row.paid_in_capital_ratio),
    enterprise_nature: textOrNull(row.enterprise_nature),
    business_type: textOrNull(row.business_type),
    full_time_staff_count: intOrNull(row.full_time_staff_count),
    fund_practitioner_count: intOrNull(row.fund_practitioner_count),
    mgmt_scale_range: textOrNull(row.mgmt_scale_range),
    actual_controller: textOrNull(row.actual_controller),
    is_member: textOrNull(row.is_member),
    website_url: textOrNull(row.website_url),
    detail_url: textOrNull(row.detail_url),
    updated_at: tsOrNull(row.updated_at),
    executives: extras.executives,
    shareholders: extras.shareholders,
  }
}

async function resolveManager(code: string, name: string): Promise<ManagerSqlRow | null> {
  if (code) {
    const byCode = await loadManagerByCode(code)
    if (byCode) return byCode
  }
  if (name) return loadManagerByName(name)
  if (code) return loadManagerByName(code)
  return null
}

export async function queryAmacManager(options: {
  code?: string | null
  name_cn?: string | null
}): Promise<AmacCall<AmacManagerRow>> {
  const code = String(options.code ?? "").trim()
  const name = String(options.name_cn ?? "").trim()
  if (!code && !name) return fail(1, "code or name_cn is required")
  const row = await resolveManager(code, name)
  if (!row) return fail(2, `amac manager not found: ${code || name}`)
  const extras = await loadManagerExtras(row.registration_no)
  return ok(mapManager(row, extras))
}

export async function queryAmacManagerFunds(options: {
  code?: string | null
  name_cn?: string | null
  working_state?: string | null
  page?: string | number | null
  pagesize?: string | number | null
}): Promise<AmacCall<AmacFundPage & { registration_no: string; manager_name: string }>> {
  const code = String(options.code ?? "").trim()
  const name = String(options.name_cn ?? "").trim()
  if (!code && !name) return fail(1, "code or name_cn is required")
  const manager = await resolveManager(code, name)
  if (!manager) return fail(2, `amac manager not found: ${code || name}`)

  const workingState = String(options.working_state ?? "").trim()
  const page = Math.max(1, parsePage(options.page, 1))
  const pagesize = Math.min(100, Math.max(1, parsePage(options.pagesize, 20)))
  const names = [...new Set([manager.list_manager_name, manager.manager_name].map((name) => name.trim()).filter(Boolean))]
  const params: unknown[] = [names]
  let where = "manager_name = ANY($1::text[])"
  if (workingState) {
    params.push(workingState)
    where += ` AND working_state = $${params.length}`
  }

  const countRows = await query<{ n: string }>(
    `SELECT (
       (SELECT COUNT(*) FROM amac_private_funds WHERE ${where})
       + (SELECT COUNT(*) FROM amac_futures_products WHERE ${where})
     )::text AS n`,
    params,
  )
  const total = parseInt(countRows[0]?.n ?? "0", 10) || 0
  const offset = (page - 1) * pagesize
  const listParams = [...params, pagesize, offset]
  const rows = await query<FundSqlRow>(
    `SELECT * FROM (${FUND_UNION(where)}) s
     ORDER BY put_on_record_date DESC NULLS LAST, fund_no
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams,
  )
  return ok({
    registration_no: manager.registration_no,
    manager_name: manager.manager_name,
    list: rows.map(mapFund),
    total,
    page,
    pagesize,
  })
}
