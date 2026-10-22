import { publicQuery, query } from "@/lib/db"
import { listStaticFundMomLinks } from "@/lib/ma/fund-mom-account-map"
import type { MomUnderlyingKind, MomUnderlyingLinkSource, MomUnderlyingRow } from "@/lib/ma/mom-underlying"
import { ensureFundMomAccountTable } from "@/lib/server/ops-fund-mom-accounts"
import { listFundSingleAccounts } from "@/lib/server/ops-fund-single-accounts"

export type { MomUnderlyingKind, MomUnderlyingRow }

type FundMeta = {
  beian_hao: string
  product_name: string
  strategy_l1: string | null
  strategy_l2: string | null
  latest_nav: string | null
  latest_nav_date: string | null
}

type Seed = {
  kind: MomUnderlyingKind
  linkSource: MomUnderlyingLinkSource
  beian: string
  productName: string
  account: string
  accountNote: string | null
  note: string | null
  equity: string | null
  equityDate: string | null
  updatedBy: string | null
  updatedAt: string | null
}

function clean(value: unknown): string {
  return String(value ?? "").trim()
}

function strategyLabel(l1: string | null | undefined, l2: string | null | undefined): string | null {
  const parts = [clean(l1), clean(l2)].filter(Boolean)
  return parts.length ? parts.join(" / ") : null
}

function shortCompany(name: string | null): string | null {
  const s = clean(name)
  if (!s) return null
  return s
    .replace(/股份有限公司|有限责任公司|有限公司/g, "")
    .trim() || s
}

function numText(value: unknown): string | null {
  if (value == null || value === "") return null
  const n = Number(String(value).replace(/,/g, ""))
  return Number.isFinite(n) ? String(n) : null
}

async function loadCompareSeeds(): Promise<Seed[]> {
  await ensureFundMomAccountTable()
  const saved = await query<{
    beian_hao: string
    product_name: string
    account_code: string
    note: string
    updated_by: string
    updated_at: string
  }>(
    `SELECT beian_hao, product_name, account_code, note, updated_by, updated_at::text
     FROM ops_fund_mom_accounts
     WHERE NULLIF(TRIM(account_code), '') IS NOT NULL`,
  ).catch(() => [])

  const byKey = new Map<string, Seed>()
  for (const row of saved) {
    const beian = clean(row.beian_hao).toUpperCase()
    const account = clean(row.account_code).toLowerCase()
    if (!beian || !account) continue
    byKey.set(`${beian}|${account}`, {
      kind: "compare",
      linkSource: "saved",
      beian,
      productName: clean(row.product_name),
      account,
      accountNote: clean(row.note) || null,
      note: clean(row.note) || null,
      equity: null,
      equityDate: null,
      updatedBy: clean(row.updated_by) || null,
      updatedAt: clean(row.updated_at) || null,
    })
  }

  const savedBeians = new Set(
    [...byKey.values()].filter((row) => row.linkSource === "saved").map((row) => row.beian),
  )
  for (const link of listStaticFundMomLinks()) {
    const beian = link.beianHao.trim().toUpperCase()
    const account = link.account.trim().toLowerCase()
    const key = `${beian}|${account}`
    if (!beian || !account || byKey.has(key) || savedBeians.has(beian)) continue
    byKey.set(key, {
      kind: "compare",
      linkSource: "static",
      beian,
      productName: link.productMatch ?? "",
      account,
      accountNote: link.note ?? null,
      note: link.note ?? null,
      equity: null,
      equityDate: null,
      updatedBy: null,
      updatedAt: null,
    })
  }
  return [...byKey.values()]
}

async function loadCfmmcBooks(): Promise<Map<string, { company: string | null; equity: string | null; date: string | null }>> {
  const res = await publicQuery(
    `SELECT DISTINCT ON (trim(account_no))
       trim(account_no) AS account_no,
       NULLIF(trim(company_name), '') AS company_name,
       client_equity::text AS equity,
       trade_date::text AS trade_date
     FROM public.cfmmc_daily_summary
     WHERE account_no IS NOT NULL AND trim(account_no) <> ''
     ORDER BY trim(account_no), trade_date DESC`,
  ).catch(() => ({ rows: [] as Array<{ account_no: string; company_name: string | null; equity: string | null; trade_date: string | null }> }))
  const map = new Map<string, { company: string | null; equity: string | null; date: string | null }>()
  for (const row of res.rows as Array<{ account_no: string; company_name: string | null; equity: string | null; trade_date: string | null }>) {
    const account = clean(row.account_no)
    if (!account) continue
    map.set(account, {
      company: shortCompany(row.company_name),
      equity: numText(row.equity),
      date: clean(row.trade_date).slice(0, 10) || null,
    })
  }
  return map
}

