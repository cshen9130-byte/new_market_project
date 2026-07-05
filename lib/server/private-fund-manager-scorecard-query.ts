import { lookupManagerScorecardSeed } from "@/lib/ma/manager-scorecard-seed"
import { lookupManagerByRegistrationNo } from "@/lib/server/private-fund-manager-query"

export async function loadManagerScorecard(registrationNo: string) {
  const manager = await lookupManagerByRegistrationNo(registrationNo)
  if (!manager) return null

  const seed = lookupManagerScorecardSeed(registrationNo)
  return {
    manager_name: manager.manager_name,
    templates: seed.templates,
    overview: seed.overview,
    details_by_key: seed.details_by_key,
  }
}
