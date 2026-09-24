import { isHiddenTeamPoolKey } from "@/lib/client/tracking-pools"
import { query } from "@/lib/db"
import {
  canUseMcpArea,
  mcpAccountArea,
  mcpAreaDeniedMessage,
  type McpAccount,
} from "@/lib/server/mcp-account-access"

const PAGE_CAP = 50
const KB_LIST_CAP = 400
const KB_TEXT_CAP = 24_000
const REPORT_CAP = 80_000

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (value == null) return ""
  return String(value).trim()
}

function intArg(args: Record<string, unknown>, key: string, fallback: number, max: number): number {
  const n = Number(args[key])
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(max, Math.floor(n))
}

function tagsFromArg(raw: string): string[] {
  return raw.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
}

function accountHeaders(account: McpAccount): Headers {
  const headers = new Headers()
  headers.set("x-market-user-id", account.id)
  if (account.name) headers.set("x-market-user-name", encodeURIComponent(account.name))
  return headers
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : ""
    const error = typeof data?.error === "string" ? data.error : ""
    const message = detail || error || (typeof data?.msg === "string" ? data.msg : "") || res.statusText
    throw new Error(message || `请求失败 (${res.status})`)
  }
  return data ?? {}
}

async function loadStrategyTags(beianHaos: string[]): Promise<Map<string, string[]>> {
  const codes = [...new Set(beianHaos.map((s) => s.trim()).filter(Boolean))]
  const out = new Map<string, string[]>()
  if (codes.length === 0) return out
  const push = (beian: string, tag: string) => {
    const name = tag.trim()
    if (!beian || !name) return
    const list = out.get(beian) ?? []
    if (!list.includes(name)) list.push(name)
    out.set(beian, list)
  }
  try {
    const rows = await query<{ beian_hao: string; tag_name: string }>(
      `SELECT beian_hao, tag_name
       FROM ops_fund_tags
       WHERE beian_hao = ANY($1::text[])
       ORDER BY created_at ASC`,
      [codes],
    )
    for (const row of rows) push(row.beian_hao, row.tag_name)
  } catch {
    /* table may not exist yet */
  }
  try {
    const rows = await query<{ beian_hao: string; tag_name: string }>(
      `SELECT beian_hao, BTRIM(tag) AS tag_name
       FROM ops_tracking_funds_list_cache,
            LATERAL jsonb_array_elements_text(COALESCE(team_tags, '[]'::jsonb)) AS tag
       WHERE beian_hao = ANY($1::text[]) AND BTRIM(tag) <> ''`,
      [codes],
    )
    for (const row of rows) push(row.beian_hao, row.tag_name)
  } catch {
    /* cache table optional */
  }
  try {
    const rows = await query<{ beian_hao: string; tag_name: string }>(
      `SELECT beian_hao, BTRIM(tag) AS tag_name
       FROM ops_managed_products_list_cache,
            LATERAL jsonb_array_elements_text(COALESCE(team_tags, '[]'::jsonb)) AS tag
       WHERE beian_hao = ANY($1::text[]) AND BTRIM(tag) <> ''`,
      [codes],
    )
    for (const row of rows) push(row.beian_hao, row.tag_name)
  } catch {
    /* managed cache optional */
  }
  return out
}

async function loadPersonalTags(userId: string, beianHaos: string[]): Promise<Map<string, string[]>> {
  const codes = [...new Set(beianHaos.map((s) => s.trim()).filter(Boolean))]
  const out = new Map<string, string[]>()
  if (!userId || codes.length === 0) return out
  try {
    const rows = await query<{ beian_hao: string; tag_name: string }>(
      `SELECT beian_hao, tag_name
       FROM ops_personal_fund_tags
       WHERE user_key = $1 AND beian_hao = ANY($2::text[])
       ORDER BY created_at ASC`,
      [userId, codes],
    )
    for (const row of rows) {
      const list = out.get(row.beian_hao) ?? []
      list.push(row.tag_name)
      out.set(row.beian_hao, list)
    }
  } catch {
    /* table may not exist yet */
  }
  return out
}

function withTags<T extends { beian_hao?: string | null }>(
  rows: T[],
  strategy: Map<string, string[]>,
  personal: Map<string, string[]>,
): Array<T & { strategy_tags: string[]; personal_tags: string[] }> {
  return rows.map((row) => {
    const beian = String(row.beian_hao ?? "")
    return {
      ...row,
      strategy_tags: strategy.get(beian) ?? [],
      personal_tags: personal.get(beian) ?? [],
    }
  })
}

function appendRepeated(url: URL, key: string, values: string[]) {
  for (const value of values) url.searchParams.append(key, value)
}

