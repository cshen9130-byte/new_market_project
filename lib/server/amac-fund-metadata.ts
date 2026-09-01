import { query, fmtIso } from "@/lib/db"

function managerNameBrandHint(managerName: string): string {
  const name = managerName.trim()
  if (!name) return ""
  const stripped = name.replace(
    /^(上海|北京|深圳|广州|杭州|南京|成都|重庆|天津|苏州|宁波|武汉|厦门|青岛|大连|香港)/,
    "",
  )
  if (stripped.length >= 2) return stripped.slice(0, 4)
  const m = name.match(/^([\u4e00-\u9fff]{2})/)
  return m?.[1] ?? ""
}

export type AmacFundMetadata = {
  manager_name: string | null
  /** AMAC 托管人名称 → UI「托管券商」 */
  mandator_name: string | null
  establish_date: string | null
  put_on_record_date: string | null
  mgmt_scale: string | null
  registration_no: string | null
}

/** Resolve AMAC 托管人 (托管券商) by 备案编号, including share-class suffix match. */
export async function lookupAmacMandatorName(beianHao: string): Promise<string | null> {
  const code = beianHao.trim()
  if (!code) return null
  const candidates = amacFundNoCandidates(code)

  try {
    const rows = await query<{ mandator_name: string | null }>(
      `SELECT NULLIF(BTRIM(mandator_name), '') AS mandator_name
       FROM amac_private_funds
       WHERE UPPER(BTRIM(fund_no)) = ANY($1::text[])
       ORDER BY CASE WHEN UPPER(BTRIM(fund_no)) = UPPER($2) THEN 0 ELSE 1 END
       LIMIT 1`,
      [candidates, code],
    )
    if (rows[0]) return rows[0].mandator_name

    const futures = await query<{ mandator_name: string | null }>(
      `SELECT NULLIF(BTRIM(mandator_name), '') AS mandator_name
       FROM amac_futures_products
       WHERE UPPER(BTRIM(fund_no)) = ANY($1::text[])
       ORDER BY CASE WHEN UPPER(BTRIM(fund_no)) = UPPER($2) THEN 0 ELSE 1 END
       LIMIT 1`,
      [candidates, code],
    )
    return futures[0]?.mandator_name ?? null
  } catch {
    // amac tables may not exist in some environments
    return null
  }
}

function beianBaseNo(beianHao: string): string {
  const upper = beianHao.trim().toUpperCase()
  if (/[ABC]$/u.test(upper) && upper.length > 1) {
    return upper.replace(/[ABC]$/u, "")
  }
  return upper
}

/**
 * AMAC `fund_no` is the parent 备案号 (SVN917), not the share-class code (VN917B).
 * Include S-prefix / stripped-letter variants so B类 product pages still resolve
 * 管理人 / 成立日期 / 管理规模.
 */
export function amacFundNoCandidates(beianHao: string): string[] {
  const code = beianHao.trim().toUpperCase()
  if (!code) return []
  const out = new Set<string>([code])
  const stripped = beianBaseNo(code)
  if (stripped) out.add(stripped)
  for (const seed of [...out]) {
    if (seed.startsWith("S") && seed.length > 1) out.add(seed.slice(1))
    else out.add(`S${seed}`)
  }
  return [...out]
}

function fmtDate(d: string | Date | null | undefined): string | null {
  if (!d) return null
  const s = typeof d === "string" ? d : fmtIso(d)
  return s?.slice(0, 10) ?? null
}

type AmacManagerRow = {
  manager_name: string | null
  mgmt_scale: string | null
  registration_no: string
}

async function lookupAmacManagerByRegistrationNo(
  registrationNo: string,
): Promise<AmacManagerRow | null> {
  const rows = await query<AmacManagerRow>(
    `SELECT m.manager_name, d.mgmt_scale_range AS mgmt_scale, m.registration_no
     FROM amac_managers m
     JOIN amac_manager_details d ON d.registration_no = m.registration_no
     WHERE m.registration_no = $1
     LIMIT 1`,
    [registrationNo.trim()],
  )
  return rows[0] ?? null
}

