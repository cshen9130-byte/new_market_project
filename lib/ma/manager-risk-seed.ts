export interface RiskSummaryCounts {
  public_opinion: number
  integrity: number
  prompt: number
  operating_abnormal: number
  legal: number
  court_announcement: number
  regulatory: number
}

export interface PublicOpinionRow {
  date: string
  title: string
  sentiment: string
  source: string
}

export interface RegulatoryMeasureRow {
  date: string
  title: string
  source: string
}

export interface IntegrityRow {
  prompt_content: string
  reason: string
}

export interface PromptRow {
  prompt_content: string
  description: string
}

export interface OperatingAbnormalRow {
  inclusion_date: string
  reason: string
  removal_date: string | null
  removal_reason: string | null
}

export interface LegalProceedingRow {
  case_name: string
  case_type: string
  cause: string
  result: string
}

export interface CourtAnnouncementRow {
  announcement_type: string
  cause: string
  parties: string
  court_name: string
  publish_date: string
}

export interface ManagerRiskSeed {
  public_opinion: PublicOpinionRow[]
  regulatory_measures: RegulatoryMeasureRow[]
  integrity: IntegrityRow[]
  prompts: PromptRow[]
  operating_abnormal: OperatingAbnormalRow[]
  legal_proceedings: LegalProceedingRow[]
  court_announcements: CourtAnnouncementRow[]
}

const EMPTY_RISK: ManagerRiskSeed = {
  public_opinion: [],
  regulatory_measures: [],
  integrity: [],
  prompts: [],
  operating_abnormal: [],
  legal_proceedings: [],
  court_announcements: [],
}

const SEED_BY_REGISTRATION: Record<string, ManagerRiskSeed> = {
  P1017741: { ...EMPTY_RISK },
}

export function lookupManagerRiskSeed(registrationNo: string): ManagerRiskSeed {
  return SEED_BY_REGISTRATION[registrationNo.trim()] ?? { ...EMPTY_RISK }
}

export function buildRiskSummary(seed: ManagerRiskSeed): RiskSummaryCounts {
  return {
    public_opinion: seed.public_opinion.length,
    integrity: seed.integrity.length,
    prompt: seed.prompts.length,
    operating_abnormal: seed.operating_abnormal.length,
    legal: seed.legal_proceedings.length,
    court_announcement: seed.court_announcements.length,
    regulatory: seed.regulatory_measures.length,
  }
}
