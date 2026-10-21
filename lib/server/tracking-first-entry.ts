/**
 * 首次入表 for 跟踪产品.
 *
 * The earliest Shanghai day this 备案号 was added to a tracking table, or
 * first fetched from email. See docs/tracking-pool-rules.md.
 *
 * Not ops_tracking_funds_list_cache.refreshed_at, and not the imported_at of
 * a later pool-sync insert when an older add or email row already exists.
 */

const SHANGHAI_DAY = (col: string) => `(${col} AT TIME ZONE 'Asia/Shanghai')::date`

const MEMBERSHIP_SOURCES: Array<[table: string, code: string]> = [
  ["tracking_pool", "register_number"],
  ["selected_pool", "register_number"],
  ["core_pool", "register_number"],
  ["hy_tracking_pool", "register_number"],
  ["fof_mom_tracking", "register_number"],
  ["user_custom_pool", "register_number"],
  // Date source only. type6 stays off the 全部 membership union.
  ["type6_ops_team_full", "register_number"],
]

function membershipMin(table: string, code: string): string {
  return `
    SELECT UPPER(BTRIM(${code})) AS code,
           MIN(${SHANGHAI_DAY("imported_at")}) AS day
    FROM ${table}
    WHERE NULLIF(BTRIM(${code}), '') IS NOT NULL
    GROUP BY 1`
}

function emailMin(table: string): string {
  return `
    SELECT UPPER(BTRIM(product_code)) AS code,
           MIN(${SHANGHAI_DAY("created_at")}) AS day
    FROM ${table}
    WHERE NULLIF(BTRIM(product_code), '') IS NOT NULL
    GROUP BY 1`
}

/** One row per 备案号: MIN(day) across real adds and first email fetches. */
export function sqlTrackingFirstEntryByCode(): string {
  const parts = [
    ...MEMBERSHIP_SOURCES.map(([table, code]) => membershipMin(table, code)),
    emailMin("ops_email_nav_records"),
    emailMin("ops_email_valuation_records"),
  ]
  return `
    SELECT code, MIN(day) AS first_entry_date
    FROM (
      ${parts.join("\nUNION ALL\n")}
    ) first_entry_src
    WHERE code <> ''
    GROUP BY code`
}