export async function lookupAmacManagerByName(
  managerName: string,
): Promise<AmacManagerRow | null> {
  const name = managerName.trim()
  if (!name) return null

  const rows = await query<AmacManagerRow>(
    `SELECT m.manager_name, d.mgmt_scale_range AS mgmt_scale, m.registration_no
     FROM amac_managers m
     JOIN amac_manager_details d ON d.registration_no = m.registration_no
     WHERE m.manager_name = $1
        OR m.manager_name ILIKE '%' || $1 || '%'
     ORDER BY CASE WHEN m.manager_name = $1 THEN 0 ELSE 1 END, LENGTH(m.manager_name) ASC
     LIMIT 1`,
    [name],
  )
  return rows[0] ?? null
}

export type AmacManagerDetailFields = {
  actual_controller: string | null
  full_time_staff_count: number | null
  fund_practitioner_count: number | null
  mgmt_scale: string | null
  legal_rep_name: string | null
  manager_name_cn: string | null
  registered_address: string | null
  office_address: string | null
  registered_capital_cny_wan: string | null
  paid_in_capital_cny_wan: string | null
  enterprise_nature: string | null
  org_type: string | null
  business_type: string | null
  registration_date: string | null
  inception_date: string | null
  is_investment_advisory_third_party: string | null
  org_code: string | null
}

type AmacManagerDetailRow = {
  actual_controller: string | null
  full_time_staff_count: number | null
  fund_practitioner_count: number | null
  mgmt_scale: string | null
  legal_rep_name: string | null
  manager_name_cn: string | null
  registered_address: string | null
  office_address: string | null
  registered_capital_cny_wan: string | null
  paid_in_capital_cny_wan: string | null
  enterprise_nature: string | null
  org_type: string | null
  business_type: string | null
  registration_date: string | null
  inception_date: string | null
  is_investment_advisory_third_party: string | null
  org_code: string | null
}

const AMAC_MANAGER_DETAIL_SELECT = `
  d.actual_controller,
  COALESCE(d.full_time_staff_count, h.full_time_staff_count, p.staff_count) AS full_time_staff_count,
  COALESCE(d.fund_practitioner_count, h.fund_practitioner_count, p.fund_qualification_count) AS fund_practitioner_count,
  COALESCE(d.mgmt_scale_range, h.mgmt_scale_range) AS mgmt_scale,
  m.legal_rep_name,
  COALESCE(d.manager_name_cn, m.manager_name) AS manager_name_cn,
  COALESCE(d.registered_address, m.reg_location) AS registered_address,
  COALESCE(d.office_address, m.office_location) AS office_address,
  d.registered_capital_cny_wan,
  d.paid_in_capital_cny_wan,
  d.enterprise_nature,
  COALESCE(d.org_type, m.org_type) AS org_type,
  d.business_type,
  COALESCE(d.registration_date::text, m.registration_date::text) AS registration_date,
  COALESCE(d.inception_date::text, m.inception_date::text) AS inception_date,
  d.is_investment_advisory_third_party,
  d.org_code
`

const AMAC_MANAGER_DETAIL_SUPPLEMENT_JOINS = `
  LEFT JOIN LATERAL (
    SELECT full_time_staff_count, fund_practitioner_count, mgmt_scale_range
    FROM amac_manager_metrics_history h
    WHERE h.registration_no = m.registration_no
    ORDER BY h.captured_at DESC
    LIMIT 1
  ) h ON TRUE
  LEFT JOIN LATERAL (
    SELECT staff_count, fund_qualification_count
    FROM amac_person_org_stats p
    WHERE p.org_name = COALESCE(d.manager_name_cn, m.manager_name)
       OR ($2 <> '' AND (
            p.org_name ILIKE '%' || $2 || '%'
            OR $2 ILIKE '%' || p.org_name || '%'
          ))
       OR ($3 <> '' AND p.org_name ILIKE '%' || $3 || '%')
    ORDER BY
      CASE
        WHEN p.org_name = COALESCE(d.manager_name_cn, m.manager_name) THEN 0
        WHEN $2 <> '' AND p.org_name ILIKE '%' || $2 || '%' THEN 1
        WHEN $3 <> '' AND p.org_name ILIKE '%' || $3 || '%' THEN 2
        ELSE 3
      END,
      LENGTH(p.org_name) ASC
    LIMIT 1
  ) p ON TRUE
`

