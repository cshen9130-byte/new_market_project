import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { shapeFofUnderlyingPage, shapeReviewProduct, pickGroupHighlights, shapeWeeklyStatus, ratioToPct, roundNum, type ReviewProduct } from "@/lib/ma/investment-review-shape"
import { weeklyReviewPoolFileLabel, normalizeWeeklyReviewPools } from "@/lib/ma/weekly-review-pools"
import { fundDataErr, fundDataOk, type FundDataEnvelope } from "@/lib/server/fund-data-api"
import { shortStrategy, type YingmiProduct } from "@/lib/ma/yingmi-private-fund"

const NOTE =
  "涨跌幅和收益是百分点，0.61 表示 0.61%，不要再乘 100。夏普和卡玛是比率。金额是元。只读。"

const JOB_ROOT = path.join(process.cwd(), ".tmp", "investment-review-api")
const FILE_CAP = 7_000_000

type ReviewVariant = "equity" | "futures" | "public" | "external"
type JobStatus = "pending" | "running" | "done" | "error"

type JobRecord = {
  status: JobStatus
  job_id: string
  variant: ReviewVariant
  week_end: string
  updated_at: string
  error?: string
  file_name?: string
  analysis?: unknown
}

function variantOf(raw: string | undefined): ReviewVariant | null {
  const text = (raw ?? "").trim().toLowerCase()
  if (text === "equity" || text === "stock" || text === "股票") return "equity"
  if (text === "futures" || text === "future" || text === "期货") return "futures"
  if (text === "public" || text === "public-enhanced" || text === "公募" || text === "公募指增") return "public"
  if (text === "external" || text === "rank" || text === "外部") return "external"
  return null
}

function statusVariant(raw: string | undefined): "equity" | "futures" {
  return variantOf(raw) === "futures" ? "futures" : "equity"
}

function want(raw: string | undefined): boolean {
  const text = (raw ?? "").trim().toLowerCase()
  return text === "1" || text === "true" || text === "yes"
}

function jobDir(jobId: string): string {
  return path.join(JOB_ROOT, jobId)
}

async function writeJob(record: JobRecord): Promise<void> {
  await mkdir(jobDir(record.job_id), { recursive: true })
  await writeFile(path.join(jobDir(record.job_id), "status.json"), JSON.stringify(record), "utf8")
}

async function readJob(jobId: string): Promise<JobRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null
  const raw = await readFile(path.join(jobDir(jobId), "status.json"), "utf8").catch(() => null)
  if (!raw) return null
  return JSON.parse(raw) as JobRecord
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function getFofUnderlyingTable(
  record: Record<string, string | undefined>,
): Promise<FundDataEnvelope<unknown>> {
  const page = Math.max(1, Number.parseInt(record.page || "1", 10) || 1)
  const pagesize = Math.min(200, Math.max(1, Number.parseInt(record.pagesize || record.page_size || "50", 10) || 50))
  const holding = (record.holding || "holding").trim().toLowerCase()
  const fundClass = (record.fund_class || "private").trim().toLowerCase() === "public" ? "public" : "private"
  const params = new URLSearchParams()
  params.set("page", String(page))
  params.set("pageSize", String(pagesize))
  params.set("fund_class", fundClass)
  if (holding === "holding" || holding === "cleared") params.set("holding_status", holding)
  const q = (record.q || record.keyword || "").trim()
  if (q) params.set("keyword", q)
  const strategy = (record.strategy || record.strategy_l1 || "").trim()
  if (strategy) params.set("strategy_l1", strategy)
  const cutoff = (record.cutoff || "").trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) params.set("cutoff", cutoff)
  const fof = (record.fof_reg_code || record.reg_code || "").trim()
  if (fof && record.fof_reg_code) params.set("fof_register_number", fof)
  try {
    const { GET } = await import("@/app/ma/api/investment/fof-overview/list/route")
    const res = await GET(new Request(`http://internal/ma/api/investment/fof-overview/list?${params}`))
    const json = await res.json() as { error?: string } & Parameters<typeof shapeFofUnderlyingPage>[0]
    if (!res.ok) return fundDataErr(3, typeof json.error === "string" ? json.error : "FOF底层查询失败")
    const table = shapeFofUnderlyingPage(json)
    return fundDataOk({
      ...table,
      holding: holding === "cleared" || holding === "all" ? holding : "holding",
      fund_class: fundClass,
      note: `${NOTE} 默认是持仓中的私募底层。price_change_pct 和 ret_*_pct 对应页面的最新涨跌幅和区间收益。total_market_value 是本筛选下的市值合计，不受当前页影响。`,
    })
  } catch (err) {
    return fundDataErr(3, messageOf(err))
  }
}