async function trackingList(account: McpAccount, args: Record<string, unknown>) {
  const pool = str(args, "pool") || "all"
  if (isHiddenTeamPoolKey(pool)) throw new Error("该产品池不可访问")
  const page = intArg(args, "page", 1, 500)
  const pageSize = intArg(args, "page_size", 20, PAGE_CAP)
  const url = new URL("http://mcp.local/ma/api/tracking-funds/list")
  url.searchParams.set("pool", pool)
  url.searchParams.set("page", String(page))
  url.searchParams.set("pageSize", String(pageSize))
  const keyword = str(args, "keyword")
  if (keyword) url.searchParams.set("keyword", keyword)
  const strategySource = str(args, "strategy_source")
  if (strategySource) url.searchParams.set("strategy_source", strategySource)
  for (const key of ["strategy_l1", "strategy_l2", "strategy_l3"] as const) {
    const value = str(args, key)
    if (value) url.searchParams.set(key, value)
  }
  const teamTags = tagsFromArg(str(args, "team_tag"))
  appendRepeated(url, "team_tag", teamTags)
  const tagMode = str(args, "team_tag_mode")
  if (tagMode) url.searchParams.set("team_tag_mode", tagMode)

  const { GET } = await import("@/app/ma/api/tracking-funds/list/route")
  const body = await readJson(await GET(new Request(url, { headers: accountHeaders(account) })))
  const rows = Array.isArray(body.data) ? body.data as Array<{ beian_hao?: string | null }> : []
  const beians = rows.map((row) => String(row.beian_hao ?? ""))
  const [strategy, personal] = await Promise.all([
    loadStrategyTags(beians),
    loadPersonalTags(account.id, beians),
  ])
  return {
    pool,
    page: body.page ?? page,
    pageSize: body.pageSize ?? pageSize,
    total: body.total ?? rows.length,
    totalPages: body.totalPages ?? 1,
    data: withTags(rows, strategy, personal),
  }
}

async function trackingDetail(account: McpAccount, args: Record<string, unknown>) {
  const regCode = str(args, "reg_code")
  const name = str(args, "name")
  const keyword = regCode || name
  if (!keyword) throw new Error("请提供 reg_code 或 name")
  let exact: (typeof listedRows)[number] | undefined
  let listedRows: Awaited<ReturnType<typeof trackingList>>["data"] = []
  for (let page = 1; page <= 5; page++) {
    const listed = await trackingList(account, {
      pool: str(args, "pool") || "all",
      keyword,
      page,
      page_size: PAGE_CAP,
    })
    listedRows = listed.data
    exact = regCode
      ? listedRows.find((row) => String(row.beian_hao ?? "").toUpperCase() === regCode.toUpperCase())
      : listedRows[0]
    if (exact || listedRows.length < PAGE_CAP) break
  }
  if (!exact) throw new Error(`跟踪池中未找到「${keyword}」`)
  const beian = String(exact.beian_hao ?? "")
  const [teamNote, personalNote] = await Promise.all([
    query<{ note: string; updated_by: string; updated_at: string }>(
      `SELECT note, updated_by, updated_at::text
       FROM ops_fund_notes
       WHERE beian_hao = $1 AND note <> ''`,
      [beian],
    ).catch(() => []),
    query<{ note: string; updated_at: string }>(
      `SELECT note, updated_at::text
       FROM ops_personal_fund_notes
       WHERE beian_hao = $1 AND user_key = $2 AND note <> ''`,
      [beian, account.id],
    ).catch(() => []),
  ])
  return {
    ...exact,
    team_note: teamNote[0]?.note ?? "",
    team_note_updated_by: teamNote[0]?.updated_by ?? "",
    personal_note: personalNote[0]?.note ?? "",
  }
}

async function trackingPools(account: McpAccount) {
  const { GET } = await import("@/app/ma/api/tracking-funds/pools/route")
  const url = new URL("http://mcp.local/ma/api/tracking-funds/pools?scope=both")
  const body = await readJson(await GET(new Request(url, { headers: accountHeaders(account) })))
  const data = body.data as { team?: unknown; mine?: unknown } | undefined
  const slim = (rows: unknown) => {
    if (!Array.isArray(rows)) return []
    return rows
      .map((row) => {
        const item = row as { pool_key?: string; label?: string }
        return { pool_key: item.pool_key ?? "", label: item.label ?? "" }
      })
      .filter((row) => row.pool_key && !isHiddenTeamPoolKey(row.pool_key))
  }
  return {
    all: { pool_key: "all", label: "全部" },
    team: slim(data?.team),
    mine: slim(data?.mine),
  }
}