function mapAmacManagerDetailRow(row: AmacManagerDetailRow): AmacManagerDetailFields {
  return {
    actual_controller: row.actual_controller?.trim() || null,
    full_time_staff_count: row.full_time_staff_count ?? null,
    fund_practitioner_count: row.fund_practitioner_count ?? null,
    mgmt_scale: row.mgmt_scale?.trim() || null,
    legal_rep_name: row.legal_rep_name?.trim() || null,
    manager_name_cn: row.manager_name_cn?.trim() || null,
    registered_address: row.registered_address?.trim() || null,
    office_address: row.office_address?.trim() || null,
    registered_capital_cny_wan: row.registered_capital_cny_wan?.trim() || null,
    paid_in_capital_cny_wan: row.paid_in_capital_cny_wan?.trim() || null,
    enterprise_nature: row.enterprise_nature?.trim() || null,
    org_type: row.org_type?.trim() || null,
    business_type: row.business_type?.trim() || null,
    registration_date: fmtDate(row.registration_date),
    inception_date: fmtDate(row.inception_date),
    is_investment_advisory_third_party: row.is_investment_advisory_third_party?.trim() || null,
    org_code: row.org_code?.trim() || null,
  }
}

async function queryAmacManagerDetailRow(
  sql: string,
  params: [string, string, string],
): Promise<AmacManagerDetailFields | null> {
  const rows = await query<AmacManagerDetailRow>(sql, params)
  return rows[0] ? mapAmacManagerDetailRow(rows[0]) : null
}

/** Load manager profile fields from amac_managers + amac_manager_details (+ fallbacks). */
export async function lookupAmacManagerDetail(
  registrationNo: string,
  managerName?: string | null,
): Promise<AmacManagerDetailFields | null> {
  const reg = registrationNo.trim()
  const name = managerName?.trim() || ""
  const brand = name ? managerNameBrandHint(name) : ""

  try {
    if (reg) {
      const byReg = await queryAmacManagerDetailRow(
        `SELECT ${AMAC_MANAGER_DETAIL_SELECT}
         FROM amac_managers m
         LEFT JOIN amac_manager_details d ON d.registration_no = m.registration_no
         ${AMAC_MANAGER_DETAIL_SUPPLEMENT_JOINS}
         WHERE UPPER(m.registration_no) = UPPER($1)
         LIMIT 1`,
        [reg, name, brand],
      )
      if (byReg) return byReg
    }

    if (name) {
      const byName = await queryAmacManagerDetailRow(
        `SELECT ${AMAC_MANAGER_DETAIL_SELECT}
         FROM amac_managers m
         LEFT JOIN amac_manager_details d ON d.registration_no = m.registration_no
         ${AMAC_MANAGER_DETAIL_SUPPLEMENT_JOINS}
         WHERE m.manager_name = $1
            OR m.manager_name ILIKE '%' || $1 || '%'
            OR $1 ILIKE '%' || m.manager_name || '%'
            OR ($3 <> '' AND m.manager_name ILIKE '%' || $3 || '%')
         ORDER BY
           CASE
             WHEN m.manager_name = $1 THEN 0
             WHEN m.manager_name ILIKE '%' || $1 || '%' THEN 1
             WHEN $1 ILIKE '%' || m.manager_name || '%' THEN 2
             ELSE 3
           END,
           LENGTH(m.manager_name) ASC
         LIMIT 1`,
        [name, name, brand],
      )
      if (byName) return byName
    }
  } catch {
    // amac tables may not exist in some environments
  }

  return null
}

