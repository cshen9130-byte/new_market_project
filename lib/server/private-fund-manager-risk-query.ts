import { buildRiskSummary, lookupManagerRiskSeed } from "@/lib/ma/manager-risk-seed"
import { lookupManagerByRegistrationNo } from "@/lib/server/private-fund-manager-query"

export async function loadManagerRisk(registrationNo: string) {
  const manager = await lookupManagerByRegistrationNo(registrationNo)
  if (!manager) return null

  const seed = lookupManagerRiskSeed(registrationNo)
  return {
    manager_name: manager.manager_name,
    summary: buildRiskSummary(seed),
    public_opinion: seed.public_opinion,
    regulatory_measures: seed.regulatory_measures,
    integrity: seed.integrity,
    prompts: seed.prompts,
    operating_abnormal: seed.operating_abnormal,
    legal_proceedings: seed.legal_proceedings,
    court_announcements: seed.court_announcements,
  }
}
