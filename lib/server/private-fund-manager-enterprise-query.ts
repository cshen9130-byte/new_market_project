import { lookupManagerEnterpriseSeed } from "@/lib/ma/manager-enterprise-seed"
import { lookupManagerByRegistrationNo } from "@/lib/server/private-fund-manager-query"

export async function loadManagerEnterprise(registrationNo: string) {
  const manager = await lookupManagerByRegistrationNo(registrationNo)
  if (!manager) return null

  const seed = lookupManagerEnterpriseSeed(registrationNo)
  if (!seed) {
    return {
      manager_name: manager.manager_name,
      registration: {
        full_name: manager.manager_name,
        short_name: manager.manager_name,
        legal_representative: null,
        registration_no: manager.registration_no,
        registration_date: null,
        inception_date: manager.inception_date,
        member_type: manager.member_type,
        business_reg_no: null,
        unified_credit_code: null,
        business_term: null,
        business_scope: null,
        registered_capital: null,
        paid_in_capital: null,
        actual_controller: null,
        institution_type: "私募证券投资基金管理人",
        mgmt_scale: manager.mgmt_scale,
        enterprise_nature: null,
        third_party_advisor: null,
        operating_status: null,
        office_address: null,
        registered_address: null,
      },
      shareholders: [],
      external_investments: [],
      branches: [],
      annual_reports: [],
      change_records: [],
    }
  }

  return {
    manager_name: manager.manager_name,
    registration: {
      ...seed.registration,
      registration_no: seed.registration.registration_no || manager.registration_no,
      inception_date: seed.registration.inception_date || manager.inception_date,
      mgmt_scale: seed.registration.mgmt_scale || manager.mgmt_scale,
      member_type: seed.registration.member_type ?? manager.member_type,
    },
    shareholders: seed.shareholders,
    external_investments: seed.external_investments,
    branches: seed.branches,
    annual_reports: seed.annual_reports,
    change_records: seed.change_records,
  }
}
