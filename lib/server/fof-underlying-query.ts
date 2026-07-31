import {
  sqlEmailNavShareClassGuard,
  sqlFundNameMatch,
  sqlFundNameMatchPriority,
  sqlShareClassCodeGuard,
  sqlShareClassProductNameGuard,
} from "@/lib/server/fund-name-match"
import { query } from "@/lib/db"
import { ensureEmailNavTable } from "@/lib/server/email-nav-pg"
import {
  resolveManagedProductBeian,
  resolveManagedProductBeianIgnoringShareClass,
  lookupManagedProductOverride,
  remapManagedProductBeianCode,
} from "@/lib/server/managed-product-beian"
import { resolveFofValuationCodeAlias } from "@/lib/server/fund-holding-code"
import { shareClassProductNamesMatch } from "@/lib/server/fund-name-match"
import { sqlCanonicalShareClassBeian } from "@/lib/server/share-class-product"
import { lookupTeamDataProductFundInfo } from "@/lib/server/team-data-query-pg"

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
          AND ${sqlShareClassProductNameGuard("bfl.product_name", productNameExpr)}
          AND ${sqlShareClassProductNameGuard("COALESCE(bfl.short_name, bfl.product_name)", productNameExpr)}
          AND ${sqlShareClassCodeGuard("bfl.beian_hao", productNameExpr)}
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
          AND ${sqlShareClassProductNameGuard("pi.product_name", productNameExpr)}
          AND ${sqlShareClassCodeGuard("pi.beian_hao", productNameExpr)}
        ORDER BY ${sqlFundNameMatchPriority("pi.product_name", productNameExpr)}, length(pi.product_name) ASC
        LIMIT 1
      ) pi ON true
      LEFT JOIN LATERAL (
        SELECT register_number, fund_short_name,
               company_strategy_one, company_strategy_two, company_strategy_three,
               platform_strategy_one, platform_strategy_two, platform_strategy_three,
               tag
        FROM type6_ops_team_full o
        WHERE ${opsMatch}
          AND ${sqlShareClassProductNameGuard("COALESCE(o.fund_short_name, o.fund_name)", productNameExpr)}
          AND ${sqlShareClassCodeGuard("o.register_number", productNameExpr)}
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
          AND ${sqlShareClassProductNameGuard("fd.product_name", productNameExpr)}
          AND ${sqlShareClassCodeGuard("fd.beian_hao", productNameExpr)}
        ORDER BY ${sqlFundNameMatchPriority("fd.product_name", productNameExpr)}
        LIMIT 1
      ) fd ON true
      LEFT JOIN LATERAL (
        SELECT beian_hao
        FROM investment_tracking_fof_underlying t
        WHERE ${trackMatch}
          AND NULLIF(BTRIM(t.beian_hao), '') IS NOT NULL
          AND ${sqlShareClassProductNameGuard("t.product_name", productNameExpr)}
          AND ${sqlShareClassCodeGuard("t.beian_hao", productNameExpr)}
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
  // Prefer share-class-correct codes, and collapse mistaken S-prefixed tier codes
  // (SBTH74B → BTH74B) so FOF cache matches 运维团队数据 / basicinfo_bfl_track keys.
  return `${sqlCanonicalShareClassBeian(
    `CASE WHEN ${sqlShareClassCodeGuard(col, productNameExpr)} THEN ${col} END`,
  )}`
}

/** Resolve 备案号 preferring share-class-specific codes (e.g. VN917B over SVN917 for B类). */
export function fofUnderlyingBeianExpr(productNameExpr: string): string {
  return `COALESCE(
    ${guardedBeianCol("fd.beian_hao", productNameExpr)},
    ${guardedBeianCol("t.beian_hao", productNameExpr)},
    ${guardedBeianCol("en_code.product_code", productNameExpr)},
    ${guardedBeianCol("b.beian_hao", productNameExpr)},
    ${guardedBeianCol("pi.beian_hao", productNameExpr)},
    ${guardedBeianCol("o.register_number", productNameExpr)}
  )`
}

/** Default beian expr for fof_underlying_summary (alias f). */
export const FOF_UNDERLYING_BEIAN_EXPR = fofUnderlyingBeianExpr("f.product_name")

/** Default beian expr for managed_products (alias m). */
export const MANAGED_PRODUCTS_BEIAN_EXPR = fofUnderlyingBeianExpr("m.product_name")

const FUND_LEGAL_SUFFIX_STRIP_RE = "(私募证券投资基金|私募基金|证券投资基金|投资基金)$"

