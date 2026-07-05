export interface ManagerNewsItem {
  id: string
  title: string
  published_at: string
  source: string
  summary: string | null
  url: string | null
}

export interface ManagerNewsSeed {
  items: ManagerNewsItem[]
}

const SEED_BY_REGISTRATION: Record<string, ManagerNewsSeed> = {
  P1017741: { items: [] },
}

export function lookupManagerNewsSeed(registrationNo: string): ManagerNewsSeed {
  return SEED_BY_REGISTRATION[registrationNo.trim()] ?? { items: [] }
}

export const MANAGER_NEWS_DISCLAIMER =
  "本页面资讯来源于管理人的微信公众号，仅供参考，不作为任何投资依据或推介。"
