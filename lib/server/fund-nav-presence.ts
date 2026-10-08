import { query } from "@/lib/db"

const MAX_CODES = 200

/**
 * Exact 备案号 plus S-prefix / stripped-S aliases.
 * Kept local so search does not import the team-nav module graph.
 * Same rules as teamNavBeianLookupCodes.
 */
function navLookupCodes(beian: string): string[] {
  const raw = beian.trim()
  const upper = raw.toUpperCase()
  if (!upper) return []
  const out = new Set<string>([raw, upper])
  if (upper.startsWith("S") && upper.length > 5) out.add(upper.slice(1))
  else out.add(`S${upper}`)
  if (upper.startsWith("S") && !upper.startsWith("SS")) out.add(`S${upper}`)
  return [...out]
}

function existsSql(table: string, column: string, extra = ""): string {
  return `
    SELECT c.code
    FROM unnest($1::text[]) AS c(code)
    WHERE EXISTS (
      SELECT 1 FROM ${table} t
      WHERE t.${column} = c.code
      ${extra}
    )
  `
}

const NAV_SOURCE_SQL = [
  existsSql("private_fund_nav", "beian_hao"),
  existsSql("private_fund_nav_group", "beian_hao"),
  existsSql("private_fund_nav_group_hy", "beian_hao"),
  existsSql("private_fund_nav_group_type6", "beian_hao"),
  existsSql("ops_email_nav_records", "product_code", "AND t.nav IS NOT NULL"),
  existsSql("private_fund_info", "beian_hao", "AND t.latest_nav IS NOT NULL"),
] as const

const MANUAL_NAV_SQL = existsSql("ops_team_nav_manual", "beian_hao")

const CACHE_NAV_SQL = existsSql(
  "ops_private_fund_detail_nav_cache",
  "beian_hao",
  "AND jsonb_typeof(t.nav_series) = 'array' AND jsonb_array_length(t.nav_series) > 0",
)

async function codesFrom(sql: string, lookup: string[], label: string): Promise<string[] | null> {
  try {
    const rows = await query<{ code: string | null }>(sql, [lookup])
    return rows.map((row) => row.code).filter((code): code is string => Boolean(code && code.trim()))
  } catch (err) {
    console.error(`[fund-nav-presence] ${label}`, err)
    return null
  }
}

/**
 * Which of the requested 备案号 already have stored NAV
 * (火富牛 / 分组净值 / 邮箱托管 / 团队手工 / 详情缓存).
 * Returns null when the core lookup fails, so callers can skip the label
 * instead of marking every product as having no NAV.
 * Keys are the requested codes, uppercased.
 */
export async function lookupBeianCodesWithNav(codes: string[]): Promise<Set<string> | null> {
  const requested = [...new Set(codes.map((code) => code.trim()).filter(Boolean))].slice(0, MAX_CODES)
  if (requested.length === 0) return new Set()

  const owners = new Map<string, Set<string>>()
  const lookupSet = new Set<string>()
  for (const code of requested) {
    const owner = code.toUpperCase()
    for (const alias of navLookupCodes(code)) {
      const key = alias.toUpperCase()
      let bucket = owners.get(key)
      if (!bucket) {
        bucket = new Set()
        owners.set(key, bucket)
      }
      bucket.add(owner)
      lookupSet.add(alias)
    }
  }
  const lookup = [...lookupSet]

  const sources = await Promise.all([
    ...NAV_SOURCE_SQL.map((sql, index) => codesFrom(sql, lookup, `source-${index}`)),
    codesFrom(MANUAL_NAV_SQL, lookup, "manual"),
    codesFrom(CACHE_NAV_SQL, lookup, "cache"),
  ])
  const succeeded = sources.filter((rows): rows is string[] => rows !== null)
  if (succeeded.length === 0) return null

  const present = new Set<string>()
  const mark = (code: string) => {
    const hits = owners.get(code.trim().toUpperCase())
    if (!hits) return
    for (const owner of hits) present.add(owner)
  }
  for (const rows of succeeded) {
    for (const code of rows) mark(code)
  }
  return present
}