async function managedProducts(account: McpAccount, args: Record<string, unknown>) {
  const page = intArg(args, "page", 1, 500)
  const pageSize = intArg(args, "page_size", 20, PAGE_CAP)
  const url = new URL("http://mcp.local/ma/api/ops/managed-products/list")
  url.searchParams.set("page", String(page))
  url.searchParams.set("pageSize", String(pageSize))
  const keyword = str(args, "keyword")
  if (keyword) url.searchParams.set("keyword", keyword)
  const strategySource = str(args, "strategy_source")
  if (strategySource) url.searchParams.set("strategy_source", strategySource)
  for (const key of ["strategy_l1", "strategy_l2", "strategy_l3"] as const) {
    const value = str(args, key)
    if (value) url.searchParams.set(key, value)
  }
  appendRepeated(url, "team_tag", tagsFromArg(str(args, "team_tag")))
  const tagMode = str(args, "team_tag_mode")
  if (tagMode) url.searchParams.set("team_tag_mode", tagMode)
  const runStatus = str(args, "run_status")
  if (runStatus) url.searchParams.set("run_status", runStatus)

  const { GET } = await import("@/app/ma/api/ops/managed-products/list/route")
  const body = await readJson(await GET(new Request(url, { headers: accountHeaders(account) })))
  const rows = Array.isArray(body.data) ? body.data as Array<{ beian_hao?: string | null }> : []
  const beians = rows.map((row) => String(row.beian_hao ?? ""))
  const strategy = await loadStrategyTags(beians)
  return {
    page: body.page ?? page,
    pageSize: body.pageSize ?? pageSize,
    total: body.total ?? rows.length,
    totalPages: body.totalPages ?? 1,
    totalNetAssetValue: body.totalNetAssetValue ?? null,
    data: rows.map((row) => ({
      ...row,
      strategy_tags: strategy.get(String(row.beian_hao ?? "")) ?? [],
    })),
  }
}

async function collectResearcher(res: Response): Promise<Record<string, unknown>> {
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(data?.error || `分析失败 (${res.status})`)
  }
  const text = await res.text()
  let plan = ""
  let report = ""
  const steps: Array<{ step: number; summary: string }> = []
  let matches: unknown = undefined
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue
    let event: Record<string, unknown>
    try {
      event = JSON.parse(line.slice(6)) as Record<string, unknown>
    } catch {
      continue
    }
    if (event.type === "plan_text") plan += String(event.content ?? "")
    if (event.type === "report_text") report += String(event.delta ?? "")
    if (event.type === "step_done") {
      steps.push({ step: Number(event.step) || steps.length + 1, summary: String(event.summary ?? "") })
    }
    if (event.type === "matches") matches = event.items
    if (event.type === "error") throw new Error(String(event.message || "分析失败"))
  }
  if (report.length > REPORT_CAP) {
    report = `${report.slice(0, REPORT_CAP)}\n\n[报告过长，已截断]`
  }
  return { plan, steps, report, ...(matches !== undefined ? { matches } : {}) }
}

