export type SavedTeamStrategy = {
  strategy_l1: string
  strategy_l2: string
  strategy_l3: string
}

export type SavedTeamStrategiesMap = Record<string, SavedTeamStrategy>

export async function fetchSavedTeamStrategies(
  beianHaos: string[],
): Promise<SavedTeamStrategiesMap> {
  const ids = [...new Set(beianHaos.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) return {}

  const res = await fetch("/ma/api/private-funds/batch-company-strategies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "fetch", beian_haos: ids }),
  })
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error((json as { error?: string }).error ?? "加载团队策略失败")
  }
  const json = (await res.json()) as { strategies?: SavedTeamStrategiesMap }
  return json.strategies ?? {}
}

export type TeamStrategySyncUpdate = {
  beian_hao: string
  strategy_l1: string
  strategy_l2: string
  strategy_l3: string
}

export async function syncTeamStrategiesToDatabase(
  updates: TeamStrategySyncUpdate[],
): Promise<{ updated: number }> {
  if (updates.length === 0) return { updated: 0 }

  const res = await fetch("/ma/api/private-funds/batch-company-strategies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "sync", updates }),
  })
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error((json as { error?: string }).error ?? "同步团队策略失败")
  }
  const json = (await res.json()) as { updated?: number }
  return { updated: json.updated ?? updates.length }
}

function norm(value: string | null | undefined): string {
  return (value ?? "").trim()
}

export function hasSavedTeamStrategy(saved: SavedTeamStrategy | undefined): boolean {
  if (!saved) return false
  return Boolean(saved.strategy_l1 || saved.strategy_l2 || saved.strategy_l3)
}

export function getStrategyCellMatchStatus(
  tableValue: string,
  savedValue: string,
  hasSaved: boolean,
): "match" | "mismatch" | "none" {
  const table = norm(tableValue)
  const saved = norm(savedValue)
  if (!hasSaved || !saved) {
    if (table && saved && table !== saved) return "mismatch"
    return "none"
  }
  if (!table) return "none"
  return table === saved ? "match" : "mismatch"
}

export function rowHasAnyTableStrategy(row: {
  strategyLevel1: string
  strategyLevel2: string
  strategyLevel3: string
}): boolean {
  return Boolean(
    norm(row.strategyLevel1) || norm(row.strategyLevel2) || norm(row.strategyLevel3),
  )
}