export async function getWeeklyReview(
  record: Record<string, string | undefined>,
): Promise<FundDataEnvelope<unknown>> {
  const jobId = (record.job_id || "").trim()
  if (jobId) return pollWeeklyJob(jobId, want(record.file))
  const report = (record.report || "preview").trim().toLowerCase()
  if (report === "run") return await startWeeklyJob(record)
  if (report === "status") return weeklyStatus(record)
  if (report === "preview") return weeklyPreview(record)
  return fundDataErr(1, "report must be preview, status, or run")
}

async function weeklyStatus(record: Record<string, string | undefined>): Promise<FundDataEnvelope<unknown>> {
  try {
    const { getWeeklyReviewDataStatus } = await import("@/lib/server/weekly-review-data-status")
    const variant = statusVariant(record.variant)
    const pools = normalizeWeeklyReviewPools(record.pools)
    const report = await getWeeklyReviewDataStatus(variant, want(record.refresh), {
      pools,
      weekEnd: record.week_end,
    })
    return fundDataOk({
      ...shapeWeeklyStatus(report),
      pools,
      note: "和周度回顾页「近三周数据状态」同一张表。missing 是该周还没有净值的产品数，0 表示页面上的「齐」。missing_sources 只统计缺净值的产品。产品收益用 report=run。",
    })
  } catch (err) {
    return fundDataErr(3, messageOf(err))
  }
}

async function weeklyPreview(record: Record<string, string | undefined>): Promise<FundDataEnvelope<unknown>> {
  const variant = variantOf(record.variant) ?? "equity"
  if (variant === "external") return externalRank(record)
  try {
    const pools = normalizeWeeklyReviewPools(record.pools)
    if (variant === "public") {
      const { buildPublicEnhancedWeeklyPreview } = await import("@/lib/server/public-enhanced-weekly-review")
      const { defaultWeeklyReviewWeekEnd } = await import("@/lib/server/jy-weekly-review")
      const preview = await buildPublicEnhancedWeeklyPreview(record.week_end || defaultWeeklyReviewWeekEnd())
      return fundDataOk({ ...preview, variant: "public", note: "分组只含产品数。收益和 Excel 用 report=run。" })
    }
    if (variant === "futures") {
      const { buildFuturesWeeklyReviewPreview } = await import("@/lib/server/jy-weekly-review-futures")
      const { defaultWeeklyReviewWeekEnd } = await import("@/lib/server/jy-weekly-review")
      const preview = await buildFuturesWeeklyReviewPreview(record.week_end || defaultWeeklyReviewWeekEnd(), pools)
      return fundDataOk({ ...preview, variant, pools, note: "分组只含产品数。收益和 Excel 用 report=run。" })
    }
    const { buildWeeklyReviewPreview, defaultWeeklyReviewWeekEnd } = await import("@/lib/server/jy-weekly-review")
    const preview = await buildWeeklyReviewPreview(record.week_end || defaultWeeklyReviewWeekEnd(), pools)
    return fundDataOk({ ...preview, variant: "equity", pools, note: "分组只含产品数。近三周是否齐用 report=status。收益和 Excel 用 report=run。" })
  } catch (err) {
    return fundDataErr(3, messageOf(err))
  }
}

