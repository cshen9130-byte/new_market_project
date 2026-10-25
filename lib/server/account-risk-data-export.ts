/**
 * Full-account CFMMC export for the MOM数据 API (/cfmmc/account/export).
 * Writes CSV (and optional zip) from public.cfmmc_* without loading entire
 * tables into a single JS string — rows are batched with keyset pagination.
 */

import fs from "fs"
import os from "os"
import path from "path"
import AdmZip from "adm-zip"
import type { PoolClient } from "pg"
import { publicWithClient } from "@/lib/db"
import { productNameFromClientLabel } from "@/lib/server/account-risk-product-elements"
import {
  aggregateEquityByDate,
  compoundAccountRiskNav,
} from "@/lib/server/account-risk-nav"
import { momDataErr, momDataOk, type MomDataEnvelope } from "@/lib/server/mom-data-api"

const ACCOUNT_OK = `
  COALESCE(TRIM(account_no::text), '') <> ''
  AND UPPER(TRIM(account_no::text)) NOT LIKE '%GUOXIN%'
  AND UPPER(TRIM(account_no::text)) NOT LIKE '%GUOSEN%'
  AND TRIM(account_no::text) NOT LIKE '%国信%'
  AND TRIM(account_no::text) <> '665300200077'
`

const BATCH = 5_000

type SheetSpec = {
  id: string
  table: string
  cols: string[]
  file: string
  hasRowNum: boolean
}

const SHEETS: SheetSpec[] = [
  {
    id: "daily",
    table: "cfmmc_daily_summary",
    file: "cfmmc_daily_summary",
    hasRowNum: false,
    cols: [
      "account_no", "client_name", "company_name", "source_file",
      "balance_bf", "client_equity", "deposit_wd", "available_actual",
      "realized_pl", "mtm_pl", "commission", "balance_cf", "margin_occupied",
      "daily_pnl", "available", "risk_ratio", "margin_call",
    ],
  },
  {
    id: "products",
    table: "cfmmc_product_pnl",
    file: "cfmmc_product_pnl",
    hasRowNum: true,
    cols: ["account_no", "source_file", "row_num", "product_code", "volume", "turnover", "commission", "realized_pl"],
  },
  {
    id: "positions",
    table: "cfmmc_positions",
    file: "cfmmc_positions",
    hasRowNum: true,
    cols: [
      "account_no", "source_file", "row_num", "instrument", "trade_no", "bs",
      "open_price", "lots", "latest_price", "settl_price", "floating_pl", "sh",
      "buy_lots", "buy_price", "sell_lots", "sell_price", "prev_settle",
      "trade_code", "actual_date", "notional_mv", "allocated_margin",
    ],
  },
  {
    id: "trades",
    table: "cfmmc_trades",
    file: "cfmmc_trades",
    hasRowNum: true,
    cols: [
      "account_no", "source_file", "row_num", "instrument", "trade_no", "trade_time",
      "bs", "sh", "price", "lots", "turnover", "oc", "commission", "realized_pl", "actual_date",
    ],
  },
  {
    id: "closes",
    table: "cfmmc_closes",
    file: "cfmmc_closes",
    hasRowNum: true,
    cols: [
      "account_no", "source_file", "row_num", "instrument", "trade_no", "bs",
      "price", "open_price", "lots", "prev_settle", "realized_pl", "orig_trade_no", "actual_date",
    ],
  },
  {
    id: "cashflows",
    table: "cfmmc_cash_flows",
    file: "cfmmc_cash_flows",
    hasRowNum: true,
    cols: ["account_no", "source_file", "row_num", "occur_date", "deposit", "withdrawal", "method", "memo"],
  },
  {
    id: "option-trades",
    table: "cfmmc_option_trades",
    file: "cfmmc_option_trades",
    hasRowNum: true,
    cols: [
      "account_no", "source_file", "row_num", "instrument", "trade_no", "trade_time",
      "bs", "premium_px", "volume", "premium", "covered", "commission", "actual_date",
    ],
  },
  {
    id: "securities",
    table: "cfmmc_securities",
    file: "cfmmc_securities",
    hasRowNum: true,
    cols: [
      "account_no", "source_file", "row_num", "code", "name", "change_type", "bs",
      "trade_no", "trade_time", "price", "qty", "amount", "commission",
    ],
  },
]

const ALL_DATASET_IDS = ["meta", "nav", "ops", ...SHEETS.map((s) => s.id)]

export type AccountRiskBinaryResult = {
  kind: "binary"
  body: Buffer
  contentType: string
  filename: string
}