export function fofUnderlyingShortExpr(productNameExpr: string): string {
  return `CASE
    WHEN ${productNameExpr} ~ '[ABC]类'
    THEN ${productNameExpr}
    ELSE REGEXP_REPLACE(
      COALESCE(NULLIF(BTRIM(b.short_name), ''), NULLIF(BTRIM(o.fund_short_name), ''), ${productNameExpr}),
      '${FUND_LEGAL_SUFFIX_STRIP_RE}',
      ''
    )
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
       AND ${sqlShareClassProductNameGuard("fd.product_name", nameParam)}
       AND ${sqlShareClassCodeGuard("fd.beian_hao", nameParam)}
     ORDER BY ${sqlFundNameMatchPriority("fd.product_name", nameParam)}
     LIMIT 1)`
  const tLookup = `(SELECT t.beian_hao FROM investment_tracking_fof_underlying t
     WHERE ${trackMatch} AND NULLIF(BTRIM(t.beian_hao), '') IS NOT NULL
       AND ${sqlShareClassProductNameGuard("t.product_name", nameParam)}
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
       AND ${sqlShareClassProductNameGuard("bfl.product_name", nameParam)}
       AND ${sqlShareClassProductNameGuard("COALESCE(bfl.short_name, bfl.product_name)", nameParam)}
       AND ${sqlShareClassCodeGuard("bfl.beian_hao", nameParam)}
     ORDER BY LEAST(
       ${sqlFundNameMatchPriority("bfl.product_name", nameParam)},
       ${sqlFundNameMatchPriority("bfl.short_name", nameParam)}
     ), length(bfl.product_name) ASC
     LIMIT 1)`
  const piLookup = `(SELECT pi.beian_hao FROM private_fund_info pi
     WHERE ${pinfoMatch} AND NULLIF(BTRIM(pi.beian_hao), '') IS NOT NULL
       AND ${sqlShareClassProductNameGuard("pi.product_name", nameParam)}
       AND ${sqlShareClassCodeGuard("pi.beian_hao", nameParam)}
     ORDER BY ${sqlFundNameMatchPriority("pi.product_name", nameParam)}, length(pi.product_name) ASC
     LIMIT 1)`
  const opsLookup = `(SELECT o.register_number FROM type6_ops_team_full o
     WHERE ${opsMatch} AND NULLIF(BTRIM(o.register_number), '') IS NOT NULL
       AND ${sqlShareClassProductNameGuard("COALESCE(o.fund_short_name, o.fund_name)", nameParam)}
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
    ${opsLookup}
  )`
}

/** Map A/B/C share-class codes to the main managed product beian when applicable. */
async function resolveManagedProductMainBeian(shareClassCode: string): Promise<string | null> {
  const code = shareClassCode.trim()
  if (!code || !/[ABC]$/i.test(code)) return null

  try {
    const byResolvedBeian = await query<{ product_name: string }>(
      `SELECT m.product_name
       ${buildManagedProductsFrom("m.product_name")}
       WHERE m.product_name <> '合计'
         AND m.product_name NOT ILIKE '%A类%'
         AND m.product_name NOT ILIKE '%B类%'
         AND m.product_name NOT ILIKE '%C类%'
         AND ${fofUnderlyingBeianExpr("m.product_name")} = $1
       LIMIT 1`,
      [code],
    )
    const managedName = byResolvedBeian[0]?.product_name?.trim()
    if (managedName) {
      const override = resolveManagedProductBeian(managedName)
      if (override) return override
      const beianRows = await query<{ beian_hao: string | null }>(
        `SELECT ${buildFundNameLookupSql("$1")} AS beian_hao`,
        [managedName],
      )
      const resolved = beianRows[0]?.beian_hao?.trim()
      if (resolved && resolved !== code && !/[ABC]$/i.test(resolved)) return resolved
    }

    const bflRows = await query<{ product_name: string; short_name: string | null }>(
      `SELECT product_name, short_name
       FROM private_fund_info_bfl
       WHERE beian_hao = $1
       LIMIT 1`,
      [code],
    )
    const className = (bflRows[0]?.short_name ?? bflRows[0]?.product_name ?? "").trim()
    if (!className) return null

    const managedRows = await query<{ product_name: string }>(
      `SELECT m.product_name
       FROM managed_products m
       WHERE m.product_name <> '合计'
         AND m.product_name NOT ILIKE '%A类%'
         AND m.product_name NOT ILIKE '%B类%'
         AND m.product_name NOT ILIKE '%C类%'
         AND ${sqlFundNameMatch("m.product_name", "$1")}
       LIMIT 1`,
      [className],
    )
    const productName = managedRows[0]?.product_name?.trim()
    if (!productName) return null

    const override = resolveManagedProductBeian(productName)
    if (override) return override

    const beianRows = await query<{ beian_hao: string | null }>(
      `SELECT ${buildFundNameLookupSql("$1")} AS beian_hao`,
      [productName],
    )
    const resolved = beianRows[0]?.beian_hao?.trim()
    if (resolved && resolved !== code && !/[ABC]$/i.test(resolved)) return resolved
  } catch {
    // managed_products / lookup tables may be unavailable
  }

  return null
}

