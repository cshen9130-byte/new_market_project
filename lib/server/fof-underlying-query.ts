import {
  sqlEmailNavShareClassGuard,
  sqlFundNameMatch,
  sqlFundNameMatchPriority,
  sqlShareClassCodeGuard,
} from "@/lib/server/fund-name-match"
import { query } from "@/lib/db"
import { ensureEmailNavTable } from "@/lib/server/email-nav-pg"

function decodeFundIdentifier(raw: string): string {
  try {
    return decodeURIComponent(raw).trim()
  } catch {
    return raw.trim()
  }
}

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

function guardedBeianCol(col: string, productNameExpr: string): string {
  return `NULLIF(BTRIM(CASE WHEN ${sqlShareClassCodeGuard(col, productNameExpr)} THEN ${col} END), '')`
}

/** Resolve 备案号 preferring share-class-specific codes (e.g. VN917B over SVN917 for B类). */
export function fofUnderlyingBeianExpr(productNameExpr: string): string {
  return `COALESCE(
    ${guardedBeianCol("fd.beian_hao", productNameExpr)},
    ${guardedBeianCol("t.beian_hao", productNameExpr)},
    ${guardedBeianCol("en_code.product_code", productNameExpr)},
    ${guardedBeianCol("b.beian_hao", productNameExpr)},
    ${guardedBeianCol("pi.beian_hao", productNameExpr)},
    ${guardedBeianCol("o.register_number", productNameExpr)},
    NULLIF(BTRIM(fd.beian_hao), ''),
    NULLIF(BTRIM(t.beian_hao), ''),
    NULLIF(BTRIM(en_code.product_code), ''),
    NULLIF(BTRIM(b.beian_hao), ''),
    NULLIF(BTRIM(pi.beian_hao), ''),
    NULLIF(BTRIM(o.register_number), '')
  )`
}

/** Default beian expr for fof_underlying_summary (alias f). */
export const FOF_UNDERLYING_BEIAN_EXPR = fofUnderlyingBeianExpr("f.product_name")