async function startWeeklyJob(record: Record<string, string | undefined>): Promise<FundDataEnvelope<unknown>> {
  const variant = variantOf(record.variant)
  if (!variant) return fundDataErr(1, "variant must be equity, futures, public, or external")
  const jobId = randomUUID()
  const weekEnd = (record.week_end || "").trim()
  const pools = record.pools
  const full = want(record.full)
  const q = record.q
  const withFile = record.file == null ? true : want(record.file)
  const pending: JobRecord = {
    status: "pending",
    job_id: jobId,
    variant,
    week_end: weekEnd,
    updated_at: new Date().toISOString(),
  }
  await writeJob(pending)
  setImmediate(() => {
    void runWeeklyJob(pending, { pools, full, q, withFile })
  })
  return fundDataOk({
    job_id: jobId,
    status: "pending",
    variant,
    file: withFile,
    note: "用同一个 job_id 再调用，直到 status 为 done 或 error。不要另开一个任务。analysis 里的收益已经是百分点。file=1 且 done 时 content_base64 是和页面红色按钮相同的 xlsx。",
  })
}

async function runWeeklyJob(
  seed: JobRecord,
  opts: { pools?: string; full: boolean; q?: string; withFile: boolean },
): Promise<void> {
  const running: JobRecord = { ...seed, status: "running", updated_at: new Date().toISOString() }
  await writeJob(running)
  try {
    const built = await buildVariant(seed.variant, seed.week_end, opts)
    let fileName: string | undefined
    if (opts.withFile && built.fileName && built.buffer.length > 0) {
      await mkdir(jobDir(seed.job_id), { recursive: true })
      await writeFile(path.join(jobDir(seed.job_id), "report.xlsx"), built.buffer)
      fileName = built.fileName
    }
    await writeJob({
      ...running,
      status: built.excelError ? "error" : "done",
      updated_at: new Date().toISOString(),
      analysis: built.analysis,
      file_name: fileName,
      error: built.excelError,
    })
  } catch (err) {
    await writeJob({
      ...running,
      status: "error",
      updated_at: new Date().toISOString(),
      error: messageOf(err),
    })
  }
}

async function pollWeeklyJob(jobId: string, includeFile: boolean): Promise<FundDataEnvelope<unknown>> {
  const job = await readJob(jobId)
  if (!job) return fundDataErr(2, "任务不存在")
  const body: Record<string, unknown> = {
    job_id: job.job_id,
    status: job.status,
    variant: job.variant,
    week_end: job.week_end,
    file_name: job.file_name ?? null,
    error: job.error ?? null,
    analysis: job.status === "done" || job.analysis ? job.analysis ?? null : null,
  }
  if (includeFile && job.status === "done" && job.file_name) {
    const buffer = await readFile(path.join(jobDir(jobId), "report.xlsx")).catch(() => null)
    if (buffer && buffer.length <= FILE_CAP) {
      body.content_base64 = buffer.toString("base64")
    } else if (buffer) {
      body.file_error = "Excel 超过接口可返回的大小"
    }
  }
  return fundDataOk(body)
}

async function takeWorkbook(
  withFile: boolean,
  produce: () => Promise<{ buffer: Buffer; fileName: string }>,
): Promise<{ buffer: Buffer; fileName: string; excelError?: string }> {
  if (!withFile) return { buffer: Buffer.alloc(0), fileName: "" }
  try {
    const file = await produce()
    return { buffer: file.buffer, fileName: file.fileName }
  } catch (err) {
    return { buffer: Buffer.alloc(0), fileName: "", excelError: messageOf(err) }
  }
}

