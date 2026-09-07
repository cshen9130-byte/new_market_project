import { query } from "@/lib/db"
import {
  lookupManagerTeamSeed,
  type FundManagerProfile,
  type ManagerExecutive,
  type ManagerTeamMember,
  type WorkHistoryEntry,
} from "@/lib/ma/manager-team-seed"
import { lookupManagerByRegistrationNo } from "@/lib/server/private-fund-manager-query"

export interface ManagerTeamData {
  executives: ManagerExecutive[]
  legal_rep_name: string | null
  work_history: WorkHistoryEntry[]
  team_members: ManagerTeamMember[]
  fund_managers: FundManagerProfile[]
}

type ExecutiveRow = {
  person_name: string
  title: string
  has_fund_qualification: string | null
  qualification_method: string | null
}

type ResumeRow = {
  person_name: string
  executive_title: string | null
  period: string | null
  employer: string | null
  department: string | null
  title: string | null
}

function isYes(value: string | null | undefined): boolean {
  const s = (value ?? "").trim()
  return s === "是" || s === "有" || s.toLowerCase() === "true" || s === "1"
}

function splitRoles(title: string): string[] {
  return title
    .split(/[\s、,，;；]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function periodSortKey(period: string): string {
  const match = period.match(/(\d{4})\.(\d{1,2})/)
  if (!match) return "0000-00"
  return `${match[1]}-${match[2].padStart(2, "0")}`
}

function groupExecutives(rows: ExecutiveRow[]): ManagerExecutive[] {
  const byName = new Map<string, ManagerExecutive>()
  for (const row of rows) {
    const name = row.person_name.trim()
    if (!name) continue
    const roles = splitRoles(row.title)
    const existing = byName.get(name)
    if (existing) {
      for (const role of roles) {
        if (!existing.roles.includes(role)) existing.roles.push(role)
      }
      existing.has_fund_qualification =
        existing.has_fund_qualification || isYes(row.has_fund_qualification)
      if (!existing.qualification_note && row.qualification_method?.trim()) {
        existing.qualification_note = row.qualification_method.trim()
      }
      continue
    }
    byName.set(name, {
      name,
      roles: roles.length > 0 ? roles : [row.title.trim()].filter(Boolean),
      has_fund_qualification: isYes(row.has_fund_qualification),
      qualification_note: row.qualification_method?.trim() || "",
    })
  }
  return [...byName.values()]
}

function pickLegalRepName(
  fromManagers: string | null,
  executives: ManagerExecutive[],
  resumes: ResumeRow[],
): string | null {
  const named = fromManagers?.trim() || ""
  if (named) return named
  const fromTitle = executives.find((exec) =>
    exec.roles.some((role) => role.includes("法定代表人") || role.includes("委派代表")),
  )
  if (fromTitle) return fromTitle.name
  const fromResume = resumes.find((row) =>
    (row.executive_title ?? "").includes("法定代表人") ||
    (row.executive_title ?? "").includes("委派代表"),
  )
  return fromResume?.person_name.trim() || null
}

function legalRepWorkHistory(rows: ResumeRow[], legalRepName: string | null): WorkHistoryEntry[] {
  const target = legalRepName?.trim()
  const filtered = target
    ? rows.filter((row) => row.person_name.trim() === target)
    : rows.filter((row) =>
        (row.executive_title ?? "").includes("法定代表人") ||
        (row.executive_title ?? "").includes("委派代表"),
      )
  return filtered
    .map((row) => ({
      period: (row.period ?? "").trim(),
      employer: (row.employer ?? "").trim(),
      department: (row.department ?? "").trim(),
      position: (row.title ?? "").trim(),
    }))
    .filter((row) => row.period || row.employer || row.department || row.position)
    .sort((a, b) => periodSortKey(b.period).localeCompare(periodSortKey(a.period)))
}

function executivesAsFundManagers(executives: ManagerExecutive[]): FundManagerProfile[] {
  return executives
    .filter((exec) => exec.roles.some((role) => /基金经理|投资经理/.test(role)))
    .map((exec) => ({ name: exec.name, bio: null }))
}

async function loadFundManagersFromDb(companyName: string): Promise<FundManagerProfile[]> {
  const rows = await query<{ manager_name: string }>(
    `SELECT DISTINCT manager_name
     FROM private_fund_managers
     WHERE private_fund_manager_company ILIKE $1
     ORDER BY manager_name ASC`,
    [`%${companyName}%`],
  )
  return rows.map((r) => ({ name: r.manager_name, bio: null }))
}

function mergeFundManagers(groups: FundManagerProfile[][]): FundManagerProfile[] {
  const seen = new Set<string>()
  const merged: FundManagerProfile[] = []
  for (const group of groups) {
    for (const item of group) {
      const key = item.name.trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      merged.push(item)
    }
  }
  return merged
}

export async function loadManagerTeamData(registrationNo: string): Promise<ManagerTeamData | null> {
  const manager = await lookupManagerByRegistrationNo(registrationNo)
  if (!manager) return null

  const seed = lookupManagerTeamSeed(registrationNo)
  const managerName = manager.manager_name.trim()

  const [execRows, resumeRows, legalRepRows, personnelRows, dbFundManagers] = await Promise.all([
    query<ExecutiveRow>(
      `SELECT person_name, title, has_fund_qualification, qualification_method
       FROM amac_manager_executives
       WHERE UPPER(registration_no) = UPPER($1)
       ORDER BY id`,
      [registrationNo],
    ),
    query<ResumeRow>(
      `SELECT person_name, executive_title, period, employer, department, title
       FROM amac_manager_executive_resume
       WHERE UPPER(registration_no) = UPPER($1)
       ORDER BY person_name, period`,
      [registrationNo],
    ),
    query<{ legal_rep_name: string | null }>(
      `SELECT legal_rep_name
       FROM amac_managers
       WHERE UPPER(registration_no) = UPPER($1)
       LIMIT 1`,
      [registrationNo],
    ),
    query<{ person_name: string; cert_name: string | null }>(
      `SELECT DISTINCT ON (p.person_name) p.person_name, p.cert_name
       FROM amac_personnel p
       WHERE p.org_user_id = (
         SELECT s.org_user_id
         FROM amac_person_org_stats s
         LEFT JOIN amac_managers m ON m.manager_name = s.org_name
         WHERE s.org_user_id IS NOT NULL
           AND s.org_user_id <> ''
           AND (
             UPPER(m.registration_no) = UPPER($1)
             OR s.org_name = $2
             OR ($2 <> '' AND (
               s.org_name ILIKE '%' || $2 || '%'
               OR $2 ILIKE '%' || s.org_name || '%'
             ))
           )
         ORDER BY
           CASE
             WHEN UPPER(m.registration_no) = UPPER($1) THEN 0
             WHEN s.org_name = $2 THEN 1
             ELSE 2
           END,
           LENGTH(s.org_name) ASC
         LIMIT 1
       )
         AND COALESCE(p.office_state, 1) = 1
         AND COALESCE(p.removed, '') NOT IN ('是', 'true', '1')
       ORDER BY p.person_name, p.cert_name NULLS LAST`,
      [registrationNo, managerName],
    ),
    loadFundManagersFromDb(managerName),
  ])

  const executives = groupExecutives(execRows)
  const legalRepName = pickLegalRepName(
    legalRepRows[0]?.legal_rep_name ?? null,
    executives,
    resumeRows,
  )
  const workHistory = legalRepWorkHistory(resumeRows, legalRepName)
  const teamMembers: ManagerTeamMember[] = personnelRows
    .map((row) => ({
      name: row.person_name.trim(),
      cert_name: row.cert_name?.trim() || null,
    }))
    .filter((row) => row.name)

  return {
    executives: executives.length > 0 ? executives : (seed?.executives ?? []),
    legal_rep_name: legalRepName || seed?.legal_rep_name || null,
    work_history: workHistory.length > 0 ? workHistory : (seed?.work_history ?? []),
    team_members: teamMembers,
    fund_managers: mergeFundManagers([
      seed?.fund_managers ?? [],
      dbFundManagers,
      executivesAsFundManagers(executives),
    ]),
  }
}
