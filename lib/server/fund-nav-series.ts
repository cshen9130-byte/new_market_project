import { query } from "@/lib/db"
import { isChinaTradingDay } from "@/lib/server/china-trading-calendar"
import {
  loadEmailNavSeries,
  loadPrivateFundLegacyNavRows,
  mergeLegacyWithTeamNav,
  appendEmailAfterSeriesTip,
  mergeNavSeriesWithEmail,
  recomputeNavPriceChanges,
  type LegacyNavRow,
} from "@/lib/server/email-nav-query"
import { lookupManagedProductOverride } from "@/lib/server/managed-product-beian"
import { applyFundNavCorrectionToLegacyRows } from "@/lib/server/fund-nav-correction-rules"
import {
  loadManagedProductNavSeed,
  mergeManagedProductDetailNav,
} from "@/lib/server/managed-product-nav-seed"
import { fillMissingNavIfOverlapConsistent } from "@/lib/server/share-class-nav-fill"
import { shareClassFamilyBeianCodes } from "@/lib/server/share-class-product"
import {
  loadManagedProductEmailPoints,
  loadManagedProductNavSeries,
  loadManualTeamNavBatch,
  manualNavPointsForBeian,
} from "@/lib/server/team-nav-manage-pg"

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
  const code = beian_hao.trim().toUpperCase()

  if (inputName && inputName.toUpperCase() !== code) {
    return { product_name: inputName, short_name: bflShort }
  }

  const nameRow = await query<{ product_name: string; fund_short_name: string | null }>(
    `SELECT COALESCE(
       NULLIF(BTRIM(b.fund_short_name), ''),
       NULLIF(BTRIM(t.fund_short_name), ''),
       NULLIF(BTRIM(t.fund_name), '')
     ) AS product_name,
     COALESCE(NULLIF(BTRIM(b.fund_short_name), ''), NULLIF(BTRIM(t.fund_short_name), '')) AS fund_short_name
     FROM type6_ops_team_full t
     LEFT JOIN basicinfo_bfl_track b ON b.register_number = t.register_number
     WHERE t.register_number = $1
     LIMIT 1`,
    [beian_hao],
  ).catch(() => [] as { product_name: string; fund_short_name: string | null }[])

  if (nameRow[0]?.product_name) {
    return {
      product_name: nameRow[0].product_name,
      short_name: nameRow[0].fund_short_name ?? bflShort,
    }
  }

  const amac = await query<{ product_name: string }>(
    `SELECT product_name FROM private_fund_info WHERE beian_hao = $1 LIMIT 1`,
    [beian_hao],
  ).catch(() => [] as { product_name: string }[])

  return {
    product_name: amac[0]?.product_name ?? bfl?.product_name ?? beian_hao,
    short_name: bflShort,
  }
}

async function listFamilyCodesWithNav(beianHao: string): Promise<string[]> {
  const self = beianHao.trim().toUpperCase()
  const family = shareClassFamilyBeianCodes(self).filter((code) => code !== self)
  if (family.length === 0) return []
  const rows = await query<{ code: string }>(
    `SELECT DISTINCT UPPER(BTRIM(code)) AS code
     FROM (
       SELECT beian_hao AS code
       FROM private_fund_nav_group_type6
       WHERE beian_hao = ANY($1::text[])
       UNION
       SELECT beian_hao
       FROM private_fund_nav
       WHERE beian_hao = ANY($1::text[])
       UNION
       SELECT BTRIM(product_code)
       FROM ops_email_nav_records
       WHERE BTRIM(product_code) = ANY($1::text[])
     ) t
     WHERE NULLIF(BTRIM(code), '') IS NOT NULL`,
    [family],
  ).catch(() => [] as { code: string }[])
  return rows.map((row) => row.code).filter(Boolean)
}

