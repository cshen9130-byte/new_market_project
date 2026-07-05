import { lookupManagerNewsSeed, MANAGER_NEWS_DISCLAIMER } from "@/lib/ma/manager-news-seed"
import { lookupManagerByRegistrationNo } from "@/lib/server/private-fund-manager-query"

export async function loadManagerNews(registrationNo: string) {
  const manager = await lookupManagerByRegistrationNo(registrationNo)
  if (!manager) return null

  const seed = lookupManagerNewsSeed(registrationNo)
  return {
    manager_name: manager.manager_name,
    disclaimer: MANAGER_NEWS_DISCLAIMER,
    items: seed.items,
  }
}