async function buildVariant(
  variant: ReviewVariant,
  weekEnd: string,
  opts: { pools?: string; full: boolean; q?: string; withFile: boolean },
): Promise<{ analysis: unknown; buffer: Buffer; fileName: string; excelError?: string }> {
  if (variant === "external") {
    const { buildExternalRankWeekFile, buildExternalRankWeekPreview } = await import("@/lib/server/external-rank-week")
    const preview = await buildExternalRankWeekPreview(weekEnd)
    const file = await takeWorkbook(opts.withFile, () => buildExternalRankWeekFile(weekEnd))
    return { analysis: shapeExternalPreview(preview, opts.q), buffer: file.buffer, fileName: file.fileName, excelError: file.excelError }
  }
  if (variant === "public") {
    const { buildPublicEnhancedWeeklyPerformance, generatePublicEnhancedWeeklyWorkbook } = await import("@/lib/server/public-enhanced-weekly-review")
    const { buildMarketRows, resolveWeekWindow, defaultWeeklyReviewWeekEnd } = await import("@/lib/server/jy-weekly-review")
    const performance = await buildPublicEnhancedWeeklyPerformance(weekEnd || defaultWeeklyReviewWeekEnd())
    const window = resolveWeekWindow(performance.week_end)
    const market = await buildMarketRows(window.weekStart, window.weekEnd)
    const file = await takeWorkbook(opts.withFile, () => generatePublicEnhancedWeeklyWorkbook(performance.week_end))
    return {
      analysis: {
        variant: "public",
        title: "公募指增 · 周度回顾",
        week_start: performance.week_start,
        week_end: performance.week_end,
        as_of: performance.as_of,
        fund_count: performance.fund_count,
        market: shapeMarket(market),
        groups: performance.groups.map((group) => {
          const products = group.products.map((row) => publicProduct(row, group.mode))
          const highlights = pickGroupHighlights(products, opts)
          return {
            bucket: group.bucket,
            mode: group.mode,
            mode_label: group.mode === "excess" ? "超额收益" : "绝对收益",
            ...highlights,
          }
        }),
        note: `${NOTE} week_pct 已按该分组口径取超额或绝对收益。Excel 百分比格存的是小数，分析时用这里的百分点，不要读 xlsx 再乘 100。`,
      },
      buffer: file.buffer,
      fileName: file.fileName,
      excelError: file.excelError,
    }
  }
  if (variant === "futures") {
    const analysis = await futuresAnalysis(weekEnd, opts)
    const { generateJyFuturesWeeklyReviewWorkbook } = await import("@/lib/server/jy-weekly-review-futures")
    const file = await takeWorkbook(opts.withFile, () => generateJyFuturesWeeklyReviewWorkbook(analysis.week_end, opts.pools))
    return { analysis, buffer: file.buffer, fileName: file.fileName, excelError: file.excelError }
  }
  const analysis = await equityAnalysis(weekEnd, opts)
  const { generateJyWeeklyReviewWorkbook } = await import("@/lib/server/jy-weekly-review")
  const file = await takeWorkbook(opts.withFile, () => generateJyWeeklyReviewWorkbook(analysis.week_end, opts.pools))
  return { analysis, buffer: file.buffer, fileName: file.fileName, excelError: file.excelError }
}