/** Map 估值表 holding codes (e.g. SALF51) to canonical 备案号 (ALF51B). */
async function resolveFundBeianViaParentCode(code: string): Promise<string | null> {
  const c = code.trim().toUpperCase()
  if (!c) return null

  const aliased = resolveFofValuationCodeAlias(c)
  if (aliased) return aliased

  if (!/^S[A-Z0-9]+$/i.test(c)) return null

  const rows = await query<{ beian_hao: string; product_name: string }>(
    `SELECT beian_hao, product_name
     FROM private_fund_info_bfl
     WHERE $1 = 'S' || regexp_replace(UPPER(BTRIM(beian_hao)), '[ABC]$', '')
     ORDER BY beian_hao
     LIMIT 8`,
    [c],
  )
  if (rows.length === 0) return null
  if (rows.length === 1) return rows[0].beian_hao

  const holdingRows = await query<{ underlying_name: string }>(
    `SELECT DISTINCT TRIM(underlying_name) AS underlying_name
     FROM ops_managed_fof_underlying
     WHERE UPPER(TRIM(COALESCE(underlying_product_code, ''))) = $1
     LIMIT 1`,
    [c],
  ).catch(() => [] as { underlying_name: string }[])

  const holdingName = holdingRows[0]?.underlying_name
  if (holdingName) {
    const matched = rows.find(
      (row) =>
        shareClassProductNamesMatch(row.product_name, holdingName)
        || shareClassProductNamesMatch(holdingName, row.product_name),
    )
    if (matched) return matched.beian_hao
  }

  return rows[0]?.beian_hao ?? null
}

async function lookupFundInfoByBeianCode(beianHao: string): Promise<FundInfoLookupRow | null> {
  const code = beianHao.trim()
  if (!code) return null

  const infoRows = await query<FundInfoLookupRow>(
    `SELECT beian_hao, product_name, NULL::text AS short_name, strategy_l1, strategy_l2, NULL::text AS strategy_l3, manager,
            inception_date::text AS inception_date, benchmark,
            ret_1w::text, ret_1m::text, ret_3m::text, ret_6m::text, ret_1y::text,
            sharpe_1y::text, calmar_1y::text
     FROM private_fund_info WHERE beian_hao = $1`,
    [code],
  )
  if (infoRows[0]) return infoRows[0]

  const bflRows = await query<FundInfoLookupRow>(
    `SELECT beian_hao, product_name, short_name,
            strategy_one AS strategy_l1,
            strategy_two AS strategy_l2,
            strategy_three AS strategy_l3,
            ''::text AS manager,
            NULL::text AS inception_date,
            NULL::text AS benchmark,
            NULL::text AS ret_1w, NULL::text AS ret_1m, NULL::text AS ret_3m,
            NULL::text AS ret_6m, NULL::text AS ret_1y,
            NULL::text AS sharpe_1y, NULL::text AS calmar_1y
     FROM private_fund_info_bfl
     WHERE beian_hao = $1`,
    [code],
  )
  return bflRows[0] ?? null
}