async function loadAccountSeeds(): Promise<Seed[]> {
  const [explicit, books] = await Promise.all([
    listFundSingleAccounts().catch(() => []),
    loadCfmmcBooks().catch(() => new Map()),
  ])
  const byAccount = new Map<string, Seed>()
  for (const row of explicit) {
    const account = clean(row.account_no)
    const beian = clean(row.beian_hao).toUpperCase()
    if (!account || !beian) continue
    const book = books.get(account)
    const note = clean(row.note) || null
    byAccount.set(account, {
      kind: "account",
      linkSource: "saved",
      beian,
      productName: clean(row.product_name),
      account,
      accountNote: note || book?.company || null,
      note,
      equity: book?.equity ?? null,
      equityDate: book?.date ?? null,
      updatedBy: clean(row.updated_by) || null,
      updatedAt: clean(row.updated_at) || null,
    })
  }
  return [...byAccount.values()]
}

async function loadFundMeta(beians: string[]): Promise<Map<string, FundMeta>> {
  const codes = [...new Set(beians.map((b) => b.trim().toUpperCase()).filter(Boolean))]
  const map = new Map<string, FundMeta>()
  if (codes.length === 0) return map
  const rows = await query<FundMeta>(
    `SELECT upper(trim(beian_hao)) AS beian_hao,
            product_name,
            strategy_l1,
            strategy_l2,
            latest_nav::text AS latest_nav,
            latest_nav_date::text AS latest_nav_date
     FROM private_fund_info
     WHERE upper(trim(beian_hao)) = ANY($1::text[])`,
    [codes],
  ).catch(() => [])
  for (const row of rows) map.set(clean(row.beian_hao).toUpperCase(), row)
  return map
}

function priceChangeMap(rows: Array<{ beian_hao: string; nav: string; rn: string }>): Map<string, string> {
  const points = new Map<string, { latest?: number; prev?: number }>()
  for (const row of rows) {
    const code = clean(row.beian_hao).toUpperCase()
    const nav = Number(row.nav)
    if (!code || !Number.isFinite(nav) || nav <= 0) continue
    const slot = points.get(code) ?? {}
    if (Number(row.rn) === 1) slot.latest = nav
    else slot.prev = nav
    points.set(code, slot)
  }
  const map = new Map<string, string>()
  for (const [code, slot] of points) {
    if (slot.latest == null || slot.prev == null || slot.prev === 0) continue
    map.set(code, String(slot.latest / slot.prev - 1))
  }
  return map
}

async function loadPriceChanges(beians: string[]): Promise<Map<string, string>> {
  const codes = [...new Set(beians.map((b) => b.trim().toUpperCase()).filter(Boolean))]
  const map = new Map<string, string>()
  if (codes.length === 0) return map

  const emailRows = await query<{ beian_hao: string; nav: string; rn: string }>(
    `WITH daily AS (
       SELECT DISTINCT ON (upper(trim(product_code)), nav_date)
         upper(trim(product_code)) AS beian_hao,
         nav_date,
         nav::numeric AS nav
       FROM ops_email_nav_records
       WHERE upper(trim(product_code)) = ANY($1::text[])
         AND nav IS NOT NULL AND nav > 0
       ORDER BY upper(trim(product_code)), nav_date DESC, created_at DESC
     ),
     ranked AS (
       SELECT beian_hao, nav,
              row_number() OVER (PARTITION BY beian_hao ORDER BY nav_date DESC) AS rn
       FROM daily
     )
     SELECT beian_hao, nav::text AS nav, rn::text AS rn
     FROM ranked
     WHERE rn <= 2`,
    [codes],
  ).catch(() => [])
  for (const [code, pct] of priceChangeMap(emailRows)) map.set(code, pct)

  const missing = codes.filter((code) => !map.has(code))
  if (missing.length === 0) return map

  const navRows = await query<{ beian_hao: string; nav: string; rn: string }>(
    `SELECT beian_hao, nav::text AS nav, rn::text AS rn
     FROM (
       SELECT upper(trim(beian_hao)) AS beian_hao, nav,
              row_number() OVER (PARTITION BY upper(trim(beian_hao)) ORDER BY price_date DESC) AS rn
       FROM private_fund_nav
       WHERE upper(trim(beian_hao)) = ANY($1::text[])
         AND nav IS NOT NULL AND nav > 0
     ) s
     WHERE rn <= 2`,
    [missing],
  ).catch(() => [])
  for (const [code, pct] of priceChangeMap(navRows)) map.set(code, pct)
  return map
}

