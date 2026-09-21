/**
 * 最新变动日期: the Shanghai calendar day of the most recent write to a product
 * (NAV ingest/edit, 要素表, 团队策略/标签, 估值表, notes, NAV debug rules).
 * This is not 最新净值日期 (the NAV point's price_date).
 */

import { query } from "@/lib/db"
import { expandBeianLookupKeys } from "@/lib/server/fund-elements-lookup"
import { listFundNavCorrectionRules } from "@/lib/server/fund-nav-correction-rules"

const SHANGHAI_DAY = (col: string) => `(${col} AT TIME ZONE 'Asia/Shanghai')::date`

/** ORDER BY expression: greatest write timestamp for an exact 备案号. */
export function sqlLatestChangeAt(beianExpr: string, firstAddedExpr = "i.first_added_at"): string {
  return `(
    SELECT MAX(ts) FROM (
      SELECT MAX(updated_at) AS ts
        FROM basicinfo_bfl_track
       WHERE register_number = ${beianExpr} OR record_key = ${beianExpr}
      UNION ALL
      SELECT MAX(updated_at)
        FROM type6_ops_team_full
       WHERE register_number = ${beianExpr}
      UNION ALL
      SELECT MAX(created_at)
        FROM ops_email_nav_records
       WHERE product_code = ${beianExpr}
      UNION ALL
      SELECT ${firstAddedExpr}::timestamptz
    ) _product_chg(ts)
  )`
}

export type LatestChangeKind =
  | "elements"
  | "strategy"
  | "manualNav"
  | "emailNav"
  | "valuation"
  | "notes"
  | "personalTags"
  | "correction"
  | "firstEntry"

type ChangeHit = {
  day: string
  labels: string[]
}

type SourceRow = {
  code: string
  ts: string
  detail?: string | null
}