async function postResearcher(
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const loaders = {
    "compare-analysis": () => import("@/app/ma/api/ai-researcher/compare-analysis/route"),
    "similar-fund": () => import("@/app/ma/api/ai-researcher/similar-fund/route"),
    "opposite-fund": () => import("@/app/ma/api/ai-researcher/opposite-fund/route"),
    "roadshow-analysis": () => import("@/app/ma/api/ai-researcher/roadshow-analysis/route"),
    "team-background": () => import("@/app/ma/api/ai-researcher/team-background/route"),
    "manager-profile": () => import("@/app/ma/api/ai-researcher/manager-profile/route"),
  } as const
  const load = loaders[path as keyof typeof loaders]
  if (!load) throw new Error(`unknown researcher route: ${path}`)
  const mod = await load()
  const res = await mod.POST(new Request(`http://mcp.local/ma/api/ai-researcher/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }))
  return collectResearcher(res)
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  const text = String(value ?? "").trim()
  if (!text) return []
  return text.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
}

type KbFolder = {
  name: string
  relativePath: string
  folders?: KbFolder[]
  documents?: Array<{ name: string; relativePath: string; size?: number }>
}

function pushKbNode(node: KbFolder, out: Array<Record<string, unknown>>, limit: number, includeSelf: boolean) {
  if (includeSelf && node.relativePath && out.length < limit) {
    out.push({ type: "folder", path: node.relativePath, name: node.name })
  }
  for (const doc of node.documents ?? []) {
    if (out.length >= limit) return
    out.push({ type: "file", path: doc.relativePath, name: doc.name, size: doc.size ?? 0 })
  }
  for (const folder of node.folders ?? []) {
    if (out.length >= limit) return
    pushKbNode(folder, out, limit, true)
  }
}

function findKbFolder(node: KbFolder, path: string): KbFolder | null {
  if (node.relativePath === path) return node
  for (const folder of node.folders ?? []) {
    const hit = findKbFolder(folder, path)
    if (hit) return hit
  }
  return null
}

async function kbList(account: McpAccount, args: Record<string, unknown>) {
  const { listKnowledgeBaseTree, normalizeKnowledgeBasePath } = await import("@/lib/server/knowledge-base")
  const path = normalizeKnowledgeBasePath(str(args, "path"))
  const limit = intArg(args, "limit", 200, KB_LIST_CAP)
  const tree = await listKnowledgeBaseTree(account.id, account.role === "admin") as KbFolder
  const root = path ? findKbFolder(tree, path) : tree
  if (!root) throw new Error(`知识库中没有文件夹「${path}」`)
  const entries: Array<Record<string, unknown>> = []
  pushKbNode(root, entries, limit, false)
  return { path, truncated: entries.length >= limit, entries }
}

async function kbRead(args: Record<string, unknown>) {
  const path = str(args, "path")
  if (!path) throw new Error("请提供 path")
  const { getKnowledgeBaseFile, readFileDocumentText } = await import("@/lib/server/knowledge-base")
  const file = await getKnowledgeBaseFile(path)
  const text = await readFileDocumentText(file.absolutePath, file.extension)
  const truncated = text.length > KB_TEXT_CAP
  return {
    path: file.relativePath,
    name: file.name,
    truncated,
    text: truncated ? `${text.slice(0, KB_TEXT_CAP)}\n\n[内容过长，已截断]` : text,
  }
}

async function kbAsk(args: Record<string, unknown>) {
  const question = str(args, "question")
  if (!question) throw new Error("请提供 question")
  const { askKnowledgeBaseQuestion } = await import("@/lib/server/knowledge-chat")
  const result = await askKnowledgeBaseQuestion({
    question,
    folderPath: str(args, "folder_path") || null,
    filePath: str(args, "file_path") || null,
  })
  return {
    answer: result.answer,
    sources: result.sources,
    model: result.model,
  }
}

export async function callAccountMcpTool(
  account: McpAccount | null | undefined,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const area = mcpAccountArea(name)
  if (!area) throw new Error(`unknown tool: ${name}`)
  if (!account || !canUseMcpArea(account, area)) {
    throw new Error(mcpAreaDeniedMessage(area))
  }

  switch (name) {
    case "tracking_pools":
      return trackingPools(account)
    case "tracking_pool_list":
      return trackingList(account, args)
    case "tracking_pool_detail":
      return trackingDetail(account, args)
    case "managed_products_list":
      return managedProducts(account, args)
    case "ai_researcher_compare": {
      const subjects = stringList(args.subjects)
      if (subjects.length === 0) throw new Error("请提供 subjects")
      return postResearcher("compare-analysis", { subjects, kbPath: str(args, "kb_path") })
    }
    case "ai_researcher_similar": {
      const subject = str(args, "subject") || str(args, "reg_code")
      if (!subject) throw new Error("请提供 subject 或 reg_code")
      return postResearcher("similar-fund", {
        subject,
        beianHao: str(args, "reg_code"),
        namedFund: true,
        kbPath: str(args, "kb_path"),
        fileNote: str(args, "file_note"),
      })
    }
    case "ai_researcher_opposite": {
      const subject = str(args, "subject") || str(args, "reg_code")
      if (!subject) throw new Error("请提供 subject 或 reg_code")
      return postResearcher("opposite-fund", {
        subject,
        kbPath: str(args, "kb_path"),
      })
    }
    case "ai_researcher_roadshow": {
      const kbPath = str(args, "kb_path")
      if (!kbPath) throw new Error("请提供 kb_path，指向知识库中的路演材料")
      return postResearcher("roadshow-analysis", {
        kbPath,
        beianHao: str(args, "reg_code"),
      })
    }
    case "ai_researcher_team_background":
      return postResearcher("team-background", {
        keyword: str(args, "keyword"),
        kbPath: str(args, "kb_path"),
      })
    case "ai_researcher_manager_profile":
      return postResearcher("manager-profile", {
        managerName: str(args, "manager_name"),
        kbPath: str(args, "kb_path"),
      })
    case "kb_list":
      return kbList(account, args)
    case "kb_read":
      return kbRead(args)
    case "kb_ask":
      return kbAsk(args)
    default:
      throw new Error(`unknown tool: ${name}`)
  }
}
