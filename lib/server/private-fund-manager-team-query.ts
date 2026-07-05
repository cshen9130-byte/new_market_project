import { query } from "@/lib/db"
import {
  lookupManagerTeamSeed,
  type FundManagerProfile,
  type ManagerExecutive,
  type ManagerTeamSeed,
  type WorkHistoryEntry,
} from "@/lib/ma/manager-team-seed"
import { lookupManagerByRegistrationNo } from "@/lib/server/private-fund-manager-query"

export interface ManagerTeamData {
  executives: ManagerExecutive[]
  legal_rep_name: string | null
  work_history: WorkHistoryEntry[]
  team_members: string | null
  fund_managers: FundManagerProfile[]
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

function mergeFundManagers(
  seed: FundManagerProfile[],
  fromDb: FundManagerProfile[],
): FundManagerProfile[] {
  const seen = new Set<string>()
  const merged: FundManagerProfile[] = []
  for (const item of [...seed, ...fromDb]) {
    const key = item.name.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push(item)
  }
  return merged
}

export async function loadManagerTeamData(registrationNo: string): Promise<ManagerTeamData | null> {
  const manager = await lookupManagerByRegistrationNo(registrationNo)
  if (!manager) return null

  const seed = lookupManagerTeamSeed(registrationNo)
  const dbFundManagers = await loadFundManagersFromDb(manager.manager_name)

  const empty: ManagerTeamSeed = {
    executives: [],
    legal_rep_name: null,
    work_history: [],
    team_members: null,
    fund_managers: [],
  }
  const base = seed ?? empty

  return {
    executives: base.executives,
    legal_rep_name: base.legal_rep_name,
    work_history: base.work_history,
    team_members: base.team_members,
    fund_managers: mergeFundManagers(base.fund_managers, dbFundManagers),
  }
}
