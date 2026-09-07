import { query } from "@/lib/db"

const AMAC_FETCH_TIMEOUT_MS = 12_000
const AMAC_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"

export type AmacShareholderRow = {
  name: string
  shareholder_type: string
  holding_ratio: string
  subscribed_amount: string
}

type DbShareholder = {
  investor_name: string
  shareholder_type: string | null
  holding_ratio: string | null
  subscribed_amount: string | null
}

let schemaPromise: Promise<void> | null = null

export async function ensureShareholderSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = query(`
      CREATE TABLE IF NOT EXISTS amac_manager_shareholders (
        id                      SERIAL PRIMARY KEY,
        registration_no         TEXT NOT NULL,
        manager_name            TEXT,
        seq                     INTEGER,
        investor_name           TEXT NOT NULL,
        holding_ratio           TEXT,
        shareholder_type        TEXT,
        subscribed_amount       TEXT,
        source_file             TEXT NOT NULL DEFAULT 'amac_api',
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT amac_manager_shareholders_uq UNIQUE (registration_no, investor_name)
      )
    `)
      .then(() =>
        query(
          `CREATE INDEX IF NOT EXISTS idx_amac_manager_shareholders_registration_no
           ON amac_manager_shareholders (registration_no)`,
        ),
      )
      .then(() => undefined)
      .catch((err) => {
        schemaPromise = null
        throw err
      })
  }
  await schemaPromise
}

export function inferShareholderType(name: string): string {
  if (name.includes("合伙")) return "合伙企业"
  if (/公司|企业|基金|信托|银行|证券|集团|有限|公社|合作社|研究所|中心|事务所/.test(name)) {
    return "法人股东"
  }
  return "自然人股东"
}

export function formatSubscribedAmount(capitalWan: string | null | undefined, ratioText: string): string {
  const cap = Number.parseFloat((capitalWan ?? "").replace(/[^\d.]/g, ""))
  const ratio = Number.parseFloat(ratioText.replace(/[^\d.]/g, ""))
  if (!Number.isFinite(cap) || !Number.isFinite(ratio) || cap <= 0 || ratio <= 0) return ""
  const amount = (cap * ratio) / 100
  const text = amount.toFixed(4).replace(/\.?0+$/, "")
  return `${text}万元人民币`
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function extractSectionHtml(html: string, title: string): string {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = html.match(
    new RegExp(
      `<div class="common-tit">\\s*<span>${escaped}</span>\\s*</div>([\\s\\S]*?)(?=<div class="section">|<div class="common-tit">|$)`,
    ),
  )
  return match?.[1] ?? ""
}

export function parseAmacShareholders(
  html: string,
  registeredCapitalWan?: string | null,
): AmacShareholderRow[] {
  const section = extractSectionHtml(html, "出资人信息")
  if (!section) return []
  const table = section.match(/<table class="list-table[^"]*">[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/)
  if (!table?.[1]) return []

  const rows: AmacShareholderRow[] = []
  const seen = new Set<string>()
  for (const tr of table[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]))
    if (cells.length < 3) continue
    const seq = cells[0]
    const name = cells[1]
    const ratio = cells[2]
    if (!name || ["姓名/名称", "暂无", "暂无数据", "-", "--"].includes(name)) continue
    if (seq && !/\d/.test(seq)) continue
    if (seen.has(name)) continue
    seen.add(name)
    rows.push({
      name,
      shareholder_type: inferShareholderType(name),
      holding_ratio: ratio,
      subscribed_amount: formatSubscribedAmount(registeredCapitalWan, ratio),
    })
  }
  return rows
}

export function resolveAmacDetailUrl(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim()
  if (!text) return null
  if (/^https?:\/\//i.test(text)) return text
  const file = text.split("/").pop() || text
  if (!file.endsWith(".html")) return null
  return `https://gs.amac.org.cn/amac-infodisc/res/pof/manager/${file}`
}

export async function fetchAmacManagerHtml(detailUrl: string): Promise<string | null> {
  const url = resolveAmacDetailUrl(detailUrl)
  if (!url) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AMAC_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": AMAC_UA,
        Referer: "https://gs.amac.org.cn/amac-infodisc/res/pof/manager/managerList.html",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function loadStoredShareholders(registrationNo: string): Promise<AmacShareholderRow[]> {
  try {
    const rows = await query<DbShareholder>(
      `SELECT investor_name, shareholder_type, holding_ratio, subscribed_amount
       FROM amac_manager_shareholders
       WHERE UPPER(registration_no) = UPPER($1)
       ORDER BY seq NULLS LAST, id`,
      [registrationNo],
    )
    return rows
      .map((row) => ({
        name: row.investor_name.trim(),
        shareholder_type: (row.shareholder_type ?? "").trim() || inferShareholderType(row.investor_name),
        holding_ratio: (row.holding_ratio ?? "").trim(),
        subscribed_amount: (row.subscribed_amount ?? "").trim(),
      }))
      .filter((row) => row.name)
  } catch {
    return []
  }
}

async function persistShareholders(
  registrationNo: string,
  managerName: string,
  rows: AmacShareholderRow[],
): Promise<void> {
  for (const [idx, row] of rows.entries()) {
    await query(
      `INSERT INTO amac_manager_shareholders (
         registration_no, manager_name, seq, investor_name, holding_ratio,
         shareholder_type, subscribed_amount, source_file
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'amac_api')
       ON CONFLICT (registration_no, investor_name) DO UPDATE SET
         manager_name = EXCLUDED.manager_name,
         seq = EXCLUDED.seq,
         holding_ratio = EXCLUDED.holding_ratio,
         shareholder_type = EXCLUDED.shareholder_type,
         subscribed_amount = EXCLUDED.subscribed_amount,
         source_file = EXCLUDED.source_file,
         updated_at = NOW()`,
      [
        registrationNo,
        managerName,
        idx + 1,
        row.name,
        row.holding_ratio,
        row.shareholder_type,
        row.subscribed_amount,
      ],
    )
  }
}

async function lookupDetailUrl(registrationNo: string): Promise<string | null> {
  try {
    const rows = await query<{ detail_url: string | null }>(
      `SELECT NULLIF(BTRIM(COALESCE(d.detail_url, m.detail_url)), '') AS detail_url
       FROM amac_managers m
       LEFT JOIN amac_manager_details d ON d.registration_no = m.registration_no
       WHERE UPPER(m.registration_no) = UPPER($1)
       LIMIT 1`,
      [registrationNo],
    )
    return rows[0]?.detail_url?.trim() || null
  } catch {
    return null
  }
}

export async function loadAmacShareholders(input: {
  registrationNo: string
  managerName: string
  registeredCapitalWan?: string | null
}): Promise<AmacShareholderRow[]> {
  const registrationNo = input.registrationNo.trim()
  if (!registrationNo) return []

  await ensureShareholderSchema().catch(() => {
    /* table may already exist under a different owner */
  })

  const stored = await loadStoredShareholders(registrationNo)
  if (stored.length > 0) return stored

  const detailUrl = await lookupDetailUrl(registrationNo)
  if (!detailUrl) return []

  const html = await fetchAmacManagerHtml(detailUrl)
  if (!html) return []

  const parsed = parseAmacShareholders(html, input.registeredCapitalWan)
  if (parsed.length > 0) {
    await persistShareholders(registrationNo, input.managerName, parsed).catch((err) => {
      console.error("[amac-manager-shareholders] persist", err)
    })
  }
  return parsed
}
