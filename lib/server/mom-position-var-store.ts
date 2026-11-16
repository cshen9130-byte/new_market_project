import type { PoolClient } from "pg"
import { publicQuery, publicWithClient, queryUnbounded } from "@/lib/db"
import { computeMomPositionVarHistory, MOM_BOOK_ACCOUNT_SQL } from "@/lib/server/mom-position-var-history"
import {
  MOM_POSITION_VAR_SPEC,
  type PositionVarDay,
  type PositionVarGroup,
  type PositionVarProduct,
} from "@/lib/server/mom-position-var-math"

const LOCK_KEY = 88442201
const TABLE = "public.mom_position_var_daily"

export type VarHistoryGroup = "all" | "sector" | "product" | "category" | "sub"

type InsertRow = {
  date: string
  level: string
  name: string
  productName: string | null
  sector: string | null
  category: string | null
  subSector: string | null
  marketValue: number | null
  lots: number | null
  sigma: number | null
  componentVar: number | null
  marginalPct: number | null
  mcr: number | null
  totalVar: number | null
}

export type StoredVarHistoryDay = {
  date: string
  totalVar: number | null
  netMarketValue: number | null
  sectors: Array<{ name: string; marginalPct: number; componentVar: number; marketValue: number }>
  products: Array<{
    code: string
    name: string | null
    sector: string | null
    category: string | null
    subSector: string | null
    marketValue: number
    lots: number | null
    sigma: number | null
    componentVar: number
    marginalPct: number
  }>
  categories: Array<{ name: string; marginalPct: number; componentVar: number; marketValue: number }>
  subSectors: Array<{ name: string; marginalPct: number; componentVar: number; marketValue: number }>
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function isMissingRelation(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code
  const msg = err instanceof Error ? err.message : String(err)
  return code === "42P01" || msg.includes("does not exist")
}

async function ensureMomPositionVarTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      trade_date date NOT NULL,
      level text NOT NULL,
      name text NOT NULL,
      product_name text,
      sector text,
      category text,
      sub_sector text,
      market_value numeric,
      lots integer,
      sigma double precision,
      component_var numeric,
      marginal_pct numeric,
      mcr numeric,
      total_var numeric,
      vol_days smallint NOT NULL,
      corr_days smallint NOT NULL,
      confidence smallint NOT NULL,
      computed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (trade_date, level, name, vol_days, corr_days, confidence)
    )`)
  await client.query(`
    CREATE INDEX IF NOT EXISTS mom_position_var_daily_level_date_idx
      ON ${TABLE} (level, vol_days, corr_days, confidence, trade_date)`)
  await client.query(`
    COMMENT ON TABLE ${TABLE} IS
      'MOM book parametric 1-day position VaR. Canonical window: normal 95%, vol 20, corr 252. Excludes 国信 / GUOXIN / GUOSEN / 665300200077.'`)
}

function groupRow(date: string, level: string, group: PositionVarGroup, totalVar: number): InsertRow {
  return {
    date,
    level,
    name: group.name,
    productName: null,
    sector: level === "sector" ? group.name : null,
    category: level === "category" ? group.name : null,
    subSector: level === "sub" ? group.name : null,
    marketValue: group.marketValue,
    lots: null,
    sigma: null,
    componentVar: group.componentVar,
    marginalPct: group.marginalPct,
    mcr: group.mcr,
    totalVar,
  }
}

function productRow(date: string, product: PositionVarProduct, totalVar: number): InsertRow {
  return {
    date,
    level: "product",
    name: product.code,
    productName: product.name,
    sector: product.sector,
    category: product.category,
    subSector: product.subSector,
    marketValue: product.marketValue,
    lots: product.lots,
    sigma: product.sigma,
    componentVar: product.componentVar,
    marginalPct: product.marginalPct,
    mcr: product.mcr,
    totalVar,
  }
}

function rowsForDay(day: PositionVarDay): InsertRow[] {
  const rows: InsertRow[] = [{
    date: day.date,
    level: "portfolio",
    name: "MOM",
    productName: null,
    sector: null,
    category: null,
    subSector: null,
    marketValue: day.netMarketValue,
    lots: null,
    sigma: null,
    componentVar: day.totalVar,
    marginalPct: 100,
    mcr: day.totalMcr,
    totalVar: day.totalVar,
  }]
  for (const product of day.products) rows.push(productRow(day.date, product, day.totalVar))
  for (const group of day.groups.sector) rows.push(groupRow(day.date, "sector", group, day.totalVar))
  for (const group of day.groups.category) rows.push(groupRow(day.date, "category", group, day.totalVar))
  for (const group of day.groups.sub) rows.push(groupRow(day.date, "sub", group, day.totalVar))
  return rows
}

async function insertRows(client: PoolClient, rows: InsertRow[]): Promise<void> {
  const spec = MOM_POSITION_VAR_SPEC
  const chunkSize = 4000
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize)
    await client.query(
      `INSERT INTO ${TABLE} (
         trade_date, level, name, product_name, sector, category, sub_sector,
         market_value, lots, sigma, component_var, marginal_pct, mcr, total_var,
         vol_days, corr_days, confidence
       )
       SELECT t.trade_date, t.level, t.name, t.product_name, t.sector, t.category, t.sub_sector,
              t.market_value, t.lots, t.sigma, t.component_var, t.marginal_pct, t.mcr, t.total_var,
              $15::int, $16::int, $17::int
         FROM unnest(
           $1::date[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[],
           $8::numeric[], $9::int[], $10::float8[], $11::numeric[], $12::numeric[], $13::numeric[], $14::numeric[]
         ) AS t(
           trade_date, level, name, product_name, sector, category, sub_sector,
           market_value, lots, sigma, component_var, marginal_pct, mcr, total_var
         )`,
      [
        chunk.map((row) => row.date),
        chunk.map((row) => row.level),
        chunk.map((row) => row.name),
        chunk.map((row) => row.productName),
        chunk.map((row) => row.sector),
        chunk.map((row) => row.category),
        chunk.map((row) => row.subSector),
        chunk.map((row) => row.marketValue),
        chunk.map((row) => row.lots),
        chunk.map((row) => row.sigma),
        chunk.map((row) => row.componentVar),
        chunk.map((row) => row.marginalPct),
        chunk.map((row) => row.mcr),
        chunk.map((row) => row.totalVar),
        spec.volDays,
        spec.corrDays,
        spec.confidence,
      ],
    )
  }
}

async function storedMaxDate(client: PoolClient): Promise<string | null> {
  const spec = MOM_POSITION_VAR_SPEC
  const res = await client.query<{ max_date: string | null }>(
    `SELECT MAX(trade_date)::text AS max_date
       FROM ${TABLE}
      WHERE level = 'portfolio' AND vol_days = $1 AND corr_days = $2 AND confidence = $3`,
    [spec.volDays, spec.corrDays, spec.confidence],
  )
  const value = res.rows[0]?.max_date
  return value ? String(value).slice(0, 10) : null
}

async function rewindDate(): Promise<string | null> {
  const rows = await queryUnbounded<{ date: string }>(
    `SELECT "交易日期"::text AS date
       FROM mom_position_details
      WHERE "交易日期" IS NOT NULL
        ${MOM_BOOK_ACCOUNT_SQL}
      GROUP BY "交易日期"
      ORDER BY "交易日期" DESC
      LIMIT 8`,
  )
  const oldest = rows[rows.length - 1]?.date
  return oldest ? String(oldest).slice(0, 10) : null
}

/**
 * Write the canonical MOM position-VaR history.
 * A full pass runs when the table is empty or `rebuild` is set.
 * Otherwise the last 8 settlement dates are replaced, and any gap after the
 * stored maximum is filled as well.
 */
export async function persistMomPositionVarHistory(opts?: { rebuild?: boolean }): Promise<{
  skipped: boolean
  rebuild: boolean
  fromDate: string | null
  days: number
  rows: number
  firstDate: string | null
  lastDate: string | null
}> {
  return publicWithClient(async (client) => {
    const locked = await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock($1::bigint) AS ok`, [LOCK_KEY])
    if (!locked.rows[0]?.ok) {
      return { skipped: true, rebuild: false, fromDate: null, days: 0, rows: 0, firstDate: null, lastDate: null }
    }
    try {
      await ensureMomPositionVarTable(client)
      const rebuild = opts?.rebuild === true
      const maxDate = rebuild ? null : await storedMaxDate(client)
      let fromDate: string | null = null
      if (!rebuild && maxDate) {
        const rewind = await rewindDate()
        fromDate = rewind && rewind < maxDate ? rewind : maxDate
      }
      const started = Date.now()
      console.error(`[mom-position-var] computing ${fromDate ? `from ${fromDate}` : "full history"}`)
      const { days } = await computeMomPositionVarHistory({
        volDays: MOM_POSITION_VAR_SPEC.volDays,
        corrDays: MOM_POSITION_VAR_SPEC.corrDays,
        zScore: MOM_POSITION_VAR_SPEC.zScore,
        fromDate,
        runQuery: queryUnbounded,
      })
      console.error(`[mom-position-var] ${days.length} days in ${Date.now() - started}ms`)
      if (days.length === 0) {
        return { skipped: false, rebuild, fromDate, days: 0, rows: 0, firstDate: null, lastDate: null }
      }
      const rows = days.flatMap(rowsForDay)
      const spec = MOM_POSITION_VAR_SPEC
      await client.query("BEGIN")
      try {
        await client.query(
          `DELETE FROM ${TABLE}
            WHERE vol_days = $1 AND corr_days = $2 AND confidence = $3
              AND ($4::date IS NULL OR trade_date >= $4::date)`,
          [spec.volDays, spec.corrDays, spec.confidence, fromDate],
        )
        await insertRows(client, rows)
        await client.query("COMMIT")
      } catch (err) {
        try { await client.query("ROLLBACK") } catch { /* ignore */ }
        throw err
      }
      return {
        skipped: false,
        rebuild,
        fromDate,
        days: days.length,
        rows: rows.length,
        firstDate: days[0]?.date ?? null,
        lastDate: days[days.length - 1]?.date ?? null,
      }
    } finally {
      try { await client.query(`SELECT pg_advisory_unlock($1::bigint)`, [LOCK_KEY]) } catch { /* ignore */ }
    }
  }, { statementTimeoutMs: 0 })
}