async function equityAnalysis(
  weekEnd: string,
  opts: { pools?: string; full: boolean; q?: string },
): Promise<Record<string, unknown> & { week_end: string }> {
  const {
    WEEKLY_REVIEW_STATUS_HIDDEN_BUCKETS,
  } = await import("@/lib/weekly-review-data-status")
  const {
    bucketForFund,
    buildMarketRows,
    collapseWeeklyReviewFunds,
    computeFundMetrics,
    isEquityFund,
    loadJyTrackingPoolFunds,
    loadWeeklyReviewNavCoverage,
    metricModeForBucket,
    resolveWeekWindow,
    defaultWeeklyReviewWeekEnd,
  } = await import("@/lib/server/jy-weekly-review")
  const pools = normalizeWeeklyReviewPools(opts.pools)
  const window = resolveWeekWindow(weekEnd || defaultWeeklyReviewWeekEnd())
  const equity = (await loadJyTrackingPoolFunds(pools)).filter(isEquityFund)
  const coverage = await loadWeeklyReviewNavCoverage(equity, window.asOf)
  const funds = collapseWeeklyReviewFunds(equity, coverage)
    .filter((fund) => !WEEKLY_REVIEW_STATUS_HIDDEN_BUCKETS.has(bucketForFund(fund)))
  const [metrics, market] = await Promise.all([
    funds.length ? computeFundMetrics(funds, window.asOf) : Promise.resolve([]),
    buildMarketRows(window.weekStart, window.weekEnd),
  ])
  const byBucket = new Map<string, ReturnType<typeof shapeReviewProduct>[]>()
  for (const row of metrics) {
    if (WEEKLY_REVIEW_STATUS_HIDDEN_BUCKETS.has(row.bucket)) continue
    const list = byBucket.get(row.bucket) ?? []
    list.push(shapeReviewProduct(row))
    byBucket.set(row.bucket, list)
  }
  return {
    variant: "equity",
    title: `${weeklyReviewPoolFileLabel(pools)} · 周度回顾(股票)`,
    pools,
    week_start: window.weekStart,
    week_end: window.weekEnd,
    as_of: window.asOf,
    fund_count: metrics.length,
    market: shapeMarket(market),
    groups: [...byBucket.entries()].map(([bucket, products]) => ({
      bucket,
      mode: metricModeForBucket(bucket),
      mode_label: metricModeForBucket(bucket) === "excess" ? "超额收益" : "绝对收益",
      ...pickGroupHighlights(products, opts),
    })),
    note: `${NOTE} 超额分组的 week_pct 是超额，绝对收益分组的 week_pct 是收益。同一产品的 A/B/C 份额已合并。这是生成周报 Excel 用的同一套计算。`,
  }
}

async function futuresAnalysis(
  weekEnd: string,
  opts: { pools?: string; full: boolean; q?: string },
): Promise<Record<string, unknown> & { week_end: string }> {
  const {
    collapseWeeklyReviewFunds,
    computeFundMetrics,
    loadJyTrackingPoolFunds,
    loadWeeklyReviewNavCoverage,
    resolveWeekWindow,
    defaultWeeklyReviewWeekEnd,
  } = await import("@/lib/server/jy-weekly-review")
  const {
    FUTURES_WEEKLY_CATEGORIES,
    futuresWeeklyCategories,
    isFuturesWeeklyFund,
  } = await import("@/lib/server/jy-weekly-review-futures")
  const pools = normalizeWeeklyReviewPools(opts.pools)
  const window = resolveWeekWindow(weekEnd || defaultWeeklyReviewWeekEnd())
  const pool = (await loadJyTrackingPoolFunds(pools)).filter(isFuturesWeeklyFund)
  const coverage = await loadWeeklyReviewNavCoverage(pool, window.asOf)
  const funds = collapseWeeklyReviewFunds(pool, coverage)
  const classified = funds.filter((fund) => futuresWeeklyCategories(fund).length > 0)
  const metrics = classified.length
    ? await computeFundMetrics(classified, window.asOf, undefined, {
      bucketFor: () => FUTURES_WEEKLY_CATEGORIES[0],
      modeFor: () => "absolute",
    })
    : []
  const byCode = new Map(metrics.map((row) => [row.beian_hao, row]))
  const groups = FUTURES_WEEKLY_CATEGORIES.map((category) => {
    const products: ReviewProduct[] = []
    for (const fund of classified) {
      if (!futuresWeeklyCategories(fund).includes(category)) continue
      const row = byCode.get(fund.beian_hao)
      if (!row) continue
      products.push(shapeReviewProduct({ ...row, mode: "absolute", bucket: category }))
    }
    return {
      bucket: category,
      mode: "absolute" as const,
      mode_label: "绝对收益",
      ...pickGroupHighlights(products, opts),
    }
  }).filter((group) => group.count > 0)
  return {
    variant: "futures",
    title: `${weeklyReviewPoolFileLabel(pools)} · 周度回顾(期货)`,
    pools,
    week_start: window.weekStart,
    week_end: window.weekEnd,
    as_of: window.asOf,
    fund_count: classified.length,
    groups,
    note: `${NOTE} 期货表一律是绝对收益，week_pct 就是近一周收益。一只产品可以同时出现在多张表。分类按三级策略标签，表名里的括号不是过滤条件。期货市场回顾只在 Excel 里。`,
  }
}

