/**
 * Repair CSC/中信建投 虚拟净值提取 rows whose fund_name was set to the FOF/investor
 * (second name in subject) instead of the underlying (first name).
 *
 * Example bleed: SCU622 金舆稳健增长1号FOF detail showed BSQ40B unit 1.0946 because
 * subject `自然红启程2号…-金舆稳健增长1号FOF…-虚拟净值提取…` stored fund_name=FOF.
 *
 * Scoped to rows whose subject matches the CSC disclosure pattern and whose stored
 * fund_name equals the investor (second) name. Does not touch valuation rows or
 * unrelated funds.
 *
 * Usage:
 *   npx tsx scripts/ma/_repair_csc_virtual_fof_bleed.ts --dry-run
 *   npx tsx scripts/ma/_repair_csc_virtual_fof_bleed.ts
 *   npx tsx scripts/ma/_repair_csc_virtual_fof_bleed.ts --investor=金舆稳健增长1号FOF
 */
import { loadProjectEnvFiles, configureEtlDbTimeout } from "@/lib/server/load-project-env"

loadProjectEnvFiles()
configureEtlDbTimeout()

const DRY = process.argv.includes("--dry-run")
const INVESTOR_FILTER = (
  process.argv.find((a) => a.startsWith("--investor="))?.slice("--investor=".length) || ""
).trim()

const FUND_NAME_RE =
  /[\u4e00-\u9fffA-Za-z0-9]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?/u

function parseCscUnderlyingAndInvestor(
  subject: string,
): { underlying: string; investor: string } | null {
  if (!/虚拟净值提取|虚拟净值查询|虚拟净值数据/u.test(subject)) return null
  const m = subject.match(
    new RegExp(
      `(${FUND_NAME_RE.source})(?:（[^）]*）|\\([^)]*\\))?[-_](${FUND_NAME_RE.source})[-_]?虚拟净值`,
      "u",
    ),
  )
  if (!m) return null
  return { underlying: m[1], investor: m[2] }
}

