import { query } from "@/lib/db"
import { syncCompanyStrategyCaches } from "@/lib/server/company-strategy-sync"

export type StrategyTriple = {
  l1: string | null
  l2: string | null
  l3: string | null
}

export type ResolvedFundStrategies = {
  beian_hao: string
  product_name: string | null
  company: StrategyTriple
  platform: StrategyTriple
  team: StrategyTriple
}

export function trimStrategyValue(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s ? s : null
}

export function strategyTriple(l1: unknown, l2: unknown, l3: unknown): StrategyTriple {
  return {
    l1: trimStrategyValue(l1),
    l2: trimStrategyValue(l2),
    l3: trimStrategyValue(l3),
  }
}

export function isStrategyEmpty(s: StrategyTriple): boolean {
  return !s.l1 && !s.l2 && !s.l3
}

function firstNonEmptyStrategy(...candidates: StrategyTriple[]): StrategyTriple {
  for (const candidate of candidates) {
    if (!isStrategyEmpty(candidate)) return candidate
  }
  return { l1: null, l2: null, l3: null }
}

function uniqueKeys(beianHao: string, extraKeys: string[] = []): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const raw of [beianHao, ...extraKeys]) {
    const key = String(raw ?? "").trim()
    if (!key) continue
    const upper = key.toUpperCase()
    if (seen.has(upper)) continue
    seen.add(upper)
    keys.push(key)
  }
  return keys
}