function shapeMarket(market: {
  rangeLabel: string
  broad: Array<{ name: string; code: string | null; ret: number | null }>
  style: Array<{ name: string; code: string | null; ret: number | null }>
  sector: Array<{ name: string; code: string | null; ret: number | null }>
  avgAmount: number | null
  avgAdv: number | null
}) {
  const mapRow = (row: { name: string; code: string | null; ret: number | null }) => ({
    name: row.name,
    code: row.code,
    ret_pct: ratioToPct(row.ret),
  })
  return {
    range_label: market.rangeLabel,
    broad: market.broad.map(mapRow),
    style: market.style.map(mapRow),
    sector: market.sector.map(mapRow),
    avg_amount_yi: roundNum(market.avgAmount, 2),
    avg_advancers: roundNum(market.avgAdv, 0),
  }
}

function publicProduct(
  row: { code: string; name: string; ret_1w: number | null; ret_1m: number | null; ret_3m: number | null; ret_6m: number | null; ret_1y: number | null },
  mode: "excess" | "absolute",
): ReviewProduct {
  const empty = { ret_1w: null, ret_1m: null, ret_3m: null, ret_6m: null, ret_1y: null }
  const periods = {
    ret_1w: row.ret_1w,
    ret_1m: row.ret_1m,
    ret_3m: row.ret_3m,
    ret_6m: row.ret_6m,
    ret_1y: row.ret_1y,
  }
  return shapeReviewProduct({
    beian_hao: row.code,
    name: row.name,
    mode,
    ret: mode === "absolute" ? periods : empty,
    excess: mode === "excess" ? periods : empty,
    excess_dd_6m: null,
    excess_dd_1y: null,
    sharpe_1y: null,
    calmar_1y: null,
  })
}

export async function getExternalRank(
  record: Record<string, string | undefined>,
): Promise<FundDataEnvelope<unknown>> {
  return externalRank(record)
}

async function externalRank(record: Record<string, string | undefined>): Promise<FundDataEnvelope<unknown>> {
  const source = (record.source || "files").trim().toLowerCase()
  if (source === "yingmi" || source === "盈米") return yingmiRank(record)
  try {
    const { buildExternalRankWeekPreview } = await import("@/lib/server/external-rank-week")
    const { defaultWeeklyReviewWeekEnd } = await import("@/lib/server/jy-weekly-review")
    const preview = await buildExternalRankWeekPreview(record.week_end || defaultWeeklyReviewWeekEnd())
    return fundDataOk({
      ...shapeExternalPreview(preview, record.q, record.strategy),
      note: `${NOTE} 这是知识库「外部私募业绩排行」里对上所选周的榜单。ytd_pct、ret_1w_pct、ytd_drawdown_pct 是百分点。和跟踪池对名次用 external_rank_compare。生成本周 Excel 用 weekly_review，variant=external，report=run。盈米代销用 source=yingmi。`,
    })
  } catch (err) {
    return fundDataErr(3, messageOf(err))
  }
}

