import { query } from "@/lib/db"
import type {
  AnnualReportRow,
  BranchRow,
  ChangeRecordRow,
  ExternalInvestmentRow,
} from "@/lib/ma/manager-enterprise-seed"

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 8_000
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"

export type GsxtStatus = "ok" | "captcha" | "empty" | "error"

export type GsxtRegistrationPatch = {
  business_reg_no: string | null
  unified_credit_code: string | null
  business_term: string | null
  business_scope: string | null
  operating_status: string | null
}

export type GsxtSnapshot = {
  status: GsxtStatus
  source: string | null
  registration: GsxtRegistrationPatch
  external_investments: ExternalInvestmentRow[]
  branches: BranchRow[]
  annual_reports: AnnualReportRow[]
  change_records: ChangeRecordRow[]
}

type CacheRow = {
  status: string
  source: string | null
  business_reg_no: string | null
  unified_credit_code: string | null
  business_term: string | null
  business_scope: string | null
  operating_status: string | null
  payload: {
    external_investments?: ExternalInvestmentRow[]
    branches?: BranchRow[]
    annual_reports?: AnnualReportRow[]
    change_records?: ChangeRecordRow[]
  } | null
  fetched_at: string | Date
}

let schemaPromise: Promise<void> | null = null

const EMPTY_REG: GsxtRegistrationPatch = {
  business_reg_no: null,
  unified_credit_code: null,
  business_term: null,
  business_scope: null,
  operating_status: null,
}

function emptySnapshot(status: GsxtStatus, source: string | null = null): GsxtSnapshot {
  return {
    status,
    source,
    registration: { ...EMPTY_REG },
    external_investments: [],
    branches: [],
    annual_reports: [],
    change_records: [],
  }
}

export async function ensureGsxtSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = query(`
      CREATE TABLE IF NOT EXISTS manager_gsxt_cache (
        registration_no         TEXT PRIMARY KEY,
        manager_name            TEXT,
        status                  TEXT NOT NULL DEFAULT 'empty',
        source                  TEXT,
        business_reg_no         TEXT,
        unified_credit_code     TEXT,
        business_term           TEXT,
        business_scope          TEXT,
        operating_status        TEXT,
        payload                 JSONB NOT NULL DEFAULT '{}'::jsonb,
        fetched_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
      .then(() => undefined)
      .catch((err) => {
        schemaPromise = null
        throw err
      })
  }
  await schemaPromise
}

function cacheIsFresh(fetchedAt: string | Date): boolean {
  const ts = typeof fetchedAt === "string" ? Date.parse(fetchedAt) : fetchedAt.getTime()
  return Number.isFinite(ts) && Date.now() - ts <= CACHE_TTL_MS
}

function looksLikeCaptcha(body: string): boolean {
  return /geetest|gt_captcha|滑动验证|请完成验证|验证码|waf_captcha|aliyun_waf|__jsl_clearance|jsl_clearance|document\.cookie=\('_'\)/i.test(
    body,
  )
}

function looksLikeCreditCode(value: string): boolean {
  return /^[0-9A-Z]{18}$/.test(value.replace(/\s/g, ""))
}

function pickText(html: string, labels: string[]): string | null {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const patterns = [
      new RegExp(`${escaped}\\s*[:：</>\\s]+([^<\\n]{2,240})`),
      new RegExp(`"${escaped}"\\s*[:：]\\s*"([^"]{2,240})"`),
    ]
    for (const pattern of patterns) {
      const match = html.match(pattern)
      const value = match?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
      if (value && !/暂无|无数据|--|^null$/i.test(value)) return value
    }
  }
  return null
}

function snapshotFromHtml(html: string, source: string, managerName?: string): GsxtSnapshot | null {
  if (looksLikeCaptcha(html)) return emptySnapshot("captcha", source)
  if (managerName) {
    const hint = managerName.slice(0, 6)
    if (hint && !html.includes(managerName) && !html.includes(hint)) return null
  }

  const credit =
    html.match(/[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}/)?.[0] ??
    pickText(html, ["统一社会信用代码", "信用代码", "uniscId"])
  const status = pickText(html, ["登记状态", "经营状态", "企业状态", "regStatus"])
  const scope = pickText(html, ["经营范围", "opsScope", "businessScope"])
  const term = pickText(html, ["营业期限", "经营期限", "opFrom"])
  const regno = pickText(html, ["工商注册号", "注册号", "regNo"])

  const hasUseful = Boolean(
    (credit && looksLikeCreditCode(credit)) || status || (scope && scope.length > 8) || term || regno,
  )
  if (!hasUseful) return null

  return {
    status: "ok",
    source,
    registration: {
      business_reg_no: regno,
      unified_credit_code: credit && looksLikeCreditCode(credit) ? credit : null,
      business_term: term,
      business_scope: scope && scope.length > 8 ? scope : null,
      operating_status: status,
    },
    external_investments: [],
    branches: [],
    annual_reports: [],
    change_records: [],
  }
}

