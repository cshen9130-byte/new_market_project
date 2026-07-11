import { lookupManagerEnterpriseSeed } from "@/lib/ma/manager-enterprise-seed"
import { lookupAmacManagerDetail } from "@/lib/server/amac-fund-metadata"
import { lookupManagerByRegistrationNo } from "@/lib/server/private-fund-manager-query"

function formatCapitalWan(value: string | null | undefined): string | null {
  const v = value?.trim()
  if (!v) return null
  return v.endsWith("万") ? v : `${v}万`
}

export async function loadManagerEnterprise(registrationNo: string) {
  const manager = await lookupManagerByRegistrationNo(registrationNo)
  if (!manager) return null

  const seed = lookupManagerEnterpriseSeed(registrationNo)
  if (seed) {
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

  const amac = await lookupAmacManagerDetail(registrationNo, manager.manager_name)

  return {
    manager_name: manager.manager_name,
    registration: {
      full_name: amac?.manager_name_cn || manager.manager_name,
      short_name: manager.manager_name,
      legal_representative: amac?.legal_rep_name ?? null,
      registration_no: manager.registration_no,
      registration_date: amac?.registration_date ?? null,
      inception_date: amac?.inception_date || manager.inception_date,
      member_type: manager.member_type,
      business_reg_no: null,
      unified_credit_code: amac?.org_code ?? null,
      business_term: null,
      business_scope: null,
      registered_capital: formatCapitalWan(amac?.registered_capital_cny_wan),
      paid_in_capital: formatCapitalWan(amac?.paid_in_capital_cny_wan),
      actual_controller: amac?.actual_controller ?? null,
      institution_type: amac?.business_type || amac?.org_type || "私募证券投资基金管理人",
      mgmt_scale: amac?.mgmt_scale || manager.mgmt_scale,
      enterprise_nature: amac?.enterprise_nature ?? null,
      third_party_advisor: amac?.is_investment_advisory_third_party ?? null,
      operating_status: null,
      office_address: amac?.office_address ?? null,
      registered_address: amac?.registered_address ?? null,
    },
    shareholders: [],
    external_investments: [],
    branches: [],
    annual_reports: [],
    change_records: [],
  }
}