function shapeExternalPreview(
  preview: {
    folder: string
    week_start: string
    week_end: string
    scanned: number
    weeks: Array<{ week_start: string; week_end: string; file_count: number }>
    files: Array<{
      name: string
      path: string
      parsed: boolean
      title: string
      as_of: string | null
      row_count: number
      error: string | null
      rows: Array<{
        rank: number
        strategy: string
        class_key: string
        manager: string
        product: string | null
        aum: string | null
        nav_date: string | null
        ytd: number | null
        ytd_drawdown: number | null
        ret_1w: number | null
      }>
    }>
  },
  q?: string,
  strategy?: string,
) {
  const query = (q ?? "").trim().toLowerCase()
  const strategyText = (strategy ?? "").trim()
  const files = preview.files.map((file) => {
    const rows = file.rows.filter((row) => {
      if (strategyText && strategyText !== "全部") {
        const label = row.class_key || row.strategy || "未分类"
        if (label !== strategyText && !label.includes(strategyText)) return false
      }
      if (!query) return true
      return `${row.manager} ${row.product || ""} ${row.strategy}`.toLowerCase().includes(query)
    }).slice(0, 40).map((row) => ({
      rank: row.rank,
      strategy: row.class_key || row.strategy,
      manager: row.manager,
      product: row.product,
      aum: row.aum,
      nav_date: row.nav_date,
      ytd_pct: ratioToPct(row.ytd),
      ytd_drawdown_pct: ratioToPct(row.ytd_drawdown),
      ret_1w_pct: ratioToPct(row.ret_1w),
    }))
    return {
      name: file.name,
      path: file.path,
      parsed: file.parsed,
      title: file.title,
      as_of: file.as_of,
      row_count: file.row_count,
      error: file.error,
      rows,
    }
  })
  return {
    source: "files",
    folder: preview.folder,
    week_start: preview.week_start,
    week_end: preview.week_end,
    scanned: preview.scanned,
    weeks: preview.weeks,
    files,
  }
}

async function yingmiRank(record: Record<string, string | undefined>): Promise<FundDataEnvelope<unknown>> {
  const { GET } = await import("@/app/ma/api/yingmi-private-funds/route")
  const res = await GET()
  const json = await res.json() as {
    error?: string
    connected?: boolean
    status?: string
    count?: number
    seedAsOf?: string
    strategies?: Array<{ full: string; label: string; count: number }>
    products?: Array<YingmiProduct & { strategyLabel?: string }>
  }
  if (!res.ok) return fundDataErr(3, json.error || "盈米榜单查询失败")
  const q = (record.q || "").trim().toLowerCase()
  const strategy = (record.strategy || "").trim()
  const limit = Math.min(80, Math.max(1, Number.parseInt(record.limit || "40", 10) || 40))
  const peers = (json.strategies ?? []).map((row) => row.full)
  const products = (json.products ?? []).filter((row) => {
    const label = row.strategyLabel || shortStrategy(row.strategyLevel1, peers)
    if (strategy && !`${label} ${row.strategyLevel1} ${row.strategyLevel2 || ""}`.includes(strategy)) return false
    if (!q) return true
    return `${row.fundName} ${row.companyName} ${row.fundCode}`.toLowerCase().includes(q)
  }).slice(0, limit).map((row) => ({
    fund_code: row.fundCode,
    product_name: row.fundName,
    company: row.companyName,
    strategy: row.strategyLabel || shortStrategy(row.strategyLevel1, peers),
    nav_date: row.navDate,
    latest_nav: roundNum(row.navUnit, 4),
    ret_1y_pct: ratioToPct(row.return1y),
    max_drawdown_1y_pct: ratioToPct(row.maxDrawdown1y),
    note: row.note || null,
  }))
  return fundDataOk({
    source: "yingmi",
    connected: json.connected ?? false,
    status: json.status ?? null,
    count: json.count ?? products.length,
    seed_as_of: json.seedAsOf ?? null,
    strategies: json.strategies ?? [],
    rows: products,
    note: `${NOTE} 盈米代销私募。ret_1y_pct 是近一年收益。没有业绩时看 note。这不是知识库周报文件。`,
  })
}