/** Copy missing dates from parent ↔ A/B/C siblings when overlapping NAV matches (non-分红). */
async function fillMergedNavFromShareClassFamily(
  beianHao: string,
  rows: LegacyNavRow[],
): Promise<LegacyNavRow[]> {
  if (rows.length === 0) return rows
  const donors = await listFamilyCodesWithNav(beianHao)
  let filled = rows
  for (const code of donors) {
    const names = await resolveFundNames(code)
    const donor = await loadMergedNavRows(code, names.product_name, names.short_name)
    filled = fillMissingNavIfOverlapConsistent(filled, donor)
  }
  return filled
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

  const managedOverride =
    lookupManagedProductOverride(beian_hao)
    ?? lookupManagedProductOverride(product_name)

  // Skip the manual-team DB round-trip when a managed-product override already applies.
  // preserve_high_nav_scale must not skip this merge — it only disables return-index trim.
  let effectiveManagedOverride = managedOverride
  if (!effectiveManagedOverride) {
    const manualTeamNavMap = await loadManualTeamNavBatch([beian_hao])
    if (manualNavPointsForBeian(manualTeamNavMap, beian_hao).length > 0) {
      effectiveManagedOverride = { beian_hao, product_name }
    }
  }
  // Verified xlsx seed (data/managed-product-nav/<备案号>.json) is enough to use the
  // seed merge path — do not add the fund to MANAGED_PRODUCT_BEIAN_OVERRIDES.
  if (!effectiveManagedOverride && loadManagedProductNavSeed(beian_hao).length > 0) {
    effectiveManagedOverride = { beian_hao, product_name }
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
        mergeManagedProductDetailNav(seedRows, teamEmailPoints, legacyNoType6, fundContext),
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
      const teamMerged = mergeLegacyWithTeamNav(base, teamSeries, fundContext)
      return applyFundNavCorrectionToLegacyRows(
        appendEmailAfterSeriesTip(teamMerged, emailRows, fundContext),
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

/** Unit NAV on `asOfDate`, or the latest point on/before that date. */
export async function loadFundUnitNavOnOrBefore(
  beian_hao: string,
  asOfDate: string,
  product_name?: string,
): Promise<{ nav: number | null; price_date: string | null; exact: boolean }> {
  const asOf = asOfDate.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return { nav: null, price_date: null, exact: false }
  }
  const names = await resolveFundNames(beian_hao, product_name)
  const rows = await loadMergedNavRows(beian_hao, names.product_name, names.short_name)
  let bestDate: string | null = null
  let bestNav: number | null = null
  for (const row of rows) {
    const d = row.price_date.slice(0, 10)
    if (d > asOf) continue
    const unit = parseFloat(row.nav)
    if (!Number.isFinite(unit) || unit <= 0) continue
    if (bestDate == null || d >= bestDate) {
      bestDate = d
      bestNav = unit
    }
  }
  if (bestDate == null || bestNav == null) {
    return { nav: null, price_date: null, exact: false }
  }
  return {
    nav: bestNav,
    price_date: bestDate,
    exact: bestDate === asOf,
  }
}

export async function loadFundNavRange(
  beian_hao: string,
  product_name: string,
  short_name: string,
): Promise<{ nav_start_date: string | null; latest_nav_date: string | null }> {
  const rows = await loadMergedFundNavRows(beian_hao, product_name, short_name)
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
  // Defense in depth: custody forward-fills can still leak if a merge path skips finalize.
  const rows = await fillMergedNavFromShareClassFamily(
    beian_hao,
    await loadMergedNavRows(beian_hao, product_name, short_name),
  )
  return recomputeNavPriceChanges(
    rows.filter((row) => isChinaTradingDay(row.price_date.slice(0, 10))),
  )
}

export async function loadFundNavSeries(
  beian_hao: string,
  product_name: string,
  short_name: string,
  opts: { from: string; to: string } | { days: number },
): Promise<{ price_date: string; level: string }[]> {
  // Same series as the product detail page (platform/email merge + FOF 估值表
  // extend). The raw merge can freeze at an older team/email tip — BAH99A
  // 荣熙恒盈2号A类 stopped at 2026-07-01 in 基金对比 while the product page
  // already showed 2026-09-04.
  const { loadDetailNavSeriesFast } = await import("@/lib/server/fund-detail-fast-path")
  const merged = await loadDetailNavSeriesFast({ beian_hao, product_name, short_name })
  const rows = filterRowsByDate(merged, opts)
  return rows.flatMap((row) => {
    const level = pickNavLevel(row)
    if (level == null) return []
    return [{ price_date: row.price_date.slice(0, 10), level: String(level) }]
  })
}
