import { query } from "@/lib/db"
import {
  loadEmailNavSeries,
  loadPrivateFundLegacyNavRows,
  mergeLegacyWithTeamNav,
  mergeNavSeriesWithEmail,
  type LegacyNavRow,
} from "@/lib/server/email-nav-query"
import { lookupManagedProductOverride } from "@/lib/server/managed-product-beian"
import { applyFundNavCorrectionToLegacyRows, lookupFundNavCorrectionRule } from "@/lib/server/fund-nav-correction-rules"
import {
  loadManagedProductNavSeed,
  mergeManagedProductDetailNav,
} from "@/lib/server/managed-product-nav-seed"
import { loadManagedProductEmailPoints, loadManagedProductNavSeries, loadManualTeamNavBatch } from "@/lib/server/team-nav-manage-pg"

function pickNavLevel(row: LegacyNavRow): number | null {
  for (const field of [row.cum_nav_withdrawal, row.cumulative_nav, row.nav]) {
    const value = parseFloat(field)
    if (Number.isFinite(value) && value > 0) return value
  }
  return null
}

async function loadBflNames(beian_hao: string) {
  const rows = await query<{ product_name: string; short_name: string | null }>(
    `SELECT product_name, short_name FROM private_fund_info_bfl WHERE beian_hao = $1 LIMIT 1`,
    [beian_hao],
  ).catch(() => [] as { product_name: string; short_name: string | null }[])
  return rows[0] ?? null
}

export async function resolveFundNames(beian_hao: string, product_name?: string) {
  const bfl = await loadBflNames(beian_hao)
  const bflShort = (bfl?.short_name ?? "").trim()
  const inputName = (product_name ?? "").trim()

  if (inputName) {
    return { product_name: inputName, short_name: bflShort }
  }

  const nameRow = await query<{ product_name: string; fund_short_name: string | null }>(
    `SELECT COALESCE(b.fund_short_name, t.product_name) AS product_name, b.fund_short_name
     FROM type6_ops_team_full t
     LEFT JOIN basicinfo_bfl_track b ON b.register_number = t.register_number
     WHERE t.register_number = $1
     LIMIT 1`,
    [beian_hao],
  ).catch(() => [] as { product_name: string; fund_short_name: string | null }[])

  return {
    product_name: nameRow[0]?.product_name ?? bfl?.product_name ?? beian_hao,
    short_name: nameRow[0]?.fund_short_name ?? bflShort,
  }
}

