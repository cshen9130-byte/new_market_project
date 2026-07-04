/** Shared loader for team tracking pool tabs — DB is the source of truth for labels and order. */

const FALLBACK_TEAM_POOLS = [
  { key: "bfl_ops", label: "bfl 运维池" },
  { key: "bfl", label: "bfl跟踪池" },
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
    else teamPools.push(pool)
  }
  return { teamPools, inMine, inTeam: teamPools.length > 0 }
}

export async function fetchTeamPoolOptions(): Promise<{ key: string; label: string }[]> {
  try {
    const res = await fetch("/ma/api/tracking-funds/pools?scope=team", { cache: "no-store" })
    const d = await res.json()
    if (!Array.isArray(d?.data) || d.data.length === 0) return FALLBACK_TEAM_POOLS
    return d.data
      .filter((p: { pool_key?: string }) => p?.pool_key && !String(p.pool_key).startsWith("__"))
      .map((p: { pool_key: string; label: string }) => ({ key: p.pool_key, label: p.label }))
  } catch {
    return FALLBACK_TEAM_POOLS
  }
}
