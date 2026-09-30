/**
 * FOF overview list ORDER BY helpers.
 *
 * The list subquery projects numeric metric columns as ::text for JSON mapping,
 * so a bare ORDER BY alias sorts lexicographically and mishandles signed values
 * (e.g. "-0.0368" vs "-0.0114", or "-6.67" vs "7.01"). Cast those aliases
 * through ::numeric. Date / name / text columns are left alone.
 */

const SIGNED_NUMERIC_ORDER_ALIASES = new Set([
  "latest_return_pct",
  "ret_1w",
  "ret_1m",
  "ret_3m",
  "ret_6m",
  "ret_1y",
  "sharpe_1y",
  "calmar_1y",
])

/** Build ORDER BY for a projected alias; signed metrics cast through ::numeric. */
export function orderSqlForProjectedAlias(alias: string, sortDir: "ASC" | "DESC"): string {
  if (SIGNED_NUMERIC_ORDER_ALIASES.has(alias)) {
    return `${alias}::numeric ${sortDir} NULLS LAST`
  }
  return `${alias} ${sortDir} NULLS LAST`
}

/** True when this projected alias needs a signed-numeric ORDER BY cast. */
export function isSignedNumericOrderAlias(alias: string): boolean {
  return SIGNED_NUMERIC_ORDER_ALIASES.has(alias)
}

/** @deprecated Use isSignedNumericOrderAlias */
export const isSignedPctOrderAlias = isSignedNumericOrderAlias
