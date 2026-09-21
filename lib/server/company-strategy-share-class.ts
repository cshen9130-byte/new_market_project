import { query } from "@/lib/db"
import { mergeStrategyLevel3 } from "@/lib/ma/strategy-level3"
import { syncCompanyStrategyCaches } from "@/lib/server/company-strategy-sync"
import {
  isStrategyEmpty,
  strategyTriple,
  type StrategyTriple,
} from "@/lib/server/fund-strategy-resolve"
import { listFundFamilyProducts } from "@/lib/server/share-class-product"
import { addFundToTrackingPool } from "@/lib/server/tracking-pool-membership"

export type ShareClassFamilyProduct = {
  beian_hao: string
  product_name: string
}

export type FamilyTeamStrategyRow = ShareClassFamilyProduct & {
  strategy_l1: string | null
  strategy_l2: string | null
  strategy_l3: string | null
}

function normalizeBeian(value: string): string {
  return value.trim().toUpperCase()
}

async function updateCompanyStrategy(
  beian_hao: string,
  strategy_l1: string | null,
  strategy_l2: string | null,
  strategy_l3: string | null,
) {
  return query<{ register_number: string }>(
    `UPDATE type6_ops_team_full
     SET company_strategy_one   = $2,
         company_strategy_two   = $3,
         company_strategy_three = $4,
         updated_at = NOW()
     WHERE register_number = $1
     RETURNING register_number`,
    [beian_hao, strategy_l1, strategy_l2, strategy_l3],
  )
}

async function loadFamilyTeamStrategies(
  family: ShareClassFamilyProduct[],
): Promise<FamilyTeamStrategyRow[]> {
  if (family.length === 0) return []
  const ids = family.map((row) => row.beian_hao)
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ")
  const rows = await query<{
    register_number: string
    company_l1: string | null
    company_l2: string | null
    company_l3: string | null
    platform_l1: string | null
    platform_l2: string | null
    platform_l3: string | null
  }>(
    `SELECT register_number,
            NULLIF(BTRIM(company_strategy_one), '')    AS company_l1,
            NULLIF(BTRIM(company_strategy_two), '')    AS company_l2,
            NULLIF(BTRIM(company_strategy_three), '')  AS company_l3,
            NULLIF(BTRIM(platform_strategy_one), '')   AS platform_l1,
            NULLIF(BTRIM(platform_strategy_two), '')   AS platform_l2,
            NULLIF(BTRIM(platform_strategy_three), '') AS platform_l3
     FROM type6_ops_team_full
     WHERE register_number IN (${placeholders})`,
    ids,
  )
  const byBeian = new Map(rows.map((row) => [normalizeBeian(row.register_number), row]))
  return family.map((product) => {
    const hit = byBeian.get(normalizeBeian(product.beian_hao))
    const company = strategyTriple(hit?.company_l1, hit?.company_l2, hit?.company_l3)
    const platform = strategyTriple(hit?.platform_l1, hit?.platform_l2, hit?.platform_l3)
    const effective = isStrategyEmpty(company) ? platform : company
    return {
      ...product,
      strategy_l1: effective.l1,
      strategy_l2: effective.l2,
      strategy_l3: effective.l3,
    }
  })
}

/**
 * A/B/C share classes of one product should share 策略标签.
 * Keep this product's L1/L2 when set; otherwise take a sibling's.
 * Union 三级策略 from siblings with the same L1/L2 (multiple tags allowed).
 */
export function applyShareClassFamilyStrategy(
  currentBeian: string,
  current: StrategyTriple,
  family: FamilyTeamStrategyRow[],
): StrategyTriple {
  const currentKey = normalizeBeian(currentBeian)
  const currentRow = family.find((row) => normalizeBeian(row.beian_hao) === currentKey)
  const currentTeam = currentRow
    ? strategyTriple(currentRow.strategy_l1, currentRow.strategy_l2, currentRow.strategy_l3)
    : current

  let l1 = currentTeam.l1
  let l2 = currentTeam.l2
  if (!l1 && !l2) {
    const sibling = family.find((row) => row.strategy_l1 || row.strategy_l2)
    if (sibling) {
      l1 = sibling.strategy_l1
      l2 = sibling.strategy_l2
    }
  }

  const matchingL3 = family
    .filter((row) => (row.strategy_l1 || "") === (l1 || "") && (row.strategy_l2 || "") === (l2 || ""))
    .map((row) => row.strategy_l3)
  const l3 = mergeStrategyLevel3(currentTeam.l3, ...matchingL3)

  return {
    l1: l1 || null,
    l2: l2 || null,
    l3: l3 || null,
  }
}