export function isAccountRiskBinary(value: unknown): value is AccountRiskBinaryResult {
  return Boolean(value && typeof value === "object" && (value as { kind?: string }).kind === "binary")
}

function isoDate(value: string | undefined): string | null {
  const text = (value ?? "").trim()
  if (!text) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  return text
}

function accountCode(value: string | undefined): string | null {
  const text = (value ?? "").trim()
  if (!text || text.length > 64) return null
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null
  return text
}

function shortCompanyName(raw: string): string {
  return raw
    .replace(/股份有限公司$/, "")
    .replace(/有限责任公司$/, "")
    .replace(/有限公司$/, "")
    .trim()
}

function labelMatches(query: string, labels: Array<string | null | undefined>): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, "")
  if (!q) return true
  return labels.some((label) => {
    const text = String(label ?? "").trim().toLowerCase().replace(/\s+/g, "")
    return text.length >= 2 && (text.includes(q) || q.includes(text))
  })
}

function companyQuery(record: Record<string, string | undefined>): string {
  const company = (record.company ?? "").trim()
  if (company) return company
  const q = (record.q ?? "").trim()
  if (!q || q === (record.account ?? "").trim()) return ""
  if (/^[A-Za-z0-9_-]+$/.test(q)) return ""
  return q
}

function csvEscape(value: unknown): string {
  if (value == null) return ""
  const text = typeof value === "string" ? value : String(value)
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function csvLine(values: unknown[]): string {
  return values.map(csvEscape).join(",")
}

function parseDatasets(raw: string | undefined): string[] | MomDataEnvelope<unknown> {
  const text = (raw ?? "").trim()
  if (!text || text === "all") return [...ALL_DATASET_IDS]
  const parts = text.split(/[,+\s]+/).map((p) => p.trim().toLowerCase()).filter(Boolean)
  if (!parts.length) return [...ALL_DATASET_IDS]
  const unknown = parts.filter((p) => !ALL_DATASET_IDS.includes(p))
  if (unknown.length) {
    return momDataErr(1, `unknown dataset(s): ${unknown.join(", ")}. Use: ${ALL_DATASET_IDS.join(", ")}`)
  }
  return parts
}

async function loadIdentity(client: PoolClient, account: string) {
  const res = await client.query<{
    client_name: string | null
    company_name: string | null
    first_date: string | null
    last_date: string | null
    trading_days: number | string
  }>(
    `SELECT
        (ARRAY_AGG(client_name ORDER BY trade_date DESC))[1] AS client_name,
        (ARRAY_AGG(company_name ORDER BY trade_date DESC))[1] AS company_name,
        MIN(trade_date)::text AS first_date,
        MAX(trade_date)::text AS last_date,
        COUNT(*)::int AS trading_days
       FROM public.cfmmc_daily_summary
      WHERE account_no = $1 AND ${ACCOUNT_OK}`,
    [account],
  )
  return res.rows[0] ?? null
}

async function writeSheetCsv(
  client: PoolClient,
  sheet: SheetSpec,
  account: string,
  start: string | null,
  end: string | null,
  outPath: string,
): Promise<number> {
  const headers = ["trade_date", ...sheet.cols]
  const fh = fs.createWriteStream(outPath, { encoding: "utf8" })
  fh.write("\ufeff")
  fh.write(csvLine(headers) + "\n")
  let rowsWritten = 0
  let lastDate: string | null = null
  let lastRowNum = -1

  for (;;) {
    const params: unknown[] = [account]
    const filters = [`account_no = $1`, ACCOUNT_OK]
    if (start) {
      params.push(start)
      filters.push(`trade_date >= $${params.length}::date`)
    }
    if (end) {
      params.push(end)
      filters.push(`trade_date <= $${params.length}::date`)
    }
    if (lastDate != null) {
      if (sheet.hasRowNum) {
        params.push(lastDate, lastRowNum)
        filters.push(
          `(trade_date > $${params.length - 1}::date OR (trade_date = $${params.length - 1}::date AND COALESCE(row_num, 0) > $${params.length}))`,
        )
      } else {
        params.push(lastDate)
        filters.push(`trade_date > $${params.length}::date`)
      }
    }
    params.push(BATCH)
    const orderBy = sheet.hasRowNum ? "trade_date ASC, COALESCE(row_num, 0) ASC" : "trade_date ASC"
    const select = ["trade_date::text AS trade_date", ...sheet.cols].join(", ")
    const sql = `
      SELECT ${select}
        FROM public.${sheet.table}
       WHERE ${filters.join(" AND ")}
       ORDER BY ${orderBy}
       LIMIT $${params.length}`
    const res = await client.query<Record<string, unknown>>(sql, params)
    if (!res.rows.length) break
    for (const row of res.rows) {
      fh.write(csvLine(headers.map((h) => row[h])) + "\n")
    }
    rowsWritten += res.rows.length
    const tail = res.rows[res.rows.length - 1]
    lastDate = String(tail.trade_date ?? "").slice(0, 10) || lastDate
    lastRowNum = Number(tail.row_num ?? 0)
    if (res.rows.length < BATCH) break
  }

  await new Promise<void>((resolve, reject) => {
    fh.end(() => resolve())
    fh.on("error", reject)
  })
  return rowsWritten
}

async function writeNavCsv(
  client: PoolClient,
  account: string,
  start: string | null,
  end: string | null,
  outPath: string,
): Promise<number> {
  const params: unknown[] = [account]
  let endSql = ""
  if (end) {
    params.push(end)
    endSql = ` AND trade_date <= $${params.length}::date`
  }
  const res = await client.query<{
    date: string
    client_equity: unknown
    daily_pnl: unknown
    deposit_wd: unknown
    balance_bf: unknown
    balance_cf: unknown
    realized_pl: unknown
    commission: unknown
  }>(
    `SELECT trade_date::text AS date,
            client_equity, daily_pnl, deposit_wd,
            balance_bf, balance_cf, realized_pl, commission
       FROM public.cfmmc_daily_summary
      WHERE account_no = $1 AND ${ACCOUNT_OK}${endSql}
      ORDER BY trade_date ASC`,
    params,
  )
  const series = compoundAccountRiskNav(aggregateEquityByDate(res.rows))
  const visible = start ? series.filter((p) => p.date >= start) : series
  const headers = ["date", "nav", "daily_return", "pnl", "cum_pnl", "equity", "net_flow"]
  const lines = [csvLine(headers)]
  for (const p of visible) {
    lines.push(csvLine([p.date, p.nav, p.dailyReturn, p.pnl, p.cumPnl, p.cumCapital, p.netFlow]))
  }
  fs.writeFileSync(outPath, "\ufeff" + lines.join("\n") + "\n", "utf8")
  return visible.length
}

async function writeOpsCsv(client: PoolClient, account: string, outPath: string): Promise<number> {
  try {
    const res = await client.query(
      `SELECT account_no, beian_hao, product_name, note, updated_by, updated_at::text AS updated_at
         FROM public.ops_fund_single_accounts
        WHERE account_no = $1`,
      [account],
    )
    const headers = ["account_no", "beian_hao", "product_name", "note", "updated_by", "updated_at"]
    const lines = [csvLine(headers)]
    for (const row of res.rows as Record<string, unknown>[]) {
      lines.push(csvLine(headers.map((h) => row[h])))
    }
    fs.writeFileSync(outPath, "\ufeff" + lines.join("\n") + "\n", "utf8")
    return res.rows.length
  } catch (err) {
    const code = (err as { code?: string } | null)?.code
    const msg = err instanceof Error ? err.message : String(err)
    if (code === "42P01" || msg.includes("does not exist")) {
      fs.writeFileSync(outPath, "\ufeffaccount_no,beian_hao,product_name,note,updated_by,updated_at\n", "utf8")
      return 0
    }
    throw err
  }
}

function writeMetaCsv(
  account: string,
  identity: {
    client_name: string | null
    company_name: string | null
    first_date: string | null
    last_date: string | null
    trading_days: number | string
  },
  fundName: string,
  counts: Record<string, number>,
  outPath: string,
) {
  const clientName = String(identity.client_name ?? "").trim()
  const companyRaw = String(identity.company_name ?? "").trim()
  const rows: Array<[string, string]> = [
    ["account_no", account],
    ["client_name", clientName],
    ["fund_name", fundName || productNameFromClientLabel(clientName) || ""],
    ["company", shortCompanyName(companyRaw)],
    ["company_name", companyRaw],
    ["first_date", String(identity.first_date ?? "")],
    ["last_date", String(identity.last_date ?? "")],
    ["trading_days", String(identity.trading_days ?? "")],
    ...Object.entries(counts).map(([k, v]) => [`rows_${k}`, String(v)] as [string, string]),
  ]
  const lines = ["key,value", ...rows.map(([k, v]) => csvLine([k, v]))]
  fs.writeFileSync(outPath, "\ufeff" + lines.join("\n") + "\n", "utf8")
}


export async function handleAccountRiskExport(
  record: Record<string, string | undefined>,
): Promise<MomDataEnvelope<unknown> | AccountRiskBinaryResult> {
  const account = accountCode(record.account)
  if (!account) return momDataErr(1, "account is required")
  const start = record.start_date ? isoDate(record.start_date) : null
  const end = record.end_date ? isoDate(record.end_date) : null
  if (record.start_date && !start) return momDataErr(1, "start_date must be YYYY-MM-DD")
  if (record.end_date && !end) return momDataErr(1, "end_date must be YYYY-MM-DD")
  if (start && end && start > end) return momDataErr(1, "start_date must be on or before end_date")

  const datasets = parseDatasets(record.datasets ?? record.dataset)
  if (!Array.isArray(datasets)) return datasets

  const format = (record.format ?? "zip").trim().toLowerCase()
  if (!["zip", "dir", "json"].includes(format)) {
    return momDataErr(1, "format must be zip, dir, or json")
  }
  if (format !== "zip" && record.dataset && !record.datasets) {
    // single-dataset CSV download is handled by format=csv on sheet routes; keep export multi-file
  }

  const singleCsv = (record.format ?? "").trim().toLowerCase() === "csv"
  if (singleCsv) {
    const only = datasets.filter((d) => d !== "meta")
    if (only.length !== 1) {
      return momDataErr(1, "format=csv on /account/export requires exactly one dataset (e.g. dataset=positions)")
    }
  }

  return publicWithClient(async (client) => {
    const identity = await loadIdentity(client, account)
    if (!identity) return momDataErr(2, "account not found")
    const clientName = String(identity.client_name ?? "").trim()
    const companyRaw = String(identity.company_name ?? "").trim()
    const company = shortCompanyName(companyRaw)
    let fundName = productNameFromClientLabel(clientName)
    try {
      const ops = await client.query<{ product_name: string | null }>(
        `SELECT product_name FROM public.ops_fund_single_accounts WHERE account_no = $1 LIMIT 1`,
        [account],
      )
      const product = String(ops.rows[0]?.product_name ?? "").trim()
      if (product) fundName = product
    } catch {
      // ops table optional
    }
    const companyQ = companyQuery(record)
    if (companyQ && !labelMatches(companyQ, [company, companyRaw, clientName, fundName])) {
      return momDataErr(2, "account does not match company")
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
    const outRoot = (record.out_dir ?? "").trim()
      ? path.resolve(record.out_dir!.trim())
      : path.join(process.cwd(), "tmp", "cfmmc-exports", `${account}_${stamp}`)
    fs.mkdirSync(outRoot, { recursive: true })

    const counts: Record<string, number> = {}
    const files: Array<{ dataset: string; file: string; rows: number; bytes: number }> = []

    const addFile = (dataset: string, filePath: string, rows: number) => {
      const st = fs.statSync(filePath)
      counts[dataset] = rows
      files.push({
        dataset,
        file: path.basename(filePath),
        rows,
        bytes: st.size,
      })
    }

    if (datasets.includes("meta") && !singleCsv) {
      // written after counts known
    }

    for (const sheet of SHEETS) {
      if (!datasets.includes(sheet.id)) continue
      if (singleCsv && datasets[0] !== sheet.id) continue
      const filePath = path.join(outRoot, `${sheet.file}_${account}.csv`)
      const rows = await writeSheetCsv(client, sheet, account, start, end, filePath)
      addFile(sheet.id, filePath, rows)
      if (singleCsv) {
        const body = fs.readFileSync(filePath)
        return {
          kind: "binary",
          body,
          contentType: "text/csv; charset=utf-8",
          filename: path.basename(filePath),
        }
      }
    }

    if (datasets.includes("nav") && !singleCsv) {
      const filePath = path.join(outRoot, `cfmmc_nav_${account}.csv`)
      const rows = await writeNavCsv(client, account, start, end, filePath)
      addFile("nav", filePath, rows)
    } else if (singleCsv && datasets[0] === "nav") {
      const filePath = path.join(outRoot, `cfmmc_nav_${account}.csv`)
      const rows = await writeNavCsv(client, account, start, end, filePath)
      const body = fs.readFileSync(filePath)
      return {
        kind: "binary",
        body,
        contentType: "text/csv; charset=utf-8",
        filename: path.basename(filePath),
      }
    }

    if (datasets.includes("ops") && !singleCsv) {
      const filePath = path.join(outRoot, `ops_fund_single_accounts_${account}.csv`)
      const rows = await writeOpsCsv(client, account, filePath)
      addFile("ops", filePath, rows)
    } else if (singleCsv && datasets[0] === "ops") {
      const filePath = path.join(outRoot, `ops_fund_single_accounts_${account}.csv`)
      await writeOpsCsv(client, account, filePath)
      const body = fs.readFileSync(filePath)
      return {
        kind: "binary",
        body,
        contentType: "text/csv; charset=utf-8",
        filename: path.basename(filePath),
      }
    }

    if (singleCsv && datasets[0] === "meta") {
      const filePath = path.join(outRoot, `_meta_${account}.csv`)
      writeMetaCsv(account, identity, fundName, counts, filePath)
      const body = fs.readFileSync(filePath)
      return {
        kind: "binary",
        body,
        contentType: "text/csv; charset=utf-8",
        filename: path.basename(filePath),
      }
    }

    if (datasets.includes("meta")) {
      const filePath = path.join(outRoot, `_meta_${account}.csv`)
      writeMetaCsv(account, identity, fundName, counts, filePath)
      addFile("meta", filePath, 1)
    }

    const manifest = {
      account,
      fund_name: fundName || null,
      client_name: clientName || null,
      company: company || null,
      company_name: companyRaw || null,
      first_date: identity.first_date,
      last_date: identity.last_date,
      trading_days: Number(identity.trading_days ?? 0),
      start_date: start,
      end_date: end,
      datasets,
      files,
      dir: outRoot,
      note: "History holdings are in cfmmc_positions_*.csv (every imported trading day). Generated by GET /cfmmc/account/export.",
    }
    fs.writeFileSync(path.join(outRoot, "_manifest.json"), JSON.stringify(manifest, null, 2), "utf8")

    if (format === "dir" || format === "json") {
      return momDataOk(manifest)
    }

    const zipName = `cfmmc_export_${account}.zip`
    const zip = new AdmZip()
    for (const name of fs.readdirSync(outRoot)) {
      if (name.endsWith(".zip")) continue
      const full = path.join(outRoot, name)
      if (fs.statSync(full).isFile()) zip.addLocalFile(full)
    }
    return {
      kind: "binary",
      body: zip.toBuffer(),
      contentType: "application/zip",
      filename: zipName,
    }
  }, { statementTimeoutMs: 0 })
}

/** Stream one CFMMC sheet as CSV (for GET /cfmmc/account/{sheet}?format=csv). */
export async function streamAccountRiskSheetCsv(
  sheetId: string,
  record: Record<string, string | undefined>,
): Promise<MomDataEnvelope<unknown> | AccountRiskBinaryResult> {
  const sheet = SHEETS.find((s) => s.id === sheetId)
  if (!sheet) return momDataErr(1, `unknown sheet: ${sheetId}`)
  const account = accountCode(record.account)
  if (!account) return momDataErr(1, "account is required")
  const start = record.start_date ? isoDate(record.start_date) : null
  const end = record.end_date ? isoDate(record.end_date) : null
  if (record.start_date && !start) return momDataErr(1, "start_date must be YYYY-MM-DD")
  if (record.end_date && !end) return momDataErr(1, "end_date must be YYYY-MM-DD")
  if (start && end && start > end) return momDataErr(1, "start_date must be on or before end_date")

  // positions without date range: export ALL history (that is the point of format=csv)
  return publicWithClient(async (client) => {
    const exists = await client.query(
      `SELECT 1 AS ok FROM public.cfmmc_daily_summary WHERE account_no = $1 AND ${ACCOUNT_OK} LIMIT 1`,
      [account],
    )
    if (!exists.rows.length) return momDataErr(2, "account not found")
    const companyQ = companyQuery(record)
    if (companyQ) {
      const identity = await loadIdentity(client, account)
      const clientName = String(identity?.client_name ?? "").trim()
      const companyRaw = String(identity?.company_name ?? "").trim()
      if (!labelMatches(companyQ, [shortCompanyName(companyRaw), companyRaw, clientName, productNameFromClientLabel(clientName)])) {
        return momDataErr(2, "account does not match company")
      }
    }
    const tmp = path.join(os.tmpdir(), `cfmmc_${sheet.id}_${account}_${Date.now()}.csv`)
    try {
      await writeSheetCsv(client, sheet, account, start, end, tmp)
      const body = fs.readFileSync(tmp)
      return {
        kind: "binary",
        body,
        contentType: "text/csv; charset=utf-8",
        filename: `${sheet.file}_${account}.csv`,
      }
    } finally {
      try { fs.unlinkSync(tmp) } catch { /* ignore */ }
    }
  }, { statementTimeoutMs: 0 })
}

