import {
  buildEmailNavLatestExprs,
  buildEmailNavLatestJoins,
} from "@/lib/server/email-nav-query"
import { managedProductsResolvedBeianSqlExpr } from "@/lib/server/managed-product-beian"
import {
  buildManagedProductsFrom,
  fofUnderlyingBeianExpr,
  fofUnderlyingShortExpr,
} from "@/lib/server/fof-underlying-query"
import { sqlFundNameMatch } from "@/lib/server/fund-name-match"

export const MANAGED_BEIAN_EXPR = fofUnderlyingBeianExpr("m.product_name")

/** True when displayed NAV comes from team email ingestion (not legacy/platform fallback). */
export const MANAGED_NAV_IS_TEAM_EXPR = "(COALESCE(en.nav, en_val.nav) IS NOT NULL)"

export function managedValuationMetricsJoin(
  beianExpr: string,
  productExpr: string,
): string {
  return `
    LEFT JOIN LATERAL (
      SELECT v.valuation_date::text AS valuation_date
      FROM ops_email_valuation_fund_metrics_latest v
      WHERE (
        (NULLIF(BTRIM(v.product_code), '') IS NOT NULL AND v.product_code = ${beianExpr})
        OR TRIM(v.fund_name) = TRIM(${productExpr})
        OR ${sqlFundNameMatch("v.fund_name", productExpr)}
      )
      ORDER BY v.valuation_date DESC
      LIMIT 1
    ) vm ON true
  `
}

export function managedShortExpr(productNameExpr: string): string {
  return fofUnderlyingShortExpr(productNameExpr)
}

/** NAV lookup with the same multi-table fallback chain used by the list API. */
export function managedNavScalarExpr(
  beianExpr: string,
  productExpr: string,
  shortExpr: string,
  days: number,
  cutoffExpr: string,
): string {
  return managedNavFieldScalarExpr(beianExpr, productExpr, shortExpr, days, cutoffExpr, "nav")
}

/** NAV date lookup — paired with {@link managedNavScalarExpr} at the same offset. */
export function managedNavDateScalarExpr(
  beianExpr: string,
  productExpr: string,
  shortExpr: string,
  days: number,
  cutoffExpr: string,
): string {
  return managedNavFieldScalarExpr(beianExpr, productExpr, shortExpr, days, cutoffExpr, "price_date")
}

function managedNavFieldScalarExpr(
  beianExpr: string,
  productExpr: string,
  shortExpr: string,
  days: number,
  cutoffExpr: string,
  field: "nav" | "price_date",
): string {
  const col = field === "nav" ? "nav::numeric" : "price_date"
  return `COALESCE(
    (SELECT ngc.${col} FROM private_fund_nav_group ngc
     WHERE ngc.beian_hao = ${beianExpr} AND ${beianExpr} IS NOT NULL
       AND ngc.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY ngc.price_date DESC LIMIT 1),
    (SELECT ngn.${col} FROM private_fund_nav_group ngn
     WHERE ngn.product_name = ${productExpr}
       AND ngn.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY ngn.price_date DESC LIMIT 1),
    (SELECT ngs.${col} FROM private_fund_nav_group ngs
     WHERE ${shortExpr} IS NOT NULL AND ngs.product_name = ${shortExpr}
       AND ngs.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY ngs.price_date DESC LIMIT 1),
    (SELECT nhc.${col} FROM private_fund_nav_group_hy nhc
     WHERE nhc.beian_hao = ${beianExpr} AND ${beianExpr} IS NOT NULL
       AND nhc.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nhc.price_date DESC LIMIT 1),
    (SELECT nhn.${col} FROM private_fund_nav_group_hy nhn
     WHERE nhn.product_name = ${productExpr}
       AND nhn.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nhn.price_date DESC LIMIT 1),
    (SELECT nhs.${col} FROM private_fund_nav_group_hy nhs
     WHERE ${shortExpr} IS NOT NULL AND nhs.product_name = ${shortExpr}
       AND nhs.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nhs.price_date DESC LIMIT 1),
    (SELECT nfc.${col} FROM private_fund_nav nfc
     WHERE nfc.beian_hao = ${beianExpr} AND ${beianExpr} IS NOT NULL
       AND nfc.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nfc.price_date DESC LIMIT 1),
    (SELECT nfn.${col} FROM private_fund_nav nfn
     WHERE nfn.product_name = ${productExpr}
       AND nfn.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nfn.price_date DESC LIMIT 1),
    (SELECT nfs.${col} FROM private_fund_nav nfs
     WHERE ${shortExpr} IS NOT NULL AND nfs.product_name = ${shortExpr}
       AND nfs.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nfs.price_date DESC LIMIT 1)
  )`
}

export function managedNavAtOffsetJoin(
  alias: string,
  beianExpr: string,
  productExpr: string,
  shortExpr: string,
  days: number,
  cutoffExpr: string,
): string {
  return `LEFT JOIN LATERAL (
    SELECT ${managedNavScalarExpr(beianExpr, productExpr, shortExpr, days, cutoffExpr)} AS nav
  ) ${alias} ON true`
}

export function buildManagedProductsMetricSelectSql(cutoffExpr: string): {
  baseFrom: string
  emailNavJoins: string
  histJoins: string
  beianExpr: string
  productExpr: string
  shortExpr: string
  currentNavExpr: string
  currentDateExpr: string
  currentPctExpr: string
} {
  const productExpr = "m.product_name"
  const beianExpr = managedProductsResolvedBeianSqlExpr(productExpr, MANAGED_BEIAN_EXPR)
  const shortExpr = managedShortExpr(productExpr)
  const fallbackNavExpr = "m.latest_unit_nav::numeric"
  const fallbackDateExpr = "m.latest_nav_date"
  const fallbackPctExpr = "NULL::numeric"
  const emailNavJoins = buildEmailNavLatestJoins(beianExpr, productExpr, shortExpr, cutoffExpr)
  const legacyNavExpr = managedNavScalarExpr(beianExpr, productExpr, shortExpr, 0, cutoffExpr)
  const legacyDateExpr = managedNavDateScalarExpr(beianExpr, productExpr, shortExpr, 0, cutoffExpr)
  const { navExpr, dateExpr, pctExpr } = buildEmailNavLatestExprs(
    fallbackNavExpr,
    fallbackDateExpr,
    fallbackPctExpr,
    legacyNavExpr,
    legacyDateExpr,
  )
  const histJoins = [7, 30, 90, 180, 365]
    .map((days, i) => {
      const aliases = ["h1w", "h1m", "h3m", "h6m", "h1y"]
      return managedNavAtOffsetJoin(aliases[i], beianExpr, productExpr, shortExpr, days, cutoffExpr)
    })
    .join("\n")

  return {
    baseFrom: `
      ${buildManagedProductsFrom(productExpr)}
    `,
    emailNavJoins,
    histJoins,
    beianExpr,
    productExpr,
    shortExpr,
    currentNavExpr: navExpr,
    currentDateExpr: dateExpr,
    currentPctExpr: pctExpr,
  }
}