export async function loadShareClassFamilyTeamStrategies(
  beianHao: string,
): Promise<{ family: FamilyTeamStrategyRow[]; merged: StrategyTriple }> {
  const family = await listFundFamilyProducts(beianHao)
  const rows = await loadFamilyTeamStrategies(family)
  const current = rows.find((row) => normalizeBeian(row.beian_hao) === normalizeBeian(beianHao))
  const merged = applyShareClassFamilyStrategy(
    beianHao,
    strategyTriple(current?.strategy_l1, current?.strategy_l2, current?.strategy_l3),
    rows,
  )
  return { family: rows, merged }
}

async function ensureTeamStrategyRow(beianHao: string, productName: string): Promise<void> {
  const existing = await query<{ ok: number }>(
    `SELECT 1 AS ok FROM type6_ops_team_full WHERE register_number = $1 LIMIT 1`,
    [beianHao],
  )
  if (existing.length) return
  await addFundToTrackingPool("bfl_ops", beianHao, productName)
}

export async function writeCompanyStrategyAcrossShareClasses(params: {
  beian_hao: string
  product_name?: string | null
  strategy_l1: string | null
  strategy_l2: string | null
  strategy_l3: string | null
}): Promise<{
  updated: string[]
  family: ShareClassFamilyProduct[]
}> {
  const primary = params.beian_hao.trim()
  let family: ShareClassFamilyProduct[] = []
  try {
    family = await listFundFamilyProducts(primary)
  } catch (err) {
    console.error("Share-class family lookup failed:", err)
  }
  const targets: ShareClassFamilyProduct[] = family.length
    ? family
    : [{ beian_hao: primary, product_name: params.product_name?.trim() || primary }]

  if (!targets.some((row) => normalizeBeian(row.beian_hao) === normalizeBeian(primary))) {
    targets.unshift({
      beian_hao: primary,
      product_name: params.product_name?.trim() || primary,
    })
  }

  const updated: string[] = []
  const synced: Array<{
    beian_hao: string
    strategy_l1: string | null
    strategy_l2: string | null
    strategy_l3: string | null
    product_name: string | null
  }> = []

  for (const target of targets) {
    const productName = target.product_name?.trim()
      || (normalizeBeian(target.beian_hao) === normalizeBeian(primary) ? (params.product_name || target.beian_hao) : target.beian_hao)
    let result = await updateCompanyStrategy(
      target.beian_hao,
      params.strategy_l1,
      params.strategy_l2,
      params.strategy_l3,
    )
    if (!result.length) {
      try {
        await ensureTeamStrategyRow(target.beian_hao, productName)
      } catch (err) {
        if (normalizeBeian(target.beian_hao) === normalizeBeian(primary)) throw err
        continue
      }
      result = await updateCompanyStrategy(
        target.beian_hao,
        params.strategy_l1,
        params.strategy_l2,
        params.strategy_l3,
      )
    }
    if (!result.length) continue
    updated.push(target.beian_hao)
    synced.push({
      beian_hao: target.beian_hao,
      strategy_l1: params.strategy_l1,
      strategy_l2: params.strategy_l2,
      strategy_l3: params.strategy_l3,
      product_name: productName,
    })
  }

  await syncCompanyStrategyCaches(synced)
  return { updated, family: targets }
}

export async function expandBeianHaosWithShareClassFamily(
  beianHaos: string[],
): Promise<string[]> {
  const seen = new Set<string>()
  const out: string[] = []
  const familySeen = new Set<string>()

  for (const raw of beianHaos) {
    const code = String(raw ?? "").trim()
    if (!code) continue
    const key = normalizeBeian(code)
    if (familySeen.has(key)) continue

    try {
      const family = await listFundFamilyProducts(code)
      const members = family.length ? family : [{ beian_hao: code, product_name: code }]
      for (const member of members) {
        const memberKey = normalizeBeian(member.beian_hao)
        familySeen.add(memberKey)
        if (seen.has(memberKey)) continue
        seen.add(memberKey)
        out.push(member.beian_hao)
      }
    } catch (err) {
      console.error("Share-class family expand failed:", err)
      if (!seen.has(key)) {
        seen.add(key)
        out.push(code)
      }
    }
  }

  return out
}

export function familyHasTeamStrategy(family: FamilyTeamStrategyRow[]): boolean {
  return family.some((row) => !isStrategyEmpty(strategyTriple(row.strategy_l1, row.strategy_l2, row.strategy_l3)))
}
