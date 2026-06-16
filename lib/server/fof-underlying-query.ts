import {
  sqlEmailNavShareClassGuard,
  sqlFundNameMatch,
  sqlFundNameMatchPriority,
} from "@/lib/server/fund-name-match"
import { query } from "@/lib/db"

/** Lateral joins resolving beian_hao / short_name from multiple sources. */
export function buildFofUnderlyingBeianJoins(productNameExpr: string): string {
  const bflMatch = `(${sqlFundNameMatch("bfl.product_name", productNameExpr)} OR ${sqlFundNameMatch("bfl.short_name", productNameExpr)})`
  const opsMatch = `(${sqlFundNameMatch("o.fund_name", productNameExpr)} OR ${sqlFundNameMatch("o.fund_short_name", productNameExpr)})`
  const pinfoMatch = sqlFundNameMatch("pi.product_name", productNameExpr)
  const detailMatch = sqlFundNameMatch("fd.product_name", productNameExpr)
  const trackMatch = sqlFundNameMatch("t.product_name", productNameExpr)
  const emailMatch = sqlFundNameMatch("en_code.fund_name", productNameExpr)
  const emailShareClass = sqlEmailNavShareClassGuard("en_code.fund_name", productNameExpr, "en_code.product_code")

  return `
      LEFT JOIN LATERAL (
        SELECT beian_hao, short_name, strategy_company
        FROM private_fund_info_bfl bfl
        WHERE ${bflMatch}
        ORDER BY
          LEAST(
            ${sqlFundNameMatchPriority("bfl.product_name", productNameExpr)},
            ${sqlFundNameMatchPriority("bfl.short_name", productNameExpr)}
          ),
          length(bfl.product_name) ASC
        LIMIT 1
      ) b ON true
      LEFT JOIN LATERAL (
        SELECT beian_hao
        FROM private_fund_info pi
        WHERE ${pinfoMatch}
        ORDER BY ${sqlFundNameMatchPriority("pi.product_name", productNameExpr)}, length(pi.product_name) ASC
        LIMIT 1
      ) pi ON true
      LEFT JOIN LATERAL (
        SELECT register_number, fund_short_name, company_strategy_one, platform_strategy_one, tag
        FROM type6_ops_team_full o
        WHERE ${opsMatch}
        ORDER BY
          LEAST(
            ${sqlFundNameMatchPriority("o.fund_name", productNameExpr)},
            ${sqlFundNameMatchPriority("o.fund_short_name", productNameExpr)}
          ),
          o.updated_at DESC NULLS LAST,
          o.id DESC
        LIMIT 1
      ) o ON true
      LEFT JOIN LATERAL (
        SELECT beian_hao
        FROM fof_underlying_detail fd
        WHERE ${detailMatch}
          AND NULLIF(BTRIM(fd.beian_hao), '') IS NOT NULL
        ORDER BY ${sqlFundNameMatchPriority("fd.product_name", productNameExpr)}
        LIMIT 1
      ) fd ON true
      LEFT JOIN LATERAL (
        SELECT beian_hao
        FROM investment_tracking_fof_underlying t
        WHERE ${trackMatch}
          AND NULLIF(BTRIM(t.beian_hao), '') IS NOT NULL
        ORDER BY ${sqlFundNameMatchPriority("t.product_name", productNameExpr)}
        LIMIT 1
      ) t ON true
      LEFT JOIN LATERAL (
        SELECT product_code
        FROM ops_email_nav_records en_code
        WHERE NULLIF(BTRIM(en_code.product_code), '') IS NOT NULL
          AND ${emailMatch}
          AND ${emailShareClass}
        ORDER BY
          ${sqlFundNameMatchPriority("en_code.fund_name", productNameExpr)},
          en_code.nav_date DESC NULLS LAST,
          en_code.id DESC
        LIMIT 1
      ) en_code ON true
    `
}

export const FOF_UNDERLYING_BEIAN_EXPR = `COALESCE(
  NULLIF(BTRIM(b.beian_hao), ''),
  NULLIF(BTRIM(pi.beian_hao), ''),
  NULLIF(BTRIM(o.register_number), ''),
  NULLIF(BTRIM(fd.beian_hao), ''),
  NULLIF(BTRIM(t.beian_hao), ''),
  NULLIF(BTRIM(en_code.product_code), '')
)`

export function fofUnderlyingShortExpr(productNameExpr: string): string {
  return `COALESCE(b.short_name, o.fund_short_name, ${productNameExpr})`
}

/** FROM clause for fof_underlying_summary with beian resolution joins. */
export function buildFofUnderlyingSummaryFrom(productNameExpr: string): string {
  return `
      FROM fof_underlying_summary f
      ${buildFofUnderlyingBeianJoins(productNameExpr)}
    `
}

