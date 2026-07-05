export interface ManagerExecutive {
  name: string
  roles: string[]
  has_fund_qualification: boolean
  qualification_note: string
}

export interface WorkHistoryEntry {
  period: string
  employer: string
  department: string
  position: string
}

export interface FundManagerProfile {
  name: string
  bio: string | null
}

export interface ManagerTeamSeed {
  executives: ManagerExecutive[]
  legal_rep_name: string | null
  work_history: WorkHistoryEntry[]
  team_members: string | null
  fund_managers: FundManagerProfile[]
}

const SEED_BY_REGISTRATION: Record<string, ManagerTeamSeed> = {
  P1017741: {
    executives: [
      {
        name: "戴宁斌",
        roles: ["法定代表人", "合规风控负责人", "信息填报负责人"],
        has_fund_qualification: true,
        qualification_note: "通过考试取得",
      },
      {
        name: "廖楚原",
        roles: ["总经理"],
        has_fund_qualification: true,
        qualification_note: "通过考试取得",
      },
    ],
    legal_rep_name: "戴宁斌",
    work_history: [
      {
        period: "2023.08 - ",
        employer: "上海荣熙私募基金管理有限公司",
        department: "上海荣熙私募基金管理有限公司总部",
        position: "法定代表人, 合规风控负责人, 信息填报负责人",
      },
      {
        period: "2023.04 - 2023.08",
        employer: "上海荣熙私募基金管理有限公司",
        department: "上海荣熙私募基金管理有限公司总部",
        position: "法定代表人",
      },
      {
        period: "2023.01 - 2023.04",
        employer: "上海奔辛信息科技有限公司",
        department: "总部",
        position: "总经理",
      },
      {
        period: "2022.11 - 2023.03",
        employer: "上海荣熙私募基金管理有限公司",
        department: "合规风控部",
        position: "合规风控专员",
      },
      {
        period: "2021.12 - 2022.11",
        employer: "上海荣熙私募基金管理有限公司",
        department: "上海荣熙私募基金管理有限公司合规风控部",
        position: "合规风控负责人, 信息填报负责人",
      },
      {
        period: "2021.12 - 2021.12",
        employer: "荣熙财富投资管理（上海）有限公司",
        department: "荣熙财富投资管理（上海）有限公司合规风控部",
        position: "合规风控负责人",
      },
      {
        period: "2013.08 - 2021.11",
        employer: "上海荣熙资产管理有限公司",
        department: "合规风控部",
        position: "合规风控负责人",
      },
      {
        period: "2010.11 - 2013.07",
        employer: "浙江新世纪期货有限公司",
        department: "温州营业部、资产管理总部",
        position: "营业部副总经理、资产管理风控负责人",
      },
      {
        period: "2010.03 - 2010.10",
        employer: "招商证券",
        department: "杭州营业部",
        position: "客户经理",
      },
    ],
    team_members: null,
    fund_managers: [
      { name: "朱维昌", bio: null },
      { name: "邹海涛", bio: null },
    ],
  },
}

export function lookupManagerTeamSeed(registrationNo: string): ManagerTeamSeed | null {
  return SEED_BY_REGISTRATION[registrationNo.trim()] ?? null
}