async function loadMergedNavRows(
  beian_hao: string,
  product_name: string,
  short_name: string,
): Promise<LegacyNavRow[]> {
  const fundContext = { beian_hao, product_name, short_name }
  const bfl = await loadBflNames(beian_hao)
  const extraNames = [bfl?.product_name, bfl?.short_name, product_name, short_name]

  const [legacyRows, emailRows] = await Promise.all([
    loadPrivateFundLegacyNavRows(beian_hao, product_name, short_name),
    loadEmailNavSeries(beian_hao, product_name, short_name || null, extraNames),
  ])

  let navSeries = mergeNavSeriesWithEmail(legacyRows, emailRows, fundContext)

  const correctionRule = lookupFundNavCorrectionRule(beian_hao, product_name, short_name)
  if (correctionRule?.preserve_high_nav_scale) {
    return applyFundNavCorrectionToLegacyRows(navSeries, fundContext)
  }

  const managedOverride =
    lookupManagedProductOverride(beian_hao)
    ?? lookupManagedProductOverride(product_name)

  // Skip the manual-team DB round-trip when a managed-product override already applies.
  let effectiveManagedOverride = managedOverride
  if (!effectiveManagedOverride) {
    const manualTeamNavMap = await loadManualTeamNavBatch([beian_hao])
    if ((manualTeamNavMap.get(beian_hao)?.length ?? 0) > 0) {
      effectiveManagedOverride = { beian_hao, product_name }
    }
  }

  if (!effectiveManagedOverride) {
    return applyFundNavCorrectionToLegacyRows(navSeries, fundContext)
  }

  try {
    const [teamEmailPoints, teamSeries, seedRows] = await Promise.all([
      loadManagedProductEmailPoints({
        beian_hao: effectiveManagedOverride.beian_hao,
        product_name: effectiveManagedOverride.product_name,
        short_name: short_name || null,
        extraNames,
      }),
      loadManagedProductNavSeries({
        beian_hao: effectiveManagedOverride.beian_hao,
        product_name: effectiveManagedOverride.product_name,
        short_name: short_name || null,
        extraNames,
      }),
      Promise.resolve(loadManagedProductNavSeed(effectiveManagedOverride.beian_hao)),
    ])

    if (seedRows.length > 0) {
      const legacyNoType6 = await loadPrivateFundLegacyNavRows(
        beian_hao,
        product_name,
        short_name,
        { excludeType6: true },
      )
      return applyFundNavCorrectionToLegacyRows(
        mergeManagedProductDetailNav(seedRows, teamEmailPoints, legacyNoType6),
        fundContext,
      )
    }

    if (teamSeries.length > 0) {
      const legacyNoType6 = await loadPrivateFundLegacyNavRows(
        beian_hao,
        product_name,
        short_name,
        { excludeType6: true },
      )
      const firstTeamDate = teamSeries[0]?.price_date ?? ""
      const seedBackfill = seedRows.filter((row) => !firstTeamDate || row.price_date < firstTeamDate)
      let base = mergeNavSeriesWithEmail(legacyNoType6, [], fundContext)
      if (seedBackfill.length > 0) {
        base = mergeLegacyWithTeamNav(base, seedBackfill, fundContext)
      }
      return applyFundNavCorrectionToLegacyRows(
        mergeLegacyWithTeamNav(base, teamSeries, fundContext),
        fundContext,
      )
    }

    if (seedRows.length > 0) {
      const seedLatest = seedRows[seedRows.length - 1].price_date
      const emailAfterSeed = emailRows.filter((row) => row.price_date > seedLatest)
      return applyFundNavCorrectionToLegacyRows(
        mergeNavSeriesWithEmail(seedRows, emailAfterSeed, fundContext),
        fundContext,
      )
    }

    const legacyNoType6 = await loadPrivateFundLegacyNavRows(
      beian_hao,
      product_name,
      short_name,
      { excludeType6: true },
    )
    return applyFundNavCorrectionToLegacyRows(
      mergeNavSeriesWithEmail(legacyNoType6, emailRows, fundContext),
      fundContext,
    )
  } catch (err) {
    console.error("[loadMergedNavRows] managed product nav failed:", err)
    return applyFundNavCorrectionToLegacyRows(navSeries, fundContext)
  }
}

function filterRowsByDate(
  rows: LegacyNavRow[],
  opts: { from: string; to: string } | { days: number },
): LegacyNavRow[] {
  if ("from" in opts) {
    return rows.filter((row) => {
      const d = row.price_date.slice(0, 10)
      return d >= opts.from && d <= opts.to
    })
  }

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - opts.days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  return rows.filter((row) => row.price_date.slice(0, 10) >= cutoffStr)
}

export async function loadFundLatestUnitNav(
  beian_hao: string,
  product_name?: string,
): Promise<{ nav: number | null; price_date: string | null }> {
  const names = await resolveFundNames(beian_hao, product_name)
  const rows = await loadMergedNavRows(beian_hao, names.product_name, names.short_name)
  const latest = rows.at(-1)
  if (!latest) return { nav: null, price_date: null }
  const nav = parseFloat(latest.nav)
  return {
    nav: Number.isFinite(nav) && nav > 0 ? nav : null,
    price_date: latest.price_date.slice(0, 10),
  }
}

export async function loadFundNavRange(
  beian_hao: string,
  product_name: string,
  short_name: string,
): Promise<{ nav_start_date: string | null; latest_nav_date: string | null }> {
  const rows = await loadMergedNavRows(beian_hao, product_name, short_name)
  if (rows.length === 0) return { nav_start_date: null, latest_nav_date: null }
  return {
    nav_start_date: rows[0].price_date.slice(0, 10),
    latest_nav_date: rows.at(-1)!.price_date.slice(0, 10),
  }
}

export async function loadMergedFundNavRows(
  beian_hao: string,
  product_name: string,
  short_name: string,
): Promise<LegacyNavRow[]> {
  return loadMergedNavRows(beian_hao, product_name, short_name)
}

export async function loadFundNavSeries(
  beian_hao: string,
  product_name: string,
  short_name: string,
  opts: { from: string; to: string } | { days: number },
): Promise<{ price_date: string; level: string }[]> {
  const rows = filterRowsByDate(await loadMergedNavRows(beian_hao, product_name, short_name), opts)
  return rows.flatMap((row) => {
    const level = pickNavLevel(row)
    if (level == null) return []
    return [{ price_date: row.price_date.slice(0, 10), level: String(level) }]
  })
}