/** Resolve fund/manager metadata from AMAC PostgreSQL tables (amac_private_funds, amac_managers, amac_manager_details). */
export async function lookupAmacFundMetadata(
  beianHao: string,
  options?: { managerHint?: string | null; registerCode?: string | null },
): Promise<AmacFundMetadata | null> {
  const code = beianHao.trim()
  if (!code) return null

  const candidates = amacFundNoCandidates(code)
  const managerHint = options?.managerHint?.trim() || null
  const registerCode = options?.registerCode?.trim() || null

  try {
    const fundRows = await query<{
      manager_name: string | null
      mandator_name: string | null
      establish_date: string | null
      put_on_record_date: string | null
      mgmt_scale: string | null
      registration_no: string | null
    }>(
      `SELECT
         a.manager_name,
         NULLIF(BTRIM(a.mandator_name), '') AS mandator_name,
         a.establish_date::text AS establish_date,
         a.put_on_record_date::text AS put_on_record_date,
         COALESCE(d_reg.mgmt_scale_range, d_name.mgmt_scale_range, d_fuzzy.mgmt_scale_range) AS mgmt_scale,
         COALESCE(d_reg.registration_no, d_name.registration_no, d_fuzzy.registration_no) AS registration_no
       FROM amac_private_funds a
       LEFT JOIN amac_manager_details d_reg
         ON d_reg.registration_no = $3
       LEFT JOIN amac_managers m_exact
         ON m_exact.manager_name = a.manager_name
       LEFT JOIN amac_manager_details d_name
         ON d_name.registration_no = m_exact.registration_no
       LEFT JOIN LATERAL (
         SELECT m.registration_no, d.mgmt_scale_range
         FROM amac_managers m
         JOIN amac_manager_details d ON d.registration_no = m.registration_no
         WHERE a.manager_name IS NOT NULL AND BTRIM(a.manager_name) <> ''
           AND m.manager_name ILIKE '%' || a.manager_name || '%'
         ORDER BY LENGTH(m.manager_name) ASC
         LIMIT 1
       ) d_fuzzy ON TRUE
       WHERE UPPER(BTRIM(a.fund_no)) = ANY($1::text[])
       ORDER BY CASE WHEN UPPER(BTRIM(a.fund_no)) = UPPER($2) THEN 0 ELSE 1 END
       LIMIT 1`,
      [candidates, code, registerCode],
    )

    if (fundRows[0]) {
      const row = fundRows[0]
      return {
        manager_name: row.manager_name?.trim() || null,
        mandator_name: row.mandator_name?.trim() || null,
        establish_date: fmtDate(row.establish_date),
        put_on_record_date: fmtDate(row.put_on_record_date),
        mgmt_scale: row.mgmt_scale?.trim() || null,
        registration_no: row.registration_no?.trim() || null,
      }
    }

    const futuresRows = await query<{
      manager_name: string | null
      mandator_name: string | null
      establish_date: string | null
      put_on_record_date: string | null
    }>(
      `SELECT
         manager_name,
         NULLIF(BTRIM(mandator_name), '') AS mandator_name,
         establish_date::text AS establish_date,
         put_on_record_date::text AS put_on_record_date
       FROM amac_futures_products
       WHERE UPPER(BTRIM(fund_no)) = ANY($1::text[])
       ORDER BY CASE WHEN UPPER(BTRIM(fund_no)) = UPPER($2) THEN 0 ELSE 1 END
       LIMIT 1`,
      [candidates, code],
    )
    if (futuresRows[0]) {
      const row = futuresRows[0]
      return {
        manager_name: row.manager_name?.trim() || null,
        mandator_name: row.mandator_name?.trim() || null,
        establish_date: fmtDate(row.establish_date),
        put_on_record_date: fmtDate(row.put_on_record_date),
        mgmt_scale: null,
        registration_no: null,
      }
    }
  } catch {
    // amac tables may not exist in some environments
  }

  try {
    if (registerCode) {
      const byReg = await lookupAmacManagerByRegistrationNo(registerCode)
      if (byReg) {
        return {
          manager_name: byReg.manager_name?.trim() || null,
          mandator_name: null,
          establish_date: null,
          put_on_record_date: null,
          mgmt_scale: byReg.mgmt_scale?.trim() || null,
          registration_no: byReg.registration_no?.trim() || null,
        }
      }
    }

    if (managerHint) {
      const byName = await lookupAmacManagerByName(managerHint)
      if (byName) {
        return {
          manager_name: byName.manager_name?.trim() || null,
          mandator_name: null,
          establish_date: null,
          put_on_record_date: null,
          mgmt_scale: byName.mgmt_scale?.trim() || null,
          registration_no: byName.registration_no?.trim() || null,
        }
      }
    }
  } catch {
    // amac tables may not exist in some environments
  }

  return null
}
