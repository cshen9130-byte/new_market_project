/** Shared loader for team tracking pool tabs — DB is the source of truth for labels and order. */

/** Hidden from every account: sidebar, pickers, membership chips. Data stays in DB. */
export const HIDDEN_TEAM_POOL_KEYS = new Set(["bfl_ops", "bfl"])

export function isHiddenTeamPoolKey(poolKey: string | null | undefined): boolean {
  return !!poolKey && HIDDEN_TEAM_POOL_KEYS.has(poolKey)
}

export function filterVisibleTeamPools<T extends { key?: string; pool_key?: string }>(pools: T[]): T[] {
  return pools.filter((p) => !isHiddenTeamPoolKey(p.key ?? p.pool_key))
}

const FALLBACK_TEAM_POOLS = [
  { key: "jy_ops", label: "JY运维池" },
  { key: "jy", label: "JY跟踪池" },
]

export function isMineTrackingPoolKey(poolKey: string): boolean {
  return poolKey === "mine_default" || poolKey.startsWith("mine_custom_")
}

export function splitFundPoolMemberships(
  pools: { pool_key: string; pool_label: string }[],
): {
  teamPools: { pool_key: string; pool_label: string }[]
  inMine: boolean
  inTeam: boolean
} {
  const teamPools: { pool_key: string; pool_label: string }[] = []
  let inMine = false
  for (const pool of pools) {
    if (isMineTrackingPoolKey(pool.pool_key)) inMine = true
    else if (!isHiddenTeamPoolKey(pool.pool_key)) teamPools.push(pool)
  }
  return { teamPools, inMine, inTeam: teamPools.length > 0 }
}

export async function fetchTeamPoolOptions(): Promise<{ key: string; label: string }[]> {
  try {
    const res = await fetch("/ma/api/tracking-funds/pools?scope=team", { cache: "no-store" })
    const d = await res.json()
    if (!Array.isArray(d?.data) || d.data.length === 0) return FALLBACK_TEAM_POOLS
    const visible = filterVisibleTeamPools(
      d.data
        .filter((p: { pool_key?: string }) => p?.pool_key && !String(p.pool_key).startsWith("__"))
        .map((p: { pool_key: string; label: string }) => ({ key: p.pool_key, label: p.label })),
    )
    return visible.length > 0 ? visible : FALLBACK_TEAM_POOLS
  } catch {
    return FALLBACK_TEAM_POOLS
  }
}