async function loadMomEquity(accounts: string[]): Promise<Map<string, { equity: string; date: string }>> {
  const keys = [...new Set(accounts.map((a) => a.trim().toLowerCase()).filter(Boolean))]
  const map = new Map<string, { equity: string; date: string }>()
  if (keys.length === 0) return map
  const res = await publicQuery(
    `SELECT DISTINCT ON (acct)
       acct,
       trade_date::text AS trade_date,
       equity::text AS equity
     FROM (
       SELECT lower(trim("账户"::text)) AS acct,
              "交易日期"::date AS trade_date,
              NULLIF(REPLACE(REPLACE(COALESCE("客户权益"::text, ''), ',', ''), ' ', ''), '')::numeric AS equity
       FROM public.mom_daily_reports
       WHERE lower(trim("账户"::text)) = ANY($1::text[])
     ) s
     WHERE acct <> '' AND equity IS NOT NULL
     ORDER BY acct, trade_date DESC`,
    [keys],
  ).catch(() => ({ rows: [] as Array<{ acct: string; trade_date: string; equity: string }> }))

  for (const row of res.rows as Array<{ acct: string; trade_date: string; equity: string }>) {
    const equity = numText(row.equity)
    const date = clean(row.trade_date).slice(0, 10)
    if (!row.acct || !equity) continue
    map.set(row.acct, { equity, date })
  }
  return map
}

async function loadAdvisorNotes(accounts: string[]): Promise<Map<string, string>> {
  const keys = [...new Set(accounts.map((a) => a.trim().toLowerCase()).filter(Boolean))]
  const map = new Map<string, string>()
  if (keys.length === 0) return map
  const rows = await query<{ account: string; company: string | null; sector: string | null }>(
    `SELECT DISTINCT ON (lower(trim(account_code)))
       lower(trim(account_code)) AS account,
       NULLIF(trim(company), '') AS company,
       NULLIF(trim(sector), '') AS sector
     FROM mom_advisor_info
     WHERE lower(trim(account_code)) = ANY($1::text[])
     ORDER BY lower(trim(account_code)), id DESC`,
    [keys],
  ).catch(() => [])
  for (const row of rows) {
    const note = [row.company, row.sector].map((v) => clean(v)).filter(Boolean).join(" · ")
    if (row.account && note) map.set(row.account, note)
  }
  return map
}

export async function listMomUnderlyingProducts(): Promise<MomUnderlyingRow[]> {
  const [compareSeeds, accountSeeds] = await Promise.all([
    loadCompareSeeds().catch(() => [] as Seed[]),
    loadAccountSeeds().catch(() => [] as Seed[]),
  ])
  const seeds = [...compareSeeds, ...accountSeeds]
  const beians = seeds.map((s) => s.beian)
  const compareAccounts = compareSeeds.map((s) => s.account)
  const [funds, changes, equity, advisors] = await Promise.all([
    loadFundMeta(beians),
    loadPriceChanges(beians),
    loadMomEquity(compareAccounts),
    loadAdvisorNotes(compareAccounts),
  ])

  return seeds.map((seed) => {
    const fund = funds.get(seed.beian)
    const mom = seed.kind === "compare" ? equity.get(seed.account) : undefined
    const advisor = seed.kind === "compare" ? advisors.get(seed.account) : undefined
    const productName = clean(fund?.product_name) || seed.productName || seed.beian
    return {
      id: `${seed.kind}:${seed.account}:${seed.beian}`,
      kind: seed.kind,
      link_source: seed.linkSource,
      beian_hao: seed.beian || null,
      product_name: productName,
      account: seed.account,
      account_note: seed.accountNote || advisor,
      note: seed.note,
      strategy: strategyLabel(fund?.strategy_l1, fund?.strategy_l2),
      latest_nav: numText(fund?.latest_nav),
      latest_nav_date: clean(fund?.latest_nav_date).slice(0, 10) || null,
      latest_price_change: changes.get(seed.beian) ?? null,
      equity: mom?.equity ?? seed.equity,
      equity_date: mom?.date ?? seed.equityDate,
      updated_by: seed.updatedBy,
      updated_at: seed.updatedAt,
    }
  }).sort((a, b) => a.product_name.localeCompare(b.product_name, "zh") || a.account.localeCompare(b.account))
}
