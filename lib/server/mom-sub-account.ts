/**
 * Optional MOM sub-account filter (rx000, rx319, …).
 *
 * Absent / empty account param: callers see the same SQL and the same full-MOM
 * result as before. A selected account rewrites only FROM/JOIN reads of the
 * settlement tables that carry that account, and always against public.mom_*.
 */
import { AsyncLocalStorage } from "node:async_hooks"
import { accountNumericId } from "@/lib/ma/quant-accounts"

const als = new AsyncLocalStorage<string | null>()

const ACCOUNT_TOKEN = /^(?:rx)?\d{1,8}$/i

/** `null` = no filter. `false` = the param is present but not a sub-account id. */
export function parseMomSubAccountParam(raw: string | null | undefined): string | null | false {
  const value = (raw ?? "").trim()
  if (!value || value === "all" || value === "*") return null
  if (!ACCOUNT_TOKEN.test(value)) return false
  const id = accountNumericId(value)
  if (!id || id.length > 8) return false
  return id
}

export function getMomSubAccountId(): string | null {
  return als.getStore() ?? null
}

export function momSubAccountAlsRun<T>(accountId: string | null, fn: () => T): T {
  return als.run(accountId, fn)
}

type ScopedTable = { name: string; column: string }

/** Settlement tables that store one row-set per MOM sub-account. */
const SCOPED_TABLES: ScopedTable[] = [
  { name: "mom_daily_reports", column: `"账户"` },
  { name: "mom_daily_report_fund_flows", column: `"账户"` },
  { name: "mom_futures_trade_details", column: `"账户"` },
  { name: "mom_options_trade_details", column: `"账户"` },
  { name: "mom_close_details", column: `"账户"` },
  { name: "mom_position_details", column: `"账户"` },
  { name: "mom_options_position_details", column: `"账户"` },
  { name: "mom_futures_position_details", column: `"账户"` },
  { name: "mom_order_details", column: `"账户"` },
  { name: "mom_summary_details", column: `"账户"` },
  // English column; the Chinese `"账户"` column is not on this table.
  { name: "mom_trade_details", column: "account" },
]

const TABLE_BY_NAME = new Map(SCOPED_TABLES.map((t) => [t.name, t]))

const ALIAS_KEYWORDS = new Set([
  "where", "group", "order", "limit", "offset", "union", "except", "intersect",
  "having", "window", "left", "right", "full", "inner", "cross", "join", "on",
  "and", "or", "natural", "using", "fetch", "for", "returning", "select", "from",
  "set", "values", "when", "then", "else", "end", "lateral", "rows", "range",
  "groups", "partition", "over", "asc", "desc", "nulls", "not", "is", "null",
  "in", "exists", "distinct", "as", "by", "into", "update", "delete", "insert",
  "with", "recursive", "true", "false", "between", "like", "ilike", "similar",
])

/** Same numeric id as `accountNumericId`, including rx000 → 0 (regexp alone yields ''). */
export function momAccountEqualsSql(column: string, paramIndex: number): string {
  return `COALESCE(NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(${column}::text), '[^0-9]', '', 'g'), '^0+', ''), ''), '0') = $${paramIndex}`
}

/**
 * Wrap each FROM/JOIN of a scoped table so the rest of the statement is unchanged.
 * Does nothing when the SQL does not read one of those tables.
 * Does not mutate `params`.
 */
export function applyMomSubAccountSql(
  sql: string,
  params: unknown[] | undefined,
  accountId: string,
): { sql: string; params: unknown[] | undefined } {
  const tableAlt = SCOPED_TABLES.map((t) => t.name).join("|")
  const re = new RegExp(`(?:\\bpublic\\s*\\.\\s*)?\\b(${tableAlt})\\b`, "gi")
  const matches = [...sql.matchAll(re)]
  if (matches.length === 0) return { sql, params }

  const nextParams = [...(params ?? []), accountId]
  const paramIndex = nextParams.length
  let out = ""
  let cursor = 0
  let wrapped = 0

  for (const match of matches) {
    const index = match.index ?? 0
    const raw = match[0]
    const table = match[1].toLowerCase()
    const spec = TABLE_BY_NAME.get(table)
    const before = sql.slice(0, index)
    const fromJoin = /\b(?:from|join|,)\s+$/i.test(before)
    if (!spec || !fromJoin) continue

    const after = sql.slice(index + raw.length)
    const aliasMatch = after.match(/^\s+(?:AS\s+)?([A-Za-z_][\w]*)/i)
    let alias = table
    let consume = 0
    if (aliasMatch && !ALIAS_KEYWORDS.has(aliasMatch[1].toLowerCase())) {
      alias = aliasMatch[1]
      consume = aliasMatch[0].length
    }

    const pred = momAccountEqualsSql(spec.column, paramIndex)
    out += sql.slice(cursor, index)
    out += `(SELECT * FROM public.${table} WHERE ${pred}) AS ${alias}`
    cursor = index + raw.length + consume
    wrapped += 1
  }

  if (wrapped === 0) return { sql, params }
  out += sql.slice(cursor)
  return { sql: out, params: nextParams }
}

/** No-op unless this request opted into a sub-account. */
export function scopeMomAccountQuery(
  sql: string,
  params?: unknown[],
): { sql: string; params?: unknown[] } {
  const id = getMomSubAccountId()
  if (!id) return { sql, params }
  return applyMomSubAccountSql(sql, params, id)
}
