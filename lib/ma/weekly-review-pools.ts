/** Pools the weekly review Excel can be built from. Shared by the page and the API. */

export type WeeklyReviewPoolKey = "jy" | "selected"

export const DEFAULT_WEEKLY_REVIEW_POOLS: WeeklyReviewPoolKey[] = ["jy"]

const ORDER: WeeklyReviewPoolKey[] = ["jy", "selected"]

function pushTokens(input: unknown, tokens: string[]) {
  if (typeof input !== "string") return
  for (const part of input.split(/[,，\s]+/)) {
    const token = part.trim().toLowerCase()
    if (token) tokens.push(token)
  }
}

/** Accept all, jy, selected, Chinese labels, or a mix. Empty input stays on the tracking pool. */
export function normalizeWeeklyReviewPools(input: unknown): WeeklyReviewPoolKey[] {
  const tokens: string[] = []
  if (Array.isArray(input)) {
    for (const item of input) pushTokens(item, tokens)
  } else if (typeof input === "string") {
    pushTokens(input, tokens)
  } else if (input != null && input !== "") {
    return [...DEFAULT_WEEKLY_REVIEW_POOLS]
  }
  if (tokens.length === 0) return [...DEFAULT_WEEKLY_REVIEW_POOLS]
  if (tokens.some((token) => token === "all" || token === "全部")) return [...ORDER]

  const picked = new Set<WeeklyReviewPoolKey>()
  for (const token of tokens) {
    if (token === "jy" || token === "tracking" || token === "jy跟踪池") picked.add("jy")
    if (token === "selected" || token === "jy精选池" || token === "精选池") picked.add("selected")
  }
  const out = ORDER.filter((key) => picked.has(key))
  return out.length > 0 ? out : [...DEFAULT_WEEKLY_REVIEW_POOLS]
}

/** Short label used in the file name and the page title. */
export function weeklyReviewPoolFileLabel(pools: WeeklyReviewPoolKey[]): string {
  const keys = normalizeWeeklyReviewPools(pools)
  const hasJy = keys.includes("jy")
  const hasSelected = keys.includes("selected")
  if (hasJy && hasSelected) return "全部"
  if (hasSelected) return "JY精选池"
  return "JY跟踪池"
}

/** Phrase used in copy and the workbook sample-scope note. */
export function weeklyReviewPoolScopePhrase(pools: WeeklyReviewPoolKey[]): string {
  const keys = normalizeWeeklyReviewPools(pools)
  const hasJy = keys.includes("jy")
  const hasSelected = keys.includes("selected")
  if (hasJy && hasSelected) return "JY跟踪池和JY精选池"
  if (hasSelected) return "JY精选池"
  return "JY跟踪池"
}

/**
 * Selecting all keeps both pools. Clicking one pool while both are on keeps only that pool.
 * Clicking the other pool adds it. The last remaining pool stays selected.
 */
export function toggleWeeklyReviewPool(
  current: WeeklyReviewPoolKey[],
  key: "all" | WeeklyReviewPoolKey,
): WeeklyReviewPoolKey[] {
  const pools = normalizeWeeklyReviewPools(current)
  if (key === "all") return [...ORDER]
  const allOn = pools.includes("jy") && pools.includes("selected")
  if (allOn) return [key]
  if (pools.includes(key)) {
    if (pools.length <= 1) return pools
    return pools.filter((item) => item !== key)
  }
  return ORDER.filter((item) => item === key || pools.includes(item))
}
