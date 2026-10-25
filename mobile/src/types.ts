export type UserPermissions = {
  ma?: boolean
  mom?: boolean
  momDataApi?: boolean
  pfInvestmentPool?: boolean
  pfOperations?: boolean
  aiKnowledge?: boolean
  aiResearcher?: boolean
  [key: string]: boolean | undefined
}

export type User = {
  id: string
  name: string
  email: string
  role?: string
  permissions?: UserPermissions
}

export type Pool = {
  pool_key: string
  label: string
}

export type TrackFund = {
  beian_hao: string
  product_name: string
  short_name: string | null
  strategy_l1: string | null
  strategy_l2: string | null
  strategy_l3?: string | null
  manager: string | null
  latest_nav: string | null
  latest_nav_date: string | null
  latest_price_change: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_1y: string | null
}

export type TrackingPage = {
  page: number
  pageSize: number
  total: number
  totalPages: number
  data: TrackFund[]
}

export type SearchProduct = {
  beian_hao: string
  product_name: string
  short_name: string | null
  strategy_one: string | null
  has_nav: boolean | null
}

export type SearchManager = {
  registration_no: string
  manager_name: string
}

export type NavPoint = {
  price_date: string
  nav: string
  cumulative_nav: string
  cum_nav_withdrawal: string
  price_change: string
}

export type FundDetail = {
  partial?: boolean
  info: {
    beian_hao: string
    product_name: string
    short_name?: string | null
    strategy_l1: string | null
    strategy_l2: string | null
    strategy_l3: string | null
    manager: string
    manager_names?: string | null
    inception_date: string | null
    ret_1w: string | null
    ret_1m: string | null
    ret_1y: string | null
    sharpe_1y: string | null
  }
  nav_series: NavPoint[]
  metrics: {
    latest_nav: string | null
    latest_nav_date: string | null
    latest_cum_nav: string | null
    latest_cum_nav_reinvested: string | null
    ret_since_inception: string | null
    ann_ret: string | null
    ytd_ret: string | null
    max_drawdown: string | null
    sharpe_since_inception: string | null
  }
}

export type ManagedProduct = {
  id?: string
  beian_hao: string | null
  product_name: string
  short_name: string | null
  strategy_l1: string | null
  strategy_l2: string | null
  strategy_l3?: string | null
  latest_nav: string | null
  latest_nav_date: string | null
  latest_price_change: string | null
  ret_1w?: string | null
  ret_1m: string | null
  ret_1y?: string | null
  net_asset_value?: string | null
}

export type ManagedProductsPage = {
  page: number
  pageSize: number
  total: number
  totalPages: number
  data: ManagedProduct[]
}

export type FofUnderlyingProduct = {
  id?: string
  beian_hao: string | null
  product_name: string
  short_name: string | null
  strategy_l1: string | null
  latest_nav: string | null
  latest_nav_date: string | null
  latest_price_change: string | null
  first_entry_date?: string | null
}

export type FofUnderlyingPage = {
  page: number
  pageSize: number
  total: number
  totalPages: number
  data: FofUnderlyingProduct[]
}

export type MomUnderlyingRow = {
  id: string
  kind?: string
  beian_hao: string | null
  product_name: string
  account: string
  account_note?: string | null
  note?: string | null
  strategy: string | null
  latest_nav: string | null
  latest_nav_date: string | null
  latest_price_change: string | null
  equity?: string | null
  equity_date?: string | null
}

export type DueDiligenceSchedule = {
  id: string
  title: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  allDay: boolean
  institution: string
  method: "online" | "onsite" | string
  ddType: "first" | "followup" | string
  personnel: string
  reminder?: string
  notifyMethod?: string
  target: string
  recommender?: string
  description?: string
  createdAt?: string
  updatedAt?: string
}

export type InvestmentNoteAssociation = {
  category: string
  name: string
  recordNo: string
}

export type InvestmentNoteRoadshowAssociation = {
  rowId: string
  label: string
  ddDate?: string
  fundCompany?: string
  ddTarget?: string
  representativeProduct?: string
}

export type InvestmentNoteListItem = {
  id: string
  title: string
  preview?: string
  teamShared?: boolean
  tags?: string[]
  creator?: string
  lastModifiedBy?: string
  modifiedDate?: string
  createdDate?: string
  sourceLabel?: string
  hasBody?: boolean
  associations?: InvestmentNoteAssociation[]
  roadshowAssociations?: InvestmentNoteRoadshowAssociation[]
  contentPending?: boolean
}

export type PrivateFundProfile = {
  fund_name: string | null
  fund_type: string | null
  advisor: string | null
  fund_manager: string | null
  register_number: string | null
  inception_date: string | null
  operation_date: string | null
  custodian: string | null
  puton_date: string | null
  open_day: string | null
  redeemable_status: string | null
  fee_purchase: string | null
  add_amount: string | null
  fee_redeem: string | null
  risk_level: string | null
  precautious_line: string | null
  closed_period: string | null
  stop_line: string | null
  lock_period_desc: string | null
  fee_manage_rate: string | null
  fee_trust: string | null
  fee_manage: string | null
  fee_admin_service: string | null
  fee_pay: string | null
  fee_pay_formula: string | null
  updated_at: string | null
}

export type InvestmentNoteDetail = InvestmentNoteListItem & {
  content?: string
  contentVariant?: string
  preview?: string
}


export type ReportKind = "weekly" | "monthly" | "quarterly"

export type ReportNavFrequency = "daily" | "weekly" | "monthly"

export type ReportProductOption = {
  product_name: string
  beian_hao: string | null
  source: "managed" | "private" | "custom_fund"
}

export type ReportNavRange = {
  start: string | null
  end: string | null
  beian_hao?: string | null
}

export type ReportGenerateResult = {
  reportId: string
  reportTitle: string
  previewUrl?: string
  previewDataUrl?: string
  download: { png: string; pdf: string }
  weekStart?: string
  weekEnd?: string
  monthStart?: string
  monthEnd?: string
  periodStart?: string
  periodEnd?: string
}
