export interface RegistrationInfo {
  full_name: string
  short_name: string
  legal_representative: string | null
  registration_no: string
  registration_date: string | null
  inception_date: string | null
  member_type: string | null
  business_reg_no: string | null
  unified_credit_code: string | null
  business_term: string | null
  business_scope: string | null
  registered_capital: string | null
  paid_in_capital: string | null
  actual_controller: string | null
  institution_type: string | null
  mgmt_scale: string | null
  enterprise_nature: string | null
  third_party_advisor: string | null
  operating_status: string | null
  office_address: string | null
  registered_address: string | null
}

export interface ShareholderRow {
  name: string
  shareholder_type: string
  holding_ratio: string
  subscribed_amount: string
}

export interface ExternalInvestmentRow {
  enterprise_name: string
  registered_capital: string
  registration_date: string
}

export interface BranchRow {
  org_name: string
  related_name: string
}

export interface AnnualReportRow {
  year: number
  employee_count: string
  pledge_or_equity_purchase: string
  equity_transfer: string
}

export interface ChangeRecordRow {
  change_date: string
  change_type: string
  before_value: string
  after_value: string
}

export interface ManagerEnterpriseSeed {
  registration: RegistrationInfo
  shareholders: ShareholderRow[]
  external_investments: ExternalInvestmentRow[]
  branches: BranchRow[]
  annual_reports: AnnualReportRow[]
  change_records: ChangeRecordRow[]
}

const SEED_BY_REGISTRATION: Record<string, ManagerEnterpriseSeed> = {
  P1017741: {
    registration: {
      full_name: "上海荣熙私募基金管理有限公司",
      short_name: "上海荣熙",
      legal_representative: "戴宁斌",
      registration_no: "P1017741",
      registration_date: "2015-07-09",
      inception_date: "2015-06-14",
      member_type: null,
      business_reg_no: "310141002163514",
      unified_credit_code: "91310000342223677U",
      business_term: "2015-06-15 至 2045-06-14",
      business_scope:
        "一般项目：私募证券投资基金管理服务（须在中国证券投资基金业协会完成登记备案后方可从事经营活动）。（除依法须经批准的项目外，凭营业执照依法自主开展经营活动）",
      registered_capital: "1000（万元）",
      paid_in_capital: "1000（万元）",
      actual_controller: "余楚荣",
      institution_type: "私募证券投资基金管理人",
      mgmt_scale: "5-10亿元",
      enterprise_nature: "内资企业",
      third_party_advisor: null,
      operating_status: "存续",
      office_address: "上海市浦东新区源深路1588号1903室",
      registered_address:
        "上海市浦东新区中国(上海)自由贸易试验区浦东大道1868号1917室",
    },
    shareholders: [
      {
        name: "上海典章信息科技有限公司",
        shareholder_type: "法人股东",
        holding_ratio: "98.00%",
        subscribed_amount: "980.0万元人民币",
      },
      {
        name: "余楚荣",
        shareholder_type: "自然人股东",
        holding_ratio: "2.00%",
        subscribed_amount: "20.0万元人民币",
      },
    ],
    external_investments: [],
    branches: [],
    annual_reports: [
      { year: 2024, employee_count: "12人", pledge_or_equity_purchase: "无", equity_transfer: "否" },
      { year: 2023, employee_count: "12人", pledge_or_equity_purchase: "无", equity_transfer: "否" },
      { year: 2022, employee_count: "12人", pledge_or_equity_purchase: "无", equity_transfer: "否" },
      { year: 2021, employee_count: "12人", pledge_or_equity_purchase: "无", equity_transfer: "否" },
      { year: 2020, employee_count: "12人", pledge_or_equity_purchase: "无", equity_transfer: "否" },
      { year: 2019, employee_count: "11人", pledge_or_equity_purchase: "无", equity_transfer: "否" },
      { year: 2018, employee_count: "10人", pledge_or_equity_purchase: "无", equity_transfer: "否" },
      { year: 2017, employee_count: "10人", pledge_or_equity_purchase: "无", equity_transfer: "否" },
      { year: 2016, employee_count: "8人", pledge_or_equity_purchase: "无", equity_transfer: "否" },
      { year: 2015, employee_count: "6人", pledge_or_equity_purchase: "无", equity_transfer: "否" },
    ],
    change_records: [
      {
        change_date: "2024-04-17",
        change_type: "法定代表人变更",
        before_value: "孙延军",
        after_value: "戴宁斌",
      },
      {
        change_date: "2023-02-20",
        change_type: "章程修正案备案",
        before_value: "无",
        after_value: "2023-02-16 章程修正案",
      },
      {
        change_date: "2023-02-20",
        change_type: "住所变更",
        before_value: "中国（上海）自由贸易试验区浦东大道1200号308室",
        after_value: "中国（上海）自由贸易试验区浦东大道1668号1917室",
      },
      {
        change_date: "2022-12-27",
        change_type: "高级管理人员备案",
        before_value: "—",
        after_value: "—",
      },
      {
        change_date: "2022-12-27",
        change_type: "董事备案",
        before_value: "马鹏程 【退出】",
        after_value: "郭海涛 【增进】",
      },
      {
        change_date: "2022-06-15",
        change_type: "注册资本变更",
        before_value: "500（万元）",
        after_value: "1000（万元）",
      },
      {
        change_date: "2021-08-10",
        change_type: "经营范围变更",
        before_value: "投资管理、资产管理",
        after_value: "私募证券投资基金管理服务",
      },
      {
        change_date: "2020-11-03",
        change_type: "股东变更",
        before_value: "上海荣熙资产管理有限公司",
        after_value: "上海典章信息科技有限公司",
      },
    ],
  },
}

export function lookupManagerEnterpriseSeed(registrationNo: string): ManagerEnterpriseSeed | null {
  return SEED_BY_REGISTRATION[registrationNo.trim()] ?? null
}