async function fetchText(url: string, init?: RequestInit): Promise<{ ok: boolean; body: string; status: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      ...init,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        ...(init?.headers ?? {}),
      },
    })
    const body = await res.text()
    return { ok: res.ok, body, status: res.status }
  } catch {
    return { ok: false, body: "", status: 0 }
  } finally {
    clearTimeout(timer)
  }
}

async function tryGsxt(managerName: string): Promise<GsxtSnapshot | null> {
  const q = encodeURIComponent(managerName)
  const urls = [
    `https://www.gsxt.gov.cn/corp-query-search-1.html?searchword=${q}`,
    `https://www.gsxt.gov.cn/index.html`,
  ]
  let sawCaptcha = false
  for (const url of urls) {
    const res = await fetchText(url, { headers: { Referer: "https://www.gsxt.gov.cn/" } })
    if (!res.body) continue
    if (looksLikeCaptcha(res.body)) {
      sawCaptcha = true
      continue
    }
    const parsed = snapshotFromHtml(res.body, "gsxt.gov.cn", managerName)
    if (parsed) return parsed
  }
  return sawCaptcha ? emptySnapshot("captcha", "gsxt.gov.cn") : null
}

async function tryCods(managerName: string): Promise<GsxtSnapshot | null> {
  const q = encodeURIComponent(managerName)
  const urls = [
    `https://www.cods.org.cn/cods/dmcx/`,
    `https://www.cods.org.cn/cods-search/api/search?keyword=${q}`,
  ]
  let sawCaptcha = false
  for (const url of urls) {
    const res = await fetchText(url)
    if (!res.body) continue
    if (looksLikeCaptcha(res.body)) {
      sawCaptcha = true
      continue
    }
    try {
      const json = JSON.parse(res.body) as {
        data?: Array<Record<string, string>>
        rows?: Array<Record<string, string>>
      }
      const row = json.data?.[0] ?? json.rows?.[0]
      if (row) {
        const credit = row.uniscId || row.creditCode || row.tyshxydm || ""
        return {
          status: "ok",
          source: "cods.org.cn",
          registration: {
            business_reg_no: row.regNo || row.zch || null,
            unified_credit_code: looksLikeCreditCode(credit) ? credit : null,
            business_term: row.opFrom && row.opTo ? `${row.opFrom} 至 ${row.opTo}` : null,
            business_scope: row.opsScope || row.jyfw || null,
            operating_status: row.regStatus || row.entStatus || null,
          },
          external_investments: [],
          branches: [],
          annual_reports: [],
          change_records: [],
        }
      }
    } catch {
      /* HTML landing page */
    }
    const parsed = snapshotFromHtml(res.body, "cods.org.cn", managerName)
    if (parsed) return parsed
  }
  return sawCaptcha ? emptySnapshot("captcha", "cods.org.cn") : null
}

async function tryCreditChina(managerName: string): Promise<GsxtSnapshot | null> {
  const q = encodeURIComponent(managerName)
  const urls = [
    `https://www.creditchina.gov.cn/xinyongxinxi/?keyword=${q}`,
    `https://www.creditchina.gov.cn/`,
  ]
  let sawCaptcha = false
  for (const url of urls) {
    const res = await fetchText(url)
    if (!res.body) continue
    if (looksLikeCaptcha(res.body)) {
      sawCaptcha = true
      continue
    }
    const parsed = snapshotFromHtml(res.body, "creditchina.gov.cn", managerName)
    if (parsed) return parsed
  }
  return sawCaptcha ? emptySnapshot("captcha", "creditchina.gov.cn") : null
}