/** Resolve fund metadata from FOF底层 pool when absent from main fund tables. */
async function lookupFofUnderlyingFundInfo(identifier: string): Promise<FundInfoLookupRow | null> {
  const id = decodeFundIdentifier(identifier)
  if (!id) return null

  try {
    const cacheRows = await query<{
      beian_hao: string | null
      product_name: string
      short_name: string | null
    }>(
      `SELECT beian_hao, product_name, short_name
       FROM ops_fof_overview_list_cache
       WHERE UPPER(BTRIM(COALESCE(beian_hao, ''))) = UPPER(BTRIM($1))
          OR ${sqlFundNameMatch("product_name", "$1")}
          OR (short_name IS NOT NULL AND ${sqlFundNameMatch("short_name", "$1")})
       ORDER BY CASE WHEN UPPER(BTRIM(COALESCE(beian_hao, ''))) = UPPER(BTRIM($1)) THEN 0 ELSE 1 END
       LIMIT 1`,
      [id],
    )
    if (cacheRows[0]) {
      const row = cacheRows[0]
      const canonical =
        resolveFofValuationCodeAlias(row.beian_hao)
        ?? resolveFofValuationCodeAlias(id)
        ?? (await resolveFundBeianViaParentCode(row.beian_hao ?? id))
        ?? row.beian_hao?.trim()
        ?? null
      if (canonical) {
        const fromBfl = await lookupFundInfoByBeianCode(canonical)
        if (fromBfl) return { ...fromBfl, ...EMPTY_FUND_METRICS }
      }
      return {
        beian_hao: canonical ?? row.beian_hao ?? id,
        product_name: row.product_name,
        short_name: row.short_name,
        strategy_l1: null,
        strategy_l2: null,
        strategy_l3: null,
        ...EMPTY_FUND_METRICS,
      }
    }
  } catch {
    // cache table may not exist yet
  }

  try {
    const holdingRows = await query<{ underlying_name: string; underlying_product_code: string | null }>(
      `SELECT DISTINCT TRIM(underlying_name) AS underlying_name,
              NULLIF(TRIM(UPPER(underlying_product_code)), '') AS underlying_product_code
       FROM ops_managed_fof_underlying
       WHERE COALESCE(market_value, 0) > 0
         AND UPPER(TRIM(COALESCE(underlying_product_code, ''))) = UPPER(BTRIM($1))
       LIMIT 1`,
      [id],
    )
    if (holdingRows[0]) {
      const holdingName = holdingRows[0].underlying_name
      const canonical =
        resolveFofValuationCodeAlias(holdingRows[0].underlying_product_code)
        ?? resolveFofValuationCodeAlias(id)
        ?? (await resolveFundBeianViaParentCode(id))
      if (canonical) {
        const fromBfl = await lookupFundInfoByBeianCode(canonical)
        if (fromBfl) return { ...fromBfl, ...EMPTY_FUND_METRICS }
      }
      const bflByName = await query<FundInfoLookupRow>(
        `SELECT beian_hao, product_name, short_name,
                strategy_one AS strategy_l1,
                strategy_two AS strategy_l2,
                strategy_three AS strategy_l3,
                ''::text AS manager,
                NULL::text AS inception_date,
                NULL::text AS benchmark,
                NULL::text AS ret_1w, NULL::text AS ret_1m, NULL::text AS ret_3m,
                NULL::text AS ret_6m, NULL::text AS ret_1y,
                NULL::text AS sharpe_1y, NULL::text AS calmar_1y
         FROM private_fund_info_bfl bfl
         WHERE (${sqlFundNameMatch("bfl.product_name", "$1")}
            OR ${sqlFundNameMatch("bfl.short_name", "$1")})
           AND ${sqlShareClassProductNameGuard("bfl.product_name", "$1")}
         ORDER BY LEAST(
           ${sqlFundNameMatchPriority("bfl.product_name", "$1")},
           ${sqlFundNameMatchPriority("bfl.short_name", "$1")}
         )
         LIMIT 1`,
        [holdingName],
      )
      if (bflByName[0]) return { ...bflByName[0], ...EMPTY_FUND_METRICS }
    }
  } catch {
    // managed table may not exist
  }

  return null
}

