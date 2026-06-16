import {
  buildEmailNavLatestExprs,
  buildEmailNavLatestJoins,
} from "@/lib/server/email-nav-query"
import {
  buildManagedProductsFrom,
  FOF_UNDERLYING_BEIAN_EXPR,
  fofUnderlyingShortExpr,
} from "@/lib/server/fof-underlying-query"

export const MANAGED_BEIAN_EXPR = FOF_UNDERLYING_BEIAN_EXPR

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
  return `COALESCE(
    (SELECT ngc.nav::numeric FROM private_fund_nav_group ngc
     WHERE ngc.beian_hao = ${beianExpr} AND ${beianExpr} IS NOT NULL
       AND ngc.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY ngc.price_date DESC LIMIT 1),
    (SELECT ngn.nav::numeric FROM private_fund_nav_group ngn
     WHERE ngn.product_name = ${productExpr}
       AND ngn.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY ngn.price_date DESC LIMIT 1),
    (SELECT ngs.nav::numeric FROM private_fund_nav_group ngs
     WHERE ${shortExpr} IS NOT NULL AND ngs.product_name = ${shortExpr}
       AND ngs.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY ngs.price_date DESC LIMIT 1),
    (SELECT nhc.nav::numeric FROM private_fund_nav_group_hy nhc
     WHERE nhc.beian_hao = ${beianExpr} AND ${beianExpr} IS NOT NULL
       AND nhc.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nhc.price_date DESC LIMIT 1),
    (SELECT nhn.nav::numeric FROM private_fund_nav_group_hy nhn
     WHERE nhn.product_name = ${productExpr}
       AND nhn.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nhn.price_date DESC LIMIT 1),
    (SELECT nhs.nav::numeric FROM private_fund_nav_group_hy nhs
     WHERE ${shortExpr} IS NOT NULL AND nhs.product_name = ${shortExpr}
       AND nhs.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nhs.price_date DESC LIMIT 1),
    (SELECT nfc.nav::numeric FROM private_fund_nav nfc
     WHERE nfc.beian_hao = ${beianExpr} AND ${beianExpr} IS NOT NULL
       AND nfc.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nfc.price_date DESC LIMIT 1),
    (SELECT nfn.nav::numeric FROM private_fund_nav nfn
     WHERE nfn.product_name = ${productExpr}
       AND nfn.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nfn.price_date DESC LIMIT 1),
    (SELECT nfs.nav::numeric FROM private_fund_nav nfs
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
  const beianExpr = MANAGED_BEIAN_EXPR
  const productExpr = "m.product_name"
  const shortExpr = managedShortExpr(productExpr)
  const fallbackNavExpr = "m.latest_unit_nav::numeric"
  const fallbackDateExpr = "m.latest_nav_date"
  const fallbackPctExpr = "m.latest_return_pct::numeric / 100"
  const emailNavJoins = buildEmailNavLatestJoins(beianExpr, productExpr, shortExpr, cutoffExpr)
  const { navExpr, dateExpr, pctExpr } = buildEmailNavLatestExprs(
    fallbackNavExpr,
    fallbackDateExpr,
    fallbackPctExpr,
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