async function tryShanghaiCredit(managerName: string): Promise<GsxtSnapshot | null> {
  const q = encodeURIComponent(managerName)
  const urls = [
    `https://credit.sh.gov.cn/credit-portal/web/publicity/ent?keyword=${q}`,
    `https://fw.scjgj.sh.gov.cn/notice/search?keyword=${q}`,
  ]
  let sawCaptcha = false
  for (const url of urls) {
    const res = await fetchText(url)
    if (!res.body) continue
    if (looksLikeCaptcha(res.body)) {
      sawCaptcha = true
      continue
    }
    const parsed = snapshotFromHtml(res.body, new URL(url).hostname, managerName)
    if (parsed) return parsed
  }
  return sawCaptcha ? emptySnapshot("captcha", "credit.sh.gov.cn") : null
}

function rowToSnapshot(row: CacheRow): GsxtSnapshot {
  const payload = row.payload ?? {}
  return {
    status: (["ok", "captcha", "empty", "error"].includes(row.status) ? row.status : "empty") as GsxtStatus,
    source: row.source,
    registration: {
      business_reg_no: row.business_reg_no,
      unified_credit_code: row.unified_credit_code,
      business_term: row.business_term,
      business_scope: row.business_scope,
      operating_status: row.operating_status,
    },
    external_investments: payload.external_investments ?? [],
    branches: payload.branches ?? [],
    annual_reports: payload.annual_reports ?? [],
    change_records: payload.change_records ?? [],
  }
}

async function loadCached(registrationNo: string): Promise<GsxtSnapshot | null> {
  try {
    const rows = await query<CacheRow>(
      `SELECT status, source, business_reg_no, unified_credit_code, business_term,
              business_scope, operating_status, payload, fetched_at
       FROM manager_gsxt_cache
       WHERE UPPER(registration_no) = UPPER($1)
       LIMIT 1`,
      [registrationNo],
    )
    const row = rows[0]
    if (!row || !cacheIsFresh(row.fetched_at)) return null
    return rowToSnapshot(row)
  } catch {
    return null
  }
}

async function persistSnapshot(
  registrationNo: string,
  managerName: string,
  snapshot: GsxtSnapshot,
): Promise<void> {
  await query(
    `INSERT INTO manager_gsxt_cache (
       registration_no, manager_name, status, source, business_reg_no,
       unified_credit_code, business_term, business_scope, operating_status,
       payload, fetched_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW(), NOW())
     ON CONFLICT (registration_no) DO UPDATE SET
       manager_name = EXCLUDED.manager_name,
       status = EXCLUDED.status,
       source = EXCLUDED.source,
       business_reg_no = EXCLUDED.business_reg_no,
       unified_credit_code = EXCLUDED.unified_credit_code,
       business_term = EXCLUDED.business_term,
       business_scope = EXCLUDED.business_scope,
       operating_status = EXCLUDED.operating_status,
       payload = EXCLUDED.payload,
       fetched_at = EXCLUDED.fetched_at,
       updated_at = NOW()`,
    [
      registrationNo,
      managerName,
      snapshot.status,
      snapshot.source,
      snapshot.registration.business_reg_no,
      snapshot.registration.unified_credit_code,
      snapshot.registration.business_term,
      snapshot.registration.business_scope,
      snapshot.registration.operating_status,
      JSON.stringify({
        external_investments: snapshot.external_investments,
        branches: snapshot.branches,
        annual_reports: snapshot.annual_reports,
        change_records: snapshot.change_records,
      }),
    ],
  ).catch((err) => {
    console.error("[manager-gsxt] persist", err)
  })
}

export async function loadManagerGsxt(input: {
  registrationNo: string
  managerName: string
}): Promise<GsxtSnapshot> {
  const registrationNo = input.registrationNo.trim()
  const managerName = input.managerName.trim()
  if (!registrationNo || !managerName) return emptySnapshot("empty")

  await ensureGsxtSchema().catch(() => {
    /* table may already exist */
  })

  const cached = await loadCached(registrationNo)
  if (cached) return cached

  const attempts = [tryGsxt, tryCods, tryCreditChina, tryShanghaiCredit]
  let fallback: GsxtSnapshot = emptySnapshot("empty")
  for (const attempt of attempts) {
    try {
      const result = await attempt(managerName)
      if (!result) continue
      if (result.status === "ok") {
        await persistSnapshot(registrationNo, managerName, result)
        return result
      }
      if (result.status === "captcha" && fallback.status !== "captcha") {
        fallback = result
      }
    } catch (err) {
      console.error("[manager-gsxt] attempt", err)
    }
  }

  if (fallback.status === "empty") fallback = emptySnapshot("empty", "gsxt.gov.cn")
  await persistSnapshot(registrationNo, managerName, fallback)
  return fallback
}