/** Load raw 团队策略 + resolved 平台策略 (type6 → BFL → private_fund_info). */
export async function loadResolvedFundStrategies(
  beianHao: string,
  extraKeys: string[] = [],
): Promise<ResolvedFundStrategies> {
  const keys = uniqueKeys(beianHao, extraKeys)
  const primary = keys[0] || beianHao

  const [type6Rows, bflRows, pfiRows] = await Promise.all([
    query<{
      fund_name: string | null
      company_strategy_one: string | null
      company_strategy_two: string | null
      company_strategy_three: string | null
      platform_strategy_one: string | null
      platform_strategy_two: string | null
      platform_strategy_three: string | null
    }>(
      `SELECT fund_name,
              NULLIF(BTRIM(company_strategy_one), '')    AS company_strategy_one,
              NULLIF(BTRIM(company_strategy_two), '')    AS company_strategy_two,
              NULLIF(BTRIM(company_strategy_three), '')  AS company_strategy_three,
              NULLIF(BTRIM(platform_strategy_one), '')   AS platform_strategy_one,
              NULLIF(BTRIM(platform_strategy_two), '')   AS platform_strategy_two,
              NULLIF(BTRIM(platform_strategy_three), '') AS platform_strategy_three
       FROM type6_ops_team_full
       WHERE register_number = ANY($1::text[])
       ORDER BY
         CASE WHEN UPPER(BTRIM(register_number)) = UPPER(BTRIM($2)) THEN 0 ELSE 1 END,
         updated_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [keys, primary],
    ).catch(() => []),
    query<{
      product_name: string | null
      strategy_one: string | null
      strategy_two: string | null
      strategy_three: string | null
    }>(
      `SELECT product_name,
              NULLIF(BTRIM(strategy_one), '')   AS strategy_one,
              NULLIF(BTRIM(strategy_two), '')   AS strategy_two,
              NULLIF(BTRIM(strategy_three), '') AS strategy_three
       FROM private_fund_info_bfl
       WHERE beian_hao = ANY($1::text[])
       LIMIT 1`,
      [keys],
    ).catch(() => []),
    query<{
      product_name: string | null
      strategy_l1: string | null
      strategy_l2: string | null
    }>(
      `SELECT product_name,
              NULLIF(BTRIM(strategy_l1), '') AS strategy_l1,
              NULLIF(BTRIM(strategy_l2), '') AS strategy_l2
       FROM private_fund_info
       WHERE beian_hao = ANY($1::text[])
       LIMIT 1`,
      [keys],
    ).catch(() => []),
  ])

  const type6 = type6Rows[0]
  const bfl = bflRows[0]
  const pfi = pfiRows[0]
  const company = strategyTriple(
    type6?.company_strategy_one,
    type6?.company_strategy_two,
    type6?.company_strategy_three,
  )
  const platform = firstNonEmptyStrategy(
    strategyTriple(
      type6?.platform_strategy_one,
      type6?.platform_strategy_two,
      type6?.platform_strategy_three,
    ),
    strategyTriple(bfl?.strategy_one, bfl?.strategy_two, bfl?.strategy_three),
    strategyTriple(pfi?.strategy_l1, pfi?.strategy_l2, null),
  )
  const team = firstNonEmptyStrategy(company, platform)

  return {
    beian_hao: primary,
    product_name: type6?.fund_name ?? bfl?.product_name ?? pfi?.product_name ?? null,
    company,
    platform,
    team,
  }
}

/** Copy 平台策略 into empty 团队策略 for one fund that already has a type6 row. */
export async function persistEmptyTeamStrategyFromPlatform(
  beianHao: string,
  platform: StrategyTriple,
  productName?: string | null,
): Promise<boolean> {
  if (isStrategyEmpty(platform)) return false

  const result = await query<{ register_number: string }>(
    `UPDATE type6_ops_team_full
     SET company_strategy_one   = $2,
         company_strategy_two   = $3,
         company_strategy_three = $4,
         updated_at = NOW()
     WHERE register_number = $1
       AND COALESCE(
             NULLIF(BTRIM(company_strategy_one), ''),
             NULLIF(BTRIM(company_strategy_two), ''),
             NULLIF(BTRIM(company_strategy_three), '')
           ) IS NULL
     RETURNING register_number`,
    [beianHao, platform.l1, platform.l2, platform.l3],
  )
  if (!result.length) return false

  await syncCompanyStrategyCaches([
    {
      beian_hao: beianHao,
      strategy_l1: platform.l1,
      strategy_l2: platform.l2,
      strategy_l3: platform.l3,
      product_name: productName ?? null,
    },
  ])
  return true
}

export type TeamStrategyBackfillRow = {
  beian_hao: string
  strategy_l1: string | null
  strategy_l2: string | null
  strategy_l3: string | null
  product_name: string | null
}

/** Copy type6 平台策略 → 团队策略 for every product whose team fields are empty. */
export async function backfillAllEmptyTeamStrategiesFromPlatform(): Promise<{
  updated: number
  rows: TeamStrategyBackfillRow[]
}> {
  const rows = await query<{
    register_number: string
    fund_name: string | null
    company_strategy_one: string | null
    company_strategy_two: string | null
    company_strategy_three: string | null
  }>(
    `UPDATE type6_ops_team_full
     SET company_strategy_one   = NULLIF(BTRIM(platform_strategy_one), ''),
         company_strategy_two   = NULLIF(BTRIM(platform_strategy_two), ''),
         company_strategy_three = NULLIF(BTRIM(platform_strategy_three), ''),
         updated_at = NOW()
     WHERE COALESCE(
             NULLIF(BTRIM(company_strategy_one), ''),
             NULLIF(BTRIM(company_strategy_two), ''),
             NULLIF(BTRIM(company_strategy_three), '')
           ) IS NULL
       AND COALESCE(
             NULLIF(BTRIM(platform_strategy_one), ''),
             NULLIF(BTRIM(platform_strategy_two), ''),
             NULLIF(BTRIM(platform_strategy_three), '')
           ) IS NOT NULL
     RETURNING register_number, fund_name,
               company_strategy_one, company_strategy_two, company_strategy_three`,
  )

  const updates: TeamStrategyBackfillRow[] = rows.map((row) => ({
    beian_hao: row.register_number,
    strategy_l1: trimStrategyValue(row.company_strategy_one),
    strategy_l2: trimStrategyValue(row.company_strategy_two),
    strategy_l3: trimStrategyValue(row.company_strategy_three),
    product_name: row.fund_name,
  }))

  const chunkSize = 80
  for (let i = 0; i < updates.length; i += chunkSize) {
    await syncCompanyStrategyCaches(updates.slice(i, i + chunkSize))
  }

  return { updated: updates.length, rows: updates }
}