/** FROM clause for managed_products with beian resolution joins. */
export function buildManagedProductsFrom(productNameExpr: string): string {
  return `
      FROM managed_products m
      ${buildFofUnderlyingBeianJoins(productNameExpr)}
    `
}

function buildFundNameLookupSql(nameParam: string): string {
  const bflMatch = `(${sqlFundNameMatch("bfl.product_name", nameParam)} OR ${sqlFundNameMatch("bfl.short_name", nameParam)})`
  const opsMatch = `(${sqlFundNameMatch("o.fund_name", nameParam)} OR ${sqlFundNameMatch("o.fund_short_name", nameParam)})`
  const pinfoMatch = sqlFundNameMatch("pi.product_name", nameParam)
  const detailMatch = sqlFundNameMatch("fd.product_name", nameParam)
  const trackMatch = sqlFundNameMatch("t.product_name", nameParam)
  const emailMatch = sqlFundNameMatch("en_code.fund_name", nameParam)
  const emailShareClass = sqlEmailNavShareClassGuard("en_code.fund_name", nameParam, "en_code.product_code")

  return `COALESCE(
    (SELECT bfl.beian_hao FROM private_fund_info_bfl bfl
     WHERE ${bflMatch} AND NULLIF(BTRIM(bfl.beian_hao), '') IS NOT NULL
     ORDER BY LEAST(
       ${sqlFundNameMatchPriority("bfl.product_name", nameParam)},
       ${sqlFundNameMatchPriority("bfl.short_name", nameParam)}
     ), length(bfl.product_name) ASC
     LIMIT 1),
    (SELECT pi.beian_hao FROM private_fund_info pi
     WHERE ${pinfoMatch} AND NULLIF(BTRIM(pi.beian_hao), '') IS NOT NULL
     ORDER BY ${sqlFundNameMatchPriority("pi.product_name", nameParam)}, length(pi.product_name) ASC
     LIMIT 1),
    (SELECT o.register_number FROM type6_ops_team_full o
     WHERE ${opsMatch} AND NULLIF(BTRIM(o.register_number), '') IS NOT NULL
     ORDER BY LEAST(
       ${sqlFundNameMatchPriority("o.fund_name", nameParam)},
       ${sqlFundNameMatchPriority("o.fund_short_name", nameParam)}
     ), o.updated_at DESC NULLS LAST, o.id DESC
     LIMIT 1),
    (SELECT fd.beian_hao FROM fof_underlying_detail fd
     WHERE ${detailMatch} AND NULLIF(BTRIM(fd.beian_hao), '') IS NOT NULL
     ORDER BY ${sqlFundNameMatchPriority("fd.product_name", nameParam)}
     LIMIT 1),
    (SELECT t.beian_hao FROM investment_tracking_fof_underlying t
     WHERE ${trackMatch} AND NULLIF(BTRIM(t.beian_hao), '') IS NOT NULL
     ORDER BY ${sqlFundNameMatchPriority("t.product_name", nameParam)}
     LIMIT 1),
    (SELECT en_code.product_code FROM ops_email_nav_records en_code
     WHERE NULLIF(BTRIM(en_code.product_code), '') IS NOT NULL
       AND ${emailMatch} AND ${emailShareClass}
     ORDER BY ${sqlFundNameMatchPriority("en_code.fund_name", nameParam)},
       en_code.nav_date DESC NULLS LAST, en_code.id DESC
     LIMIT 1)
  )`
}

/** Resolve a URL identifier to beian_hao (direct code lookup, then product name). */
export async function resolveFundBeianHao(identifier: string): Promise<string | null> {
  const id = identifier.trim()
  if (!id) return null

  const directRows = await query<{ code: string }>(
    `SELECT beian_hao AS code FROM private_fund_info WHERE beian_hao = $1
     UNION ALL
     SELECT beian_hao FROM private_fund_info_bfl WHERE beian_hao = $1
     UNION ALL
     SELECT register_number FROM type6_ops_team_full WHERE register_number = $1
     LIMIT 1`,
    [id],
  )
  if (directRows[0]?.code) return directRows[0].code

  const nameRows = await query<{ beian_hao: string | null }>(
    `SELECT ${buildFundNameLookupSql("$1")} AS beian_hao`,
    [id],
  )
  const resolved = nameRows[0]?.beian_hao?.trim()
  return resolved || null
}

export async function resolveRouteFundId(raw: string): Promise<string> {
  const resolved = await resolveFundBeianHao(raw)
  return resolved ?? raw.trim()
}