function shortName(name: string): string {
  return name
    .replace(/(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?$/u, "")
    .trim()
}

async function main() {
  const { query, rawQuery } = await import("@/lib/db")
  const { normalizeFundDisplayName } = await import("@/lib/fund-display-name")
  const { invalidateDetailNavCache, refreshDetailNavCacheForFund } = await import(
    "@/lib/server/fund-detail-nav-cache-pg"
  )

  const rows = await query<{
    id: string
    nav_date: string
    nav: string
    product_code: string | null
    fund_name: string | null
    subject: string | null
  }>(
    `SELECT id::text, nav_date::text, nav::text, product_code, fund_name, subject
     FROM ops_email_nav_records
     WHERE subject ~ '虚拟净值提取|虚拟净值查询|虚拟净值数据'
       AND ($1 = '' OR subject ILIKE '%' || $1 || '%' OR fund_name ILIKE '%' || $1 || '%')
     ORDER BY nav_date DESC, id DESC`,
    [INVESTOR_FILTER],
  )

  const updates: Array<{
    id: string
    nav_date: string
    product_code: string | null
    from: string
    to: string
    subject: string
  }> = []

  for (const row of rows) {
    const subject = row.subject ?? ""
    const parsed = parseCscUnderlyingAndInvestor(subject)
    if (!parsed) continue
    const underlying = normalizeFundDisplayName(parsed.underlying)
    const investor = normalizeFundDisplayName(parsed.investor)
    const current = normalizeFundDisplayName(row.fund_name ?? "")
    if (!underlying || !investor || !current) continue
    if (INVESTOR_FILTER) {
      const filter = normalizeFundDisplayName(INVESTOR_FILTER)
      if (
        !investor.includes(filter) &&
        !filter.includes(investor) &&
        !shortName(investor).includes(shortName(filter))
      ) {
        continue
      }
    }
    // Only rewrite when stored name is the investor (or equals investor short form).
    const currentIsInvestor =
      current === investor ||
      current === shortName(investor) ||
      shortName(current) === shortName(investor)
    const currentIsUnderlying =
      current === underlying ||
      current === shortName(underlying) ||
      shortName(current) === shortName(underlying)
    if (!currentIsInvestor || currentIsUnderlying) continue

    updates.push({
      id: row.id,
      nav_date: row.nav_date.slice(0, 10),
      product_code: row.product_code,
      from: current,
      to: underlying,
      subject: subject.slice(0, 100),
    })
  }

  console.log(`Found ${updates.length} bleed row(s)${DRY ? " (dry-run)" : ""}`)
  for (const u of updates.slice(0, 40)) {
    console.log(
      `${u.nav_date} id=${u.id} code=${u.product_code}: ${u.from} -> ${u.to}`,
    )
  }
  if (updates.length > 40) console.log(`... +${updates.length - 40} more`)

  if (!DRY) {
    for (const u of updates) {
      await rawQuery(
        `UPDATE ops_email_nav_records SET fund_name = $1 WHERE id = $2`,
        [u.to, u.id],
      )
    }
  }

  // Refresh SCU622 caches only when this investor was involved (default / explicit).
  const touchScu622 =
    !INVESTOR_FILTER || /金舆稳健增长1号FOF/u.test(INVESTOR_FILTER) || updates.some((u) =>
      /金舆稳健增长1号FOF/u.test(u.from),
    )
  if (touchScu622 && !DRY) {
    const code = "SCU622"
    const name = "金舆稳健增长1号FOF"
    const fullName = "金舆稳健增长1号FOF私募证券投资基金"
    // List-cache tips can still hold the bleed NAV; loadDetailNavSeriesFast prefers the
    // newest tip across FOF/managed/tracking and will re-extend with it. Reset tips from
    // SCU622 custody email rows only (product_code match) before rebuilding detail cache.
    const custodyTip = await query<{ nav_date: string; nav: string }>(
      `SELECT nav_date::text AS nav_date, nav::text AS nav
       FROM ops_email_nav_records
       WHERE BTRIM(product_code) = $1
         AND source = 'attachment_valuation_table'
         AND nav IS NOT NULL
       ORDER BY nav_date DESC, id DESC
       LIMIT 1`,
      [code],
    )
    const tipDate = custodyTip[0]?.nav_date?.slice(0, 10) ?? null
    const tipNav = custodyTip[0]?.nav ?? null
    console.log("custody tip", tipDate, tipNav)

    if (tipDate && tipNav != null) {
      for (const table of [
        "ops_managed_products_list_cache",
        "ops_fof_overview_list_cache",
        "ops_tracking_funds_list_cache",
      ] as const) {
        try {
          const before = await query<{ unit_nav: string | null; nav_date: string | null }>(
            `SELECT unit_nav::text, nav_date::text FROM ${table} WHERE beian_hao = $1 LIMIT 1`,
            [code],
          )
          if (!before[0]) {
            console.log(`${table}: no row`)
            continue
          }
          const updated = await rawQuery(
            `UPDATE ${table}
             SET unit_nav = $2,
                 nav_date = $3::date,
                 return_pct = CASE
                   WHEN $2::numeric > 0 THEN (($2::numeric - 1) * 100)
                   ELSE return_pct
                 END,
                 refreshed_at = NOW()
             WHERE beian_hao = $1
             RETURNING unit_nav::text, nav_date::text, return_pct::text`,
            [code, tipNav, tipDate],
          )
          console.log(
            `${table}: before=${JSON.stringify(before[0])} after=${JSON.stringify(updated.rows[0] ?? null)}`,
          )
        } catch (err) {
          console.log(`${table}: skipped (${err instanceof Error ? err.message : err})`)
        }
      }
    }

    // Rebuild detail with an explicit custody listHeader so lookup cannot pick a
    // still-stale tracking tip mid-refresh.
    const deleted2 = await invalidateDetailNavCache([code, name, fullName])
    console.log("re-invalidated detail cache", deleted2)
    const listHeader =
      tipDate && tipNav != null
        ? {
            source: "managed" as const,
            beian_hao: code,
            product_name: fullName,
            short_name: name,
            unit_nav: tipNav,
            nav_date: tipDate,
            return_pct: String((parseFloat(tipNav) - 1) * 100),
            ret_1w: null,
            ret_1m: null,
            ret_3m: null,
            ret_6m: null,
            ret_1y: null,
            sharpe_1y: null,
            calmar_1y: null,
            company_strategy_l1: null,
            company_strategy_l2: null,
            company_strategy_l3: null,
            platform_strategy_l1: null,
            platform_strategy_l2: null,
            platform_strategy_l3: null,
          }
        : null
    const ok2 = await refreshDetailNavCacheForFund({
      beian_hao: code,
      product_name: fullName,
      short_name: name,
      listHeader,
    })
    console.log("re-refreshed detail cache", ok2)

    const { loadDetailNavSeriesFast } = await import("@/lib/server/fund-detail-fast-path")
    const series = await loadDetailNavSeriesFast({
      beian_hao: code,
      product_name: fullName,
      short_name: name,
      rawId: code,
      listHeader,
    })
    const tip = series[series.length - 1]
    console.log(
      "live detail tip",
      tip ? `${tip.price_date} unit=${tip.nav}` : "(empty)",
    )
    if (tip && Number(tip.nav) > 1.05) {
      throw new Error(`SCU622 tip still looks like bleed NAV: ${tip.price_date} ${tip.nav}`)
    }
  } else if (touchScu622 && DRY) {
    console.log("Skipping cache refresh (dry-run)")
  }

  console.log(DRY ? "Dry-run complete" : "Repair complete")
}

void main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
