import { query } from "@/lib/db"
import { lookupAmacManagerByName } from "@/lib/server/amac-fund-metadata"

const MIN_ALIAS_LEN = 6

/** Multi-advisor FOF strings — do not treat as a single company name. */
function isCompositeManagerName(name: string): boolean {
  return name.includes("；") || name.includes(";")
}

/**
 * Prefer the AMAC registered legal name when `stored` is the same company
 * written as a shorter prefix (e.g. 上海量派投资 → 上海量派投资管理有限公司).
 * Keep a completely different stored name (manual 要素 override).
 */
export function preferOfficialManagerName(
  stored: string | null | undefined,
  official: string | null | undefined,
): string {
  const a = stored?.trim() ?? ""
  const b = official?.trim() ?? ""
  if (!a) return b
  if (!b) return a
  if (a === b) return b
  if (isCompositeManagerName(a) || isCompositeManagerName(b)) return a
  if (b.startsWith(a) || a.startsWith(b)) return a.length >= b.length ? a : b
  return a
}

export function applyCanonicalManagerNames<T extends { manager: string }>(
  rows: T[],
  map: Map<string, string>,
): T[] {
  return rows.map((row) => {
    const key = row.manager?.trim() ?? ""
    const canonical = key ? map.get(key) : undefined
    if (!canonical || canonical === row.manager) return row
    return { ...row, manager: canonical }
  })
}

/** Map stored manager strings to a unique AMAC registered name when unambiguous. */
export async function mapCanonicalManagerNames(names: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  const map = new Map<string, string>()
  for (const name of unique) map.set(name, name)
  const simple = unique.filter((n) => !isCompositeManagerName(n))
  if (simple.length === 0) return map

  try {
    const rows = await query<{ stored: string; canonical: string }>(
      `WITH input AS (
         SELECT DISTINCT TRIM(x) AS stored
         FROM unnest($1::text[]) AS t(x)
       ),
       hits AS (
         SELECT
           i.stored,
           m.manager_name AS canonical,
           COUNT(*) OVER (PARTITION BY i.stored) AS hit_count
         FROM input i
         JOIN amac_managers m
           ON m.manager_name = i.stored
           OR (LENGTH(i.stored) >= $2 AND m.manager_name LIKE i.stored || '%')
       )
       SELECT stored, canonical
       FROM hits
       WHERE canonical = stored
          OR hit_count = 1`,
      [simple, MIN_ALIAS_LEN],
    )
    for (const row of rows) {
      const stored = row.stored?.trim() ?? ""
      const canonical = row.canonical?.trim() ?? ""
      if (!stored || !canonical) continue
      if (canonical === stored || map.get(stored) === stored) {
        map.set(stored, canonical)
      }
    }
  } catch {
    // amac_managers may be missing in some environments
  }

  return map
}

/** All stored spellings that should match a selected manager filter. */
export async function expandManagerFilterNames(manager: string): Promise<string[]> {
  const name = manager.trim()
  if (!name) return []
  const names = new Set<string>([name])

  try {
    const amac = await lookupAmacManagerByName(name)
    const official = amac?.manager_name?.trim()
    if (official) names.add(official)

    const seeds = [...names]
    const aliases = await query<{ manager: string }>(
      `SELECT DISTINCT TRIM(manager) AS manager
       FROM private_fund_info
       WHERE TRIM(manager) <> ''
         AND manager NOT LIKE '%；%'
         AND manager NOT LIKE '%;%'
         AND (
           TRIM(manager) = ANY($1::text[])
           OR (
             LENGTH(TRIM(manager)) >= $2
             AND EXISTS (
               SELECT 1 FROM unnest($1::text[]) AS t(n)
               WHERE t.n LIKE TRIM(manager) || '%'
                  OR TRIM(manager) LIKE t.n || '%'
             )
           )
         )`,
      [seeds, MIN_ALIAS_LEN],
    )
    for (const row of aliases) {
      const alias = row.manager?.trim()
      if (alias) names.add(alias)
    }
  } catch {
    // optional tables
  }

  return [...names]
}
