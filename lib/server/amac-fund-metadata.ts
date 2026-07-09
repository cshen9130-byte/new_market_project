import { query, fmtIso } from "@/lib/db"

export type AmacFundMetadata = {
  manager_name: string | null
  establish_date: string | null
  put_on_record_date: string | null
  mgmt_scale: string | null
  registration_no: string | null
}

function beianBaseNo(beianHao: string): string {
  const upper = beianHao.trim().toUpperCase()
  if (/[A-Z]$/.test(upper) && upper.length > 1) {
    return upper.replace(/[A-Z]$/, "")
  }
  return upper
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

/** Resolve fund/manager metadata from AMAC PostgreSQL tables (amac_private_funds, amac_managers, amac_manager_details). */
export async function lookupAmacFundMetadata(
  beianHao: string,
  options?: { managerHint?: string | null; registerCode?: string | null },
): Promise<AmacFundMetadata | null> {
  const code = beianHao.trim()
  if (!code) return null

  const base = beianBaseNo(code)
  const managerHint = options?.managerHint?.trim() || null
  const registerCode = options?.registerCode?.trim() || null

  try {
    const fundRows = await query<{
      manager_name: string | null
      establish_date: string | null
      put_on_record_date: string | null
      mgmt_scale: string | null
      registration_no: string | null
    }>(
      `SELECT
         a.manager_name,
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
       WHERE UPPER(a.fund_no) IN (UPPER($1), UPPER($2))
       ORDER BY CASE WHEN UPPER(a.fund_no) = UPPER($1) THEN 0 ELSE 1 END
       LIMIT 1`,
      [code, base, registerCode],
    )

    if (fundRows[0]) {
      const row = fundRows[0]
      return {
        manager_name: row.manager_name?.trim() || null,
        establish_date: fmtDate(row.establish_date),
        put_on_record_date: fmtDate(row.put_on_record_date),
        mgmt_scale: row.mgmt_scale?.trim() || null,
        registration_no: row.registration_no?.trim() || null,
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