/** Resolve a URL identifier to beian_hao (direct code lookup, then product name). */
export async function resolveFundBeianHao(identifier: string): Promise<string | null> {
  const id = identifier.trim()
  if (!id) return null

  const aliased = resolveFofValuationCodeAlias(id)
  if (aliased) return aliased

  const directRows = await query<{ code: string }>(
    `SELECT beian_hao AS code FROM private_fund_info WHERE beian_hao = $1
     UNION ALL
     SELECT beian_hao FROM private_fund_info_bfl WHERE beian_hao = $1
     UNION ALL
     SELECT register_number FROM type6_ops_team_full WHERE register_number = $1
     LIMIT 1`,
    [id],
  )
  if (directRows[0]?.code) {
    return directRows[0].code
  }

  const managedOverride = resolveManagedProductBeian(id)
  if (managedOverride) return managedOverride

  const remapped = remapManagedProductBeianCode(id)
  if (remapped) return remapped

  const viaParent = await resolveFundBeianViaParentCode(id)
  if (viaParent) return viaParent

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

  const aliased = resolveFofValuationCodeAlias(id)
  if (aliased && aliased !== id) {
    const fromAlias = await lookupFundInfoFallback(aliased)
    if (fromAlias) return fromAlias
  }

  const managedOverride = lookupManagedProductOverride(id)
  if (managedOverride) {
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
        [managedOverride.product_name],
      )
      strategy_l1 = metaRows[0]?.strategy_l1 ?? null
      strategy_l2 = metaRows[0]?.strategy_l2 ?? null
    } catch {
      // optional metadata
    }
    return {
      beian_hao: managedOverride.beian_hao,
      product_name: managedOverride.product_name,
      short_name: managedOverride.product_name,
      strategy_l1,
      strategy_l2,
      strategy_l3: null,
      ...EMPTY_FUND_METRICS,
    }
  }

  try {
    const managedRows = await query<{ product_name: string }>(
      `SELECT m.product_name
       FROM managed_products m
       WHERE m.product_name <> '合计'
         AND ${sqlFundNameMatch("m.product_name", "$1")}
         AND ${sqlShareClassProductNameGuard("m.product_name", "$1")}
       LIMIT 1`,
      [id],
    )
    if (managedRows[0]?.product_name) {
      const productName = managedRows[0].product_name
      let beian_hao = resolveManagedProductBeian(productName, productName) ?? productName
      try {
        const beianRows = await query<{ beian_hao: string | null }>(
          `SELECT ${buildFundNameLookupSql("$1")} AS beian_hao`,
          [productName],
        )
        beian_hao = resolveManagedProductBeian(productName, beianRows[0]?.beian_hao?.trim()) ?? productName
      } catch {
        // keep override / product name as identifier
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
       WHERE (${sqlFundNameMatch("bfl.product_name", "$1")}
          OR ${sqlFundNameMatch("bfl.short_name", "$1")})
         AND ${sqlShareClassProductNameGuard("bfl.product_name", "$1")}
         AND ${sqlShareClassProductNameGuard("COALESCE(bfl.short_name, bfl.product_name)", "$1")}
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
       WHERE (${sqlFundNameMatch("o.fund_name", "$1")}
          OR ${sqlFundNameMatch("o.fund_short_name", "$1")})
         AND ${sqlShareClassProductNameGuard("COALESCE(o.fund_short_name, o.fund_name)", "$1")}
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

  // FOF list / holdings before email: Guotai TA-virtual rows often store the
  // investor (e.g. 荣熙共赢A类) under the underlying product_code (AVM35A).
  const fromFof = await lookupFofUnderlyingFundInfo(id)
  if (fromFof) return fromFof

  const viaParent = await resolveFundBeianViaParentCode(id)
  if (viaParent && viaParent !== id) {
    const fromParent = await lookupFundInfoByBeianCode(viaParent)
    if (fromParent) return { ...fromParent, ...EMPTY_FUND_METRICS }
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
       ) OR (
         ${sqlFundNameMatch("fund_name", "$1")}
         AND ${sqlEmailNavShareClassGuard("fund_name", "$1", "product_code")}
       )
       ORDER BY nav_date DESC NULLS LAST, id DESC
       LIMIT 20`,
      [id],
    )
    for (const row of emailRows) {
      if (!row.product_name) continue
      const beian =
        resolveFofValuationCodeAlias(row.beian_hao)
        ?? (row.beian_hao || row.product_name)
      const managedInvestorBeian = resolveManagedProductBeianIgnoringShareClass(row.product_name)
      // Skip investor-as-fund labels when the row is keyed by a different underlying code.
      if (
        managedInvestorBeian
        && beian
        && managedInvestorBeian.toUpperCase() !== String(beian).toUpperCase()
      ) {
        continue
      }
      if (beian !== row.beian_hao) {
        const fromAlias = await lookupFundInfoByBeianCode(beian)
        if (fromAlias) return { ...fromAlias, ...EMPTY_FUND_METRICS }
      }
      return {
        beian_hao: beian,
        product_name: row.product_name,
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

  try {
    const fromTeamData = await lookupTeamDataProductFundInfo(id)
    if (fromTeamData) {
      return {
        ...fromTeamData,
        ...EMPTY_FUND_METRICS,
      }
    }
  } catch (e) {
    console.error("[lookupFundInfoFallback] ops_team_data_products", e)
  }

  return null
}