function maxDay(a: string | null | undefined, b: string | null | undefined): string | null {
  const left = (a ?? "").slice(0, 10)
  const right = (b ?? "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(left)) return /^\d{4}-\d{2}-\d{2}$/.test(right) ? right : null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(right)) return left
  return left >= right ? left : right
}

function isoDay(value: string | null | undefined): string | null {
  const day = (value ?? "").slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

function clipDetail(value: string | null | undefined, max = 40): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function formatChangeLabel(kind: LatestChangeKind, detail?: string | null): string {
  const extra = clipDetail(detail)
  switch (kind) {
    case "elements":
      return "要素表"
    case "strategy":
      return "团队策略/标签"
    case "manualNav":
      return extra ? `手工净值（净值日期 ${extra}）` : "手工净值"
    case "emailNav":
      return extra ? `净值（净值日期 ${extra}）` : "净值"
    case "valuation":
      return extra ? `估值表（估值日期 ${extra}）` : "估值表"
    case "notes":
      return extra ? `产品备注：${extra}` : "产品备注"
    case "personalTags":
      return extra ? `个人标签：${extra}` : "个人标签"
    case "correction":
      return extra ? `净值修正规则：${extra}` : "净值修正规则"
    case "firstEntry":
      return "首次入表"
  }
}

function putHit(
  map: Map<string, ChangeHit>,
  rawKey: string | null | undefined,
  day: string | null | undefined,
  kind: LatestChangeKind,
  detail?: string | null,
) {
  const key = String(rawKey ?? "").trim().toUpperCase()
  const value = isoDay(day)
  if (!key || !value) return
  mergeHit(map, key, { day: value, labels: [formatChangeLabel(kind, detail)] })
}

function mergeHit(map: Map<string, ChangeHit>, key: string, incoming: ChangeHit) {
  const prev = map.get(key)
  const next = combineHits(prev, incoming)
  if (next) map.set(key, next)
}

function combineHits(...hits: Array<ChangeHit | null | undefined>): ChangeHit | null {
  let best: ChangeHit | null = null
  for (const hit of hits) {
    if (!hit) continue
    if (!best || hit.day > best.day) {
      best = { day: hit.day, labels: [...hit.labels] }
      continue
    }
    if (hit.day === best.day) {
      for (const label of hit.labels) {
        if (!best.labels.includes(label)) best.labels.push(label)
      }
    }
  }
  return best
}

function joinLabels(hit: ChangeHit | null | undefined): string | null {
  if (!hit?.labels.length) return null
  return hit.labels.join("、")
}

function latestDetailExpr(valueExpr: string, orderExpr: string): string {
  return `(ARRAY_AGG(${valueExpr} ORDER BY ${orderExpr} DESC NULLS LAST) FILTER (WHERE ${valueExpr} IS NOT NULL))[1]`
}

async function loadChangeHitsByCode(codes: string[]): Promise<Map<string, ChangeHit>> {
  const out = new Map<string, ChangeHit>()
  if (codes.length === 0) return out

  const q = <T,>(sql: string) =>
    query<T>(sql, [codes]).catch(() => [] as T[])

  const [
    elements,
    strategy,
    manualNav,
    emailNav,
    valuation,
    notes,
    personalTags,
  ] = await Promise.all([
    q<SourceRow>(
      `SELECT UPPER(BTRIM(code)) AS code, MAX(ts)::text AS ts
       FROM (
         SELECT register_number AS code, ${SHANGHAI_DAY("updated_at")} AS ts
           FROM basicinfo_bfl_track
          WHERE register_number = ANY($1::text[]) OR record_key = ANY($1::text[])
         UNION ALL
         SELECT record_key, ${SHANGHAI_DAY("updated_at")}
           FROM basicinfo_bfl_track
          WHERE register_number = ANY($1::text[]) OR record_key = ANY($1::text[])
       ) s
       WHERE NULLIF(BTRIM(code), '') IS NOT NULL
       GROUP BY 1`,
    ),
    q<SourceRow>(
      `SELECT UPPER(BTRIM(register_number)) AS code, MAX(${SHANGHAI_DAY("updated_at")})::text AS ts
         FROM type6_ops_team_full
        WHERE register_number = ANY($1::text[])
        GROUP BY 1`,
    ),
    q<SourceRow>(
      `SELECT UPPER(BTRIM(beian_hao)) AS code,
              MAX(${SHANGHAI_DAY("created_at")})::text AS ts,
              ${latestDetailExpr("nav_date::text", "created_at")} AS detail
         FROM ops_team_nav_manual
        WHERE beian_hao = ANY($1::text[])
        GROUP BY 1`,
    ),
    q<SourceRow>(
      `SELECT UPPER(BTRIM(product_code)) AS code,
              MAX(${SHANGHAI_DAY("created_at")})::text AS ts,
              ${latestDetailExpr("nav_date::text", "created_at")} AS detail
         FROM ops_email_nav_records
        WHERE product_code = ANY($1::text[])
        GROUP BY 1`,
    ),
    q<SourceRow>(
      `SELECT UPPER(BTRIM(product_code)) AS code,
              MAX(${SHANGHAI_DAY("created_at")})::text AS ts,
              ${latestDetailExpr("valuation_date::text", "created_at")} AS detail
         FROM ops_email_valuation_records
        WHERE product_code = ANY($1::text[])
        GROUP BY 1`,
    ),
    q<SourceRow>(
      `SELECT UPPER(BTRIM(beian_hao)) AS code,
              MAX(${SHANGHAI_DAY("updated_at")})::text AS ts,
              ${latestDetailExpr("NULLIF(BTRIM(note), '')", "updated_at")} AS detail
         FROM ops_fund_notes
        WHERE beian_hao = ANY($1::text[])
        GROUP BY 1`,
    ),
    q<SourceRow>(
      `SELECT UPPER(BTRIM(beian_hao)) AS code,
              MAX(${SHANGHAI_DAY("created_at")})::text AS ts,
              ${latestDetailExpr("NULLIF(BTRIM(tag_name), '')", "created_at")} AS detail
         FROM ops_personal_fund_tags
        WHERE beian_hao = ANY($1::text[])
        GROUP BY 1`,
    ),
  ])

  const sources: Array<{ rows: SourceRow[]; kind: LatestChangeKind }> = [
    { rows: elements, kind: "elements" },
    { rows: strategy, kind: "strategy" },
    { rows: manualNav, kind: "manualNav" },
    { rows: emailNav, kind: "emailNav" },
    { rows: valuation, kind: "valuation" },
    { rows: notes, kind: "notes" },
    { rows: personalTags, kind: "personalTags" },
  ]
  for (const { rows, kind } of sources) {
    for (const row of rows) putHit(out, row.code, row.ts, kind, row.detail)
  }
  return out
}

async function loadChangeHitsByName(names: string[]): Promise<Map<string, ChangeHit>> {
  const out = new Map<string, ChangeHit>()
  const labels = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  if (labels.length === 0) return out
  const rows = await query<SourceRow>(
    `SELECT BTRIM(fund_name) AS code,
            MAX(${SHANGHAI_DAY("created_at")})::text AS ts,
            ${latestDetailExpr("nav_date::text", "created_at")} AS detail
       FROM ops_email_nav_records
      WHERE fund_name = ANY($1::text[])
      GROUP BY 1`,
    [labels],
  ).catch(() => [] as SourceRow[])
  for (const row of rows) putHit(out, row.code, row.ts, "emailNav", row.detail)
  return out
}

function correctionRuleHit(
  beian: string,
  productName: string | null | undefined,
  shortName: string | null | undefined,
): ChangeHit | null {
  const beianU = beian.trim().toUpperCase()
  const names = new Set(
    [productName, shortName].map((v) => (v ?? "").trim()).filter(Boolean),
  )
  let best: ChangeHit | null = null
  for (const rule of listFundNavCorrectionRules()) {
    const matchesBeian = rule.beian_hao.trim().toUpperCase() === beianU
    const matchesName = (rule.product_names ?? []).some((n) => names.has(n.trim()))
    if (!matchesBeian && !matchesName) continue
    const day = isoDay(rule.updated_at)
    if (!day) continue
    best = combineHits(best, {
      day,
      labels: [formatChangeLabel("correction", rule.note)],
    })
  }
  return best
}

function firstEntryHit(row: {
  first_added_at?: string | null
  first_entry_date?: string | null
}): ChangeHit | null {
  const day = isoDay(row.first_added_at ?? row.first_entry_date)
  if (!day) return null
  return { day, labels: [formatChangeLabel("firstEntry")] }
}

export type LatestChangeOverlay = {
  latest_change_date: string | null
  latest_change_label: string | null
}

/** Attach 最新变动日期 (YYYY-MM-DD, Asia/Shanghai) onto list rows. */
export async function overlayLatestChangeDate<T extends {
  beian_hao?: string | null
  product_name?: string | null
  short_name?: string | null
  first_added_at?: string | null
  first_entry_date?: string | null
}>(rows: T[]): Promise<Array<T & LatestChangeOverlay>> {
  if (rows.length === 0) {
    return rows.map((row) => ({ ...row, latest_change_date: null, latest_change_label: null }))
  }
  try {
    const beianCodes = [...new Set(rows.map((r) => String(r.beian_hao ?? "").trim()).filter(Boolean))]
    const lookupCodes = expandBeianLookupKeys(beianCodes)
    const names = rows.flatMap((r) => [r.product_name, r.short_name])
    const [byCode, byName] = await Promise.all([
      loadChangeHitsByCode(lookupCodes),
      loadChangeHitsByName(names.filter((n): n is string => Boolean(n))),
    ])

    return rows.map((row) => {
      const beian = String(row.beian_hao ?? "").trim()
      const hits: Array<ChangeHit | null> = []
      if (beian) {
        for (const key of expandBeianLookupKeys([beian])) {
          hits.push(byCode.get(key.toUpperCase()) ?? null)
        }
      }
      hits.push(byName.get(String(row.product_name ?? "").trim().toUpperCase()) ?? null)
      hits.push(byName.get(String(row.short_name ?? "").trim().toUpperCase()) ?? null)
      hits.push(correctionRuleHit(beian, row.product_name, row.short_name))
      hits.push(firstEntryHit(row))
      const best = combineHits(...hits)
      return {
        ...row,
        latest_change_date: best?.day ?? null,
        latest_change_label: joinLabels(best),
      }
    })
  } catch (err) {
    console.warn("[overlayLatestChangeDate] skipped:", err)
    return rows.map((row) => {
      const fallbackDay = maxDay(
        (row as { latest_change_date?: string | null }).latest_change_date,
        row.first_added_at ?? row.first_entry_date,
      )
      const firstDay = isoDay(row.first_added_at ?? row.first_entry_date)
      return {
        ...row,
        latest_change_date: fallbackDay,
        latest_change_label: fallbackDay && fallbackDay === firstDay
          ? formatChangeLabel("firstEntry")
          : (row as { latest_change_label?: string | null }).latest_change_label ?? null,
      }
    })
  }
}