export function fofUnderlyingShortExpr(productNameExpr: string): string {
  return `CASE
    WHEN ${productNameExpr} ~ '[ABC]类'
    THEN ${productNameExpr}
    ELSE COALESCE(b.short_name, o.fund_short_name, ${productNameExpr})
  END`
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

  const fdLookup = `(SELECT fd.beian_hao FROM fof_underlying_detail fd
     WHERE ${detailMatch} AND NULLIF(BTRIM(fd.beian_hao), '') IS NOT NULL
       AND ${sqlShareClassCodeGuard("fd.beian_hao", nameParam)}
     ORDER BY ${sqlFundNameMatchPriority("fd.product_name", nameParam)}
     LIMIT 1)`
  const tLookup = `(SELECT t.beian_hao FROM investment_tracking_fof_underlying t
     WHERE ${trackMatch} AND NULLIF(BTRIM(t.beian_hao), '') IS NOT NULL
       AND ${sqlShareClassCodeGuard("t.beian_hao", nameParam)}
     ORDER BY ${sqlFundNameMatchPriority("t.product_name", nameParam)}
     LIMIT 1)`
  const emailLookup = `(SELECT en_code.product_code FROM ops_email_nav_records en_code
     WHERE NULLIF(BTRIM(en_code.product_code), '') IS NOT NULL
       AND ${emailMatch} AND ${emailShareClass}
       AND ${sqlShareClassCodeGuard("en_code.product_code", nameParam)}
     ORDER BY ${sqlFundNameMatchPriority("en_code.fund_name", nameParam)},
       en_code.nav_date DESC NULLS LAST, en_code.id DESC
     LIMIT 1)`
  const bflLookup = `(SELECT bfl.beian_hao FROM private_fund_info_bfl bfl
     WHERE ${bflMatch} AND NULLIF(BTRIM(bfl.beian_hao), '') IS NOT NULL
       AND ${sqlShareClassCodeGuard("bfl.beian_hao", nameParam)}
     ORDER BY LEAST(
       ${sqlFundNameMatchPriority("bfl.product_name", nameParam)},
       ${sqlFundNameMatchPriority("bfl.short_name", nameParam)}
     ), length(bfl.product_name) ASC
     LIMIT 1)`
  const piLookup = `(SELECT pi.beian_hao FROM private_fund_info pi
     WHERE ${pinfoMatch} AND NULLIF(BTRIM(pi.beian_hao), '') IS NOT NULL
       AND ${sqlShareClassCodeGuard("pi.beian_hao", nameParam)}
     ORDER BY ${sqlFundNameMatchPriority("pi.product_name", nameParam)}, length(pi.product_name) ASC
     LIMIT 1)`
  const opsLookup = `(SELECT o.register_number FROM type6_ops_team_full o
     WHERE ${opsMatch} AND NULLIF(BTRIM(o.register_number), '') IS NOT NULL
       AND ${sqlShareClassCodeGuard("o.register_number", nameParam)}
     ORDER BY LEAST(
       ${sqlFundNameMatchPriority("o.fund_name", nameParam)},
       ${sqlFundNameMatchPriority("o.fund_short_name", nameParam)}
     ), o.updated_at DESC NULLS LAST, o.id DESC
     LIMIT 1)`

  return `COALESCE(
    ${fdLookup},
    ${tLookup},
    ${emailLookup},
    ${bflLookup},
    ${piLookup},
    ${opsLookup},
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
     LIMIT 1),
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

  try {
    const nameRows = await query<{ beian_hao: string | null }>(
      `SELECT ${buildFundNameLookupSql("$1")} AS beian_hao`,
      [id],
    )
    const resolved = nameRows[0]?.beian_hao?.trim()
    if (resolved) return resolved
  } catch {
    // ops_email_nav_records or lookup tables may be unavailable
  }

  return null
}

export async function resolveRouteFundId(raw: string): Promise<string> {
  const id = decodeFundIdentifier(raw)
  const resolved = await resolveFundBeianHao(id)
  return resolved ?? id
}

export type FundInfoLookupRow = {
  beian_hao: string
  product_name: string
  short_name: string | null
  strategy_l1: string | null
  strategy_l2: string | null
  strategy_l3: string | null
  manager: string
  inception_date: string | null
  benchmark: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y: string | null
  sharpe_1y: string | null
  calmar_1y: string | null
}

const EMPTY_FUND_METRICS = {
  manager: "",
  inception_date: null,
  benchmark: null,
  ret_1w: null,
  ret_1m: null,
  ret_3m: null,
  ret_6m: null,
  ret_1y: null,
  sharpe_1y: null,
  calmar_1y: null,
} as const

/** Resolve fund metadata by product name or email product code (e.g. SBPC69). */
export async function lookupFundInfoFallback(identifier: string): Promise<FundInfoLookupRow | null> {
  const id = decodeFundIdentifier(identifier)
  if (!id) return null

  try {
    const managedRows = await query<{ product_name: string }>(
      `SELECT m.product_name
       FROM managed_products m
       WHERE m.product_name <> '合计'
         AND ${sqlFundNameMatch("m.product_name", "$1")}
       LIMIT 1`,
      [id],
    )
    if (managedRows[0]?.product_name) {
      const productName = managedRows[0].product_name
      let beian_hao = productName
      try {
        const beianRows = await query<{ beian_hao: string | null }>(
          `SELECT ${buildFundNameLookupSql("$1")} AS beian_hao`,
          [productName],
        )
        beian_hao = beianRows[0]?.beian_hao?.trim() || productName
      } catch {
        // keep product name as identifier
      }

      let strategy_l1: string | null = null
      let strategy_l2: string | null = null
      try {
        const metaRows = await query<{ strategy_l1: string | null; strategy_l2: string | null }>(
          `SELECT o.company_strategy_one AS strategy_l1, o.company_strategy_two AS strategy_l2
           FROM type6_ops_team_full o
           WHERE ${sqlFundNameMatch("o.fund_name", "$1")}
              OR ${sqlFundNameMatch("o.fund_short_name", "$1")}
           ORDER BY o.updated_at DESC NULLS LAST, o.id DESC
           LIMIT 1`,
          [productName],
        )
        strategy_l1 = metaRows[0]?.strategy_l1 ?? null
        strategy_l2 = metaRows[0]?.strategy_l2 ?? null
      } catch {
        // optional metadata
      }

      return {
        beian_hao,
        product_name: productName,
        short_name: productName,
        strategy_l1,
        strategy_l2,
        strategy_l3: null,
        ...EMPTY_FUND_METRICS,
      }
    }
  } catch (e) {
    console.error("[lookupFundInfoFallback] managed_products", e)
  }

  try {
    const bflRows = await query<{
      beian_hao: string
      product_name: string
      short_name: string | null
      strategy_l1: string | null
      strategy_l2: string | null
      strategy_l3: string | null
    }>(
      `SELECT beian_hao, product_name, short_name,
              strategy_one AS strategy_l1,
              strategy_two AS strategy_l2,
              strategy_three AS strategy_l3
       FROM private_fund_info_bfl bfl
       WHERE ${sqlFundNameMatch("bfl.product_name", "$1")}
          OR ${sqlFundNameMatch("bfl.short_name", "$1")}
       ORDER BY LEAST(
         ${sqlFundNameMatchPriority("bfl.product_name", "$1")},
         ${sqlFundNameMatchPriority("bfl.short_name", "$1")}
       )
       LIMIT 1`,
      [id],
    )
    if (bflRows[0]) {
      return { ...bflRows[0], ...EMPTY_FUND_METRICS }
    }
  } catch (e) {
    console.error("[lookupFundInfoFallback] private_fund_info_bfl", e)
  }

  try {
    const opsRows = await query<{
      beian_hao: string
      product_name: string
      short_name: string | null
      strategy_l1: string | null
      strategy_l2: string | null
      strategy_l3: string | null
    }>(
      `SELECT register_number AS beian_hao,
              COALESCE(fund_short_name, fund_name) AS product_name,
              fund_name AS short_name,
              company_strategy_one AS strategy_l1,
              company_strategy_two AS strategy_l2,
              company_strategy_three AS strategy_l3
       FROM type6_ops_team_full o
       WHERE ${sqlFundNameMatch("o.fund_name", "$1")}
          OR ${sqlFundNameMatch("o.fund_short_name", "$1")}
       ORDER BY o.updated_at DESC NULLS LAST, o.id DESC
       LIMIT 1`,
      [id],
    )
    if (opsRows[0]) {
      return { ...opsRows[0], ...EMPTY_FUND_METRICS }
    }
  } catch (e) {
    console.error("[lookupFundInfoFallback] type6_ops_team_full", e)
  }

  try {
    await ensureEmailNavTable()
    const emailRows = await query<{
      beian_hao: string
      product_name: string
    }>(
      `SELECT
         COALESCE(NULLIF(BTRIM(product_code), ''), NULLIF(BTRIM(fund_name), '')) AS beian_hao,
         COALESCE(NULLIF(BTRIM(fund_name), ''), NULLIF(BTRIM(product_code), '')) AS product_name
       FROM ops_email_nav_records
       WHERE (
         NULLIF(BTRIM(product_code), '') IS NOT NULL AND UPPER(BTRIM(product_code)) = UPPER(BTRIM($1))
       ) OR ${sqlFundNameMatch("fund_name", "$1")}
       ORDER BY nav_date DESC NULLS LAST, id DESC
       LIMIT 1`,
      [id],
    )
    if (emailRows[0]?.product_name) {
      return {
        beian_hao: emailRows[0].beian_hao || emailRows[0].product_name,
        product_name: emailRows[0].product_name,
        short_name: null,
        strategy_l1: null,
        strategy_l2: null,
        strategy_l3: null,
        ...EMPTY_FUND_METRICS,
      }
    }
  } catch (e) {
    console.error("[lookupFundInfoFallback] ops_email_nav_records", e)
  }

  return null
}