function levelsFor(group: VarHistoryGroup): string[] {
  if (group === "product") return ["portfolio", "product"]
  if (group === "sector") return ["portfolio", "sector"]
  if (group === "category") return ["portfolio", "category"]
  if (group === "sub") return ["portfolio", "sub"]
  return ["portfolio", "product", "sector"]
}

function byPctDesc<T extends { marginalPct: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.marginalPct - a.marginalPct)
}

export async function readMomPositionVarHistory(opts: {
  group: VarHistoryGroup
  start: string | null
  end: string | null
  limit: number
}): Promise<{
  missing: boolean
  storedDays: number
  computedAt: string | null
  total: number
  truncated: boolean
  days: StoredVarHistoryDay[]
}> {
  const empty = { missing: false, storedDays: 0, computedAt: null, total: 0, truncated: false, days: [] as StoredVarHistoryDay[] }
  const spec = MOM_POSITION_VAR_SPEC
  try {
    const count = await publicQuery(
      `SELECT COUNT(DISTINCT trade_date)::int AS days,
              MAX(computed_at)::text AS computed_at
         FROM ${TABLE}
        WHERE level = 'portfolio' AND vol_days = $1 AND corr_days = $2 AND confidence = $3`,
      [spec.volDays, spec.corrDays, spec.confidence],
    )
    const storedDays = Number(count.rows[0]?.days ?? 0)
    const computedAt = count.rows[0]?.computed_at == null ? null : String(count.rows[0].computed_at)
    if (storedDays === 0) return { ...empty, computedAt }

    const params: unknown[] = [spec.volDays, spec.corrDays, spec.confidence, levelsFor(opts.group)]
    const filters = [
      "vol_days = $1",
      "corr_days = $2",
      "confidence = $3",
      "level = ANY($4::text[])",
    ]
    if (opts.start) {
      params.push(opts.start)
      filters.push(`trade_date >= $${params.length}::date`)
    }
    if (opts.end) {
      params.push(opts.end)
      filters.push(`trade_date <= $${params.length}::date`)
    }
    const res = await publicQuery(
      `SELECT trade_date::text AS trade_date, level, name, product_name, sector, category, sub_sector,
              market_value, lots, sigma, component_var, marginal_pct, total_var
         FROM ${TABLE}
        WHERE ${filters.join(" AND ")}
        ORDER BY trade_date ASC, level ASC`,
      params,
    )
    const byDate = new Map<string, StoredVarHistoryDay>()
    for (const row of res.rows) {
      const date = String(row.trade_date).slice(0, 10)
      let day = byDate.get(date)
      if (!day) {
        day = {
          date,
          totalVar: null,
          netMarketValue: null,
          sectors: [],
          products: [],
          categories: [],
          subSectors: [],
        }
        byDate.set(date, day)
      }
      const level = String(row.level)
      const marginalPct = num(row.marginal_pct) ?? 0
      const componentVar = num(row.component_var) ?? 0
      const marketValue = num(row.market_value) ?? 0
      if (level === "portfolio") {
        day.totalVar = num(row.total_var)
        day.netMarketValue = num(row.market_value)
      } else if (level === "product") {
        day.products.push({
          code: String(row.name),
          name: row.product_name == null ? null : String(row.product_name),
          sector: row.sector == null ? null : String(row.sector),
          category: row.category == null ? null : String(row.category),
          subSector: row.sub_sector == null ? null : String(row.sub_sector),
          marketValue,
          lots: num(row.lots),
          sigma: num(row.sigma),
          componentVar,
          marginalPct,
        })
      } else {
        const item = { name: String(row.name), marginalPct, componentVar, marketValue }
        if (level === "sector") day.sectors.push(item)
        else if (level === "category") day.categories.push(item)
        else if (level === "sub") day.subSectors.push(item)
      }
    }
    const allDays = [...byDate.values()].map((day) => ({
      ...day,
      sectors: byPctDesc(day.sectors),
      products: byPctDesc(day.products),
      categories: byPctDesc(day.categories),
      subSectors: byPctDesc(day.subSectors),
    }))
    const total = allDays.length
    const truncated = total > opts.limit
    const days = truncated ? allDays.slice(total - opts.limit) : allDays
    return { missing: false, storedDays, computedAt, total, truncated, days }
  } catch (err) {
    if (isMissingRelation(err)) return { ...empty, missing: true }
    throw err
  }
}
