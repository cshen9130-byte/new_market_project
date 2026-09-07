import { query } from "@/lib/db"
import { getServerDueDiligenceTable } from "@/lib/server/due-diligence-table"
import { extractManagerBrand } from "@/lib/server/fund-company-query"
import {
  extractLabeledBlocks,
  fetchWebsiteProfileBlocks,
  htmlToText,
  parseAmacWebsiteUrl,
  type ManagerProfileBlocks,
} from "@/lib/server/manager-website-extract"

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const AMAC_FETCH_TIMEOUT_MS = 10_000
const AMAC_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"

export type ManagerProfileTexts = ManagerProfileBlocks & {
  website_url: string | null
}

type CacheRow = {
  website_url: string | null
  company_intro: string | null
  investment_philosophy: string | null
  investment_strategy: string | null
  fetched_at: string | Date
}

let schemaPromise: Promise<void> | null = null

function emptyBlocks(): ManagerProfileBlocks {
  return { company_intro: null, investment_philosophy: null, investment_strategy: null }
}

const DD_TIMEOUT_MS = 4_000

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

function isUsableProfileText(text: string | null, key: keyof ManagerProfileBlocks): boolean {
  const t = (text ?? "").trim()
  if (!t) return false
  if (t.length < (key === "company_intro" ? 40 : 24)) return false
  if (/^[，。、；：]/.test(t)) return false
  if (/元宝会议助手|会议助手\(\d+|内部文件严禁转发|问\d+：/.test(t)) return false
  if ((t.match(/呃/g) ?? []).length >= 2) return false
  if (/咱们方便|好呀好呀|对对对/.test(t)) return false
  return true
}

function cleanBlocks(blocks: ManagerProfileBlocks): ManagerProfileBlocks {
  return {
    company_intro: isUsableProfileText(blocks.company_intro, "company_intro")
      ? blocks.company_intro
      : null,
    investment_philosophy: isUsableProfileText(blocks.investment_philosophy, "investment_philosophy")
      ? blocks.investment_philosophy
      : null,
    investment_strategy: isUsableProfileText(blocks.investment_strategy, "investment_strategy")
      ? blocks.investment_strategy
      : null,
  }
}

function hasAnyBlock(blocks: ManagerProfileBlocks): boolean {
  return Boolean(blocks.company_intro || blocks.investment_philosophy || blocks.investment_strategy)
}

function mergeBlocks(
  primary: ManagerProfileBlocks,
  fallback: ManagerProfileBlocks,
): ManagerProfileBlocks {
  return {
    company_intro: primary.company_intro || fallback.company_intro,
    investment_philosophy: primary.investment_philosophy || fallback.investment_philosophy,
    investment_strategy: primary.investment_strategy || fallback.investment_strategy,
  }
}

function cacheIsFresh(fetchedAt: string | Date, websiteUrl: string | null, currentUrl: string | null): boolean {
  const ts = typeof fetchedAt === "string" ? Date.parse(fetchedAt) : fetchedAt.getTime()
  if (!Number.isFinite(ts) || Date.now() - ts > CACHE_TTL_MS) return false
  const cached = (websiteUrl ?? "").trim()
  const current = (currentUrl ?? "").trim()
  if (current && cached && cached !== current) return false
  return true
}

async function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await query(`ALTER TABLE amac_manager_details ADD COLUMN IF NOT EXISTS website_url TEXT`).catch(() => {
        /* ETL user may own the table; on-demand AMAC parse still works. */
      })
      await query(`
        CREATE TABLE IF NOT EXISTS manager_profile_texts (
          registration_no                 TEXT PRIMARY KEY,
          manager_name                    TEXT,
          website_url                     TEXT,
          company_intro                   TEXT,
          investment_philosophy           TEXT,
          investment_strategy             TEXT,
          company_intro_source            TEXT,
          investment_philosophy_source    TEXT,
          investment_strategy_source      TEXT,
          fetched_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          website_fetched_at              TIMESTAMPTZ,
          updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)
    })().catch((err) => {
      schemaPromise = null
      throw err
    })
  }
  await schemaPromise
}

async function readCache(registrationNo: string): Promise<CacheRow | null> {
  const rows = await query<CacheRow>(
    `SELECT website_url, company_intro, investment_philosophy, investment_strategy, fetched_at
     FROM manager_profile_texts
     WHERE UPPER(registration_no) = UPPER($1)
     LIMIT 1`,
    [registrationNo],
  )
  return rows[0] ?? null
}

async function writeCache(input: {
  registrationNo: string
  managerName: string
  websiteUrl: string | null
  website: ManagerProfileBlocks
  merged: ManagerProfileBlocks
}): Promise<void> {
  const sourceOf = (key: keyof ManagerProfileBlocks) => {
    if (input.website[key]) return "website"
    if (input.merged[key]) return "dd_materials"
    return null
  }
  await query(
    `INSERT INTO manager_profile_texts (
       registration_no, manager_name, website_url,
       company_intro, investment_philosophy, investment_strategy,
       company_intro_source, investment_philosophy_source, investment_strategy_source,
       fetched_at, website_fetched_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW(),NOW())
     ON CONFLICT (registration_no) DO UPDATE SET
       manager_name = EXCLUDED.manager_name,
       website_url = EXCLUDED.website_url,
       company_intro = EXCLUDED.company_intro,
       investment_philosophy = EXCLUDED.investment_philosophy,
       investment_strategy = EXCLUDED.investment_strategy,
       company_intro_source = EXCLUDED.company_intro_source,
       investment_philosophy_source = EXCLUDED.investment_philosophy_source,
       investment_strategy_source = EXCLUDED.investment_strategy_source,
       fetched_at = NOW(),
       website_fetched_at = NOW(),
       updated_at = NOW()`,
    [
      input.registrationNo,
      input.managerName,
      input.websiteUrl,
      input.merged.company_intro,
      input.merged.investment_philosophy,
      input.merged.investment_strategy,
      sourceOf("company_intro"),
      sourceOf("investment_philosophy"),
      sourceOf("investment_strategy"),
    ],
  )
}

async function lookupStoredWebsite(registrationNo: string): Promise<{
  websiteUrl: string | null
  detailUrl: string | null
}> {
  try {
    const rows = await query<{ website_url: string | null; detail_url: string | null }>(
      `SELECT
         NULLIF(BTRIM(to_jsonb(d)->>'website_url'), '') AS website_url,
         NULLIF(BTRIM(COALESCE(d.detail_url, m.detail_url)), '') AS detail_url
       FROM amac_managers m
       LEFT JOIN amac_manager_details d ON d.registration_no = m.registration_no
       WHERE UPPER(m.registration_no) = UPPER($1)
       LIMIT 1`,
      [registrationNo],
    )
    return {
      websiteUrl: rows[0]?.website_url?.trim() || null,
      detailUrl: rows[0]?.detail_url?.trim() || null,
    }
  } catch {
    return { websiteUrl: null, detailUrl: null }
  }
}

async function persistWebsiteUrl(registrationNo: string, websiteUrl: string): Promise<void> {
  await query(
    `UPDATE amac_manager_details SET website_url = $2, updated_at = NOW()
     WHERE UPPER(registration_no) = UPPER($1)`,
    [registrationNo, websiteUrl],
  ).catch(() => {
    /* column or permission may be missing until ETL runs */
  })
}

function resolveAmacDetailUrl(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  if (/^https?:\/\//i.test(text)) return text
  const file = text.split("/").pop() || text
  if (!file.endsWith(".html")) return null
  return `https://gs.amac.org.cn/amac-infodisc/res/pof/manager/${file}`
}

async function fetchAmacWebsiteUrl(detailUrl: string): Promise<string | null> {
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
    const html = await res.text()
    return parseAmacWebsiteUrl(html)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function managerNameHints(managerName: string): string[] {
  const name = managerName.trim()
  const brand = extractManagerBrand(name)
  const hints = new Set<string>()
  if (name) hints.add(name)
  if (brand && brand.length >= 2) hints.add(brand)
  const short = name.replace(/私募基金管理有限公司|基金管理有限公司|资产管理有限公司|投资管理有限公司|有限公司$/g, "")
  if (short.length >= 4) hints.add(short)
  return [...hints]
}

function namesMatch(haystack: string, hints: string[]): boolean {
  const text = haystack.replace(/\s+/g, "")
  return hints.some((hint) => hint && text.includes(hint.replace(/\s+/g, "")))
}

function blocksFromDocuments(docs: Array<{ source: string; content: string }>): ManagerProfileBlocks {
  let merged = emptyBlocks()
  const ranked = [...docs].sort((a, b) => {
    const score = (source: string) => {
      if (/公司简介|公司介绍|管理人简介/.test(source)) return 0
      if (/投资理念/.test(source)) return 1
      if (/投资策略|策略介绍/.test(source)) return 2
      return 3
    }
    return score(a.source) - score(b.source)
  })
  for (const doc of ranked) {
    const labeled = cleanBlocks(extractLabeledBlocks(htmlToText(doc.content)))
    if (/公司简介|公司介绍|管理人简介/.test(doc.source) && !labeled.company_intro) {
      const clipped = doc.content.replace(/\s+/g, " ").trim().slice(0, 900)
      if (isUsableProfileText(clipped, "company_intro")) labeled.company_intro = clipped
    }
    merged = mergeBlocks(merged, labeled)
    if (SECTION_COMPLETE(merged)) break
  }
  return cleanBlocks(merged)
}

function SECTION_COMPLETE(blocks: ManagerProfileBlocks): boolean {
  return Boolean(blocks.company_intro && blocks.investment_philosophy && blocks.investment_strategy)
}

async function loadDdMaterialBlocks(managerName: string): Promise<ManagerProfileBlocks> {
  const hints = managerNameHints(managerName)
  if (hints.length === 0) return emptyBlocks()

  const fromTable = await loadDdBlocksFromTable(hints)
  if (hasAnyBlock(fromTable) && SECTION_COMPLETE(fromTable)) return fromTable

  const fromKb = await loadDdBlocksFromKb(hints)
  return mergeBlocks(fromTable, fromKb)
}

async function loadDdBlocksFromTable(hints: string[]): Promise<ManagerProfileBlocks> {
  try {
    const snapshot = await getServerDueDiligenceTable()
    const paths = snapshot.rows
      .filter((row) => namesMatch(`${row.fundCompany} ${row.ddMaterialsKbPath ?? ""}`, hints))
      .map((row) => row.ddMaterialsKbPath?.trim())
      .filter((path): path is string => Boolean(path))
      .slice(0, 4)
    if (paths.length === 0) return emptyBlocks()

    const docs: Array<{ source: string; content: string }> = []
    for (const path of paths) {
      const escaped = path.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")
      const rows = await query<{ content: string; source: string }>(
        `SELECT content, source FROM kb_chunks
         WHERE source = $1 OR source LIKE $2 ESCAPE '\\'
         LIMIT 40`,
        [path, `${escaped}/%`],
      )
      docs.push(...rows)
    }
    return blocksFromDocuments(docs.slice(0, 40))
  } catch {
    return emptyBlocks()
  }
}

async function loadDdBlocksFromKb(hints: string[]): Promise<ManagerProfileBlocks> {
  try {
    const likeParams = hints.slice(0, 3).map((h) => `%${h}%`)
    while (likeParams.length < 3) likeParams.push(likeParams[0] ?? "%")
    const rows = await query<{ content: string; source: string }>(
      `SELECT content, source
       FROM kb_chunks
       WHERE (source ILIKE $1 OR source ILIKE $2 OR source ILIKE $3)
         AND source ~ '公司简介|公司介绍|投资理念|投资策略|管理人简介|策略介绍|公司介绍'
       ORDER BY
         CASE
           WHEN source ~ '公司简介|公司介绍' THEN 0
           WHEN source ~ '投资理念' THEN 1
           WHEN source ~ '投资策略|策略介绍' THEN 2
           ELSE 3
         END
       LIMIT 20`,
      likeParams,
    )
    return blocksFromDocuments(rows)
  } catch {
    return emptyBlocks()
  }
}

export async function loadManagerProfileTexts(input: {
  registrationNo: string
  managerName: string
}): Promise<ManagerProfileTexts> {
  const registrationNo = input.registrationNo.trim()
  const managerName = input.managerName.trim()

  try {
    await ensureSchema()
  } catch (err) {
    console.error("[manager-profile-texts] schema", err)
  }

  let storedWebsite: string | null = null
  let detailUrl: string | null = null
  try {
    const stored = await lookupStoredWebsite(registrationNo)
    storedWebsite = stored.websiteUrl
    detailUrl = stored.detailUrl
  } catch (err) {
    console.error("[manager-profile-texts] lookup website", err)
  }

  try {
    const cached = await readCache(registrationNo)
    if (cached && cacheIsFresh(cached.fetched_at, cached.website_url, storedWebsite)) {
      return {
        website_url: cached.website_url,
        company_intro: cached.company_intro,
        investment_philosophy: cached.investment_philosophy,
        investment_strategy: cached.investment_strategy,
      }
    }
  } catch (err) {
    console.error("[manager-profile-texts] cache read", err)
  }

  const ddPromise = withTimeout(loadDdMaterialBlocks(managerName), DD_TIMEOUT_MS, emptyBlocks()).catch(
    (err) => {
      console.error("[manager-profile-texts] dd fallback", err)
      return emptyBlocks()
    },
  )

  let websiteUrl = storedWebsite
  if (!websiteUrl && detailUrl) {
    websiteUrl = await fetchAmacWebsiteUrl(detailUrl)
    if (websiteUrl) {
      await persistWebsiteUrl(registrationNo, websiteUrl)
    }
  }

  let websiteBlocks = emptyBlocks()
  if (websiteUrl) {
    try {
      websiteBlocks = await fetchWebsiteProfileBlocks(websiteUrl)
    } catch (err) {
      console.error("[manager-profile-texts] website fetch", err)
    }
  }

  const ddBlocks = SECTION_COMPLETE(websiteBlocks) ? emptyBlocks() : await ddPromise

  const merged = cleanBlocks(mergeBlocks(cleanBlocks(websiteBlocks), ddBlocks))
  try {
    await writeCache({
      registrationNo,
      managerName,
      websiteUrl,
      website: websiteBlocks,
      merged,
    })
  } catch (err) {
    console.error("[manager-profile-texts] cache write", err)
  }

  return { ...merged, website_url: websiteUrl }
}
