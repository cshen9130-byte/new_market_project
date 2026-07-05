export interface ScorecardOverviewRow {
  id: string
  name: string
  score: number | null
  score_date: string
  template_name: string
  creator: string
  last_modified: string
}

export interface ScorecardDetailRow {
  category: string
  indicator: string
  weight: string | null
  score: number | null
  remark: string | null
}

export interface ScorecardTemplateOption {
  id: string
  name: string
}

export interface ManagerScorecardSeed {
  templates: ScorecardTemplateOption[]
  overview: ScorecardOverviewRow[]
  details_by_key: Record<string, ScorecardDetailRow[]>
}

const EMPTY_SCORECARD: ManagerScorecardSeed = {
  templates: [],
  overview: [],
  details_by_key: {},
}

const SEED_BY_REGISTRATION: Record<string, ManagerScorecardSeed> = {
  P1017741: { ...EMPTY_SCORECARD },
}

export function lookupManagerScorecardSeed(registrationNo: string): ManagerScorecardSeed {
  return SEED_BY_REGISTRATION[registrationNo.trim()] ?? {
    templates: [],
    overview: [],
    details_by_key: {},
  }
}
