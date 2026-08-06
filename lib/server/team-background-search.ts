/**
 * Search private-fund managers whose teams have a given prior-employer background.
 * Used by AI研究员「团队背景筛选」and ad-hoc research scripts.
 */

import { query } from "@/lib/db"

export type TeamBackgroundResumeRow = {
  registration_no: string
  manager_name: string
  person_name: string
  executive_title: string | null
  period: string | null
  employer: string | null
  department: string | null
  title: string | null
}

export type TeamBackgroundPerson = {
  name: string
  history: Array<{
    period: string | null
    employer: string | null
    department: string | null
    title: string | null
    executive_title: string | null
  }>
}

export type TeamBackgroundManager = {
  registration_no: string
  manager_name: string
  personCount: number
  people: TeamBackgroundPerson[]
}

export type TeamBackgroundKbHit = {
  scope: string
  source: string
  snippet: string
  windows: string[]
}

export type TeamBackgroundNameOnlyManager = {
  registration_no: string
  manager_name: string
  org_type: string | null
  legal_rep_name: string | null
  active_fund_count: number | null
}

export type TeamBackgroundSearchResult = {
  keyword: string
  aliases: string[]
  patterns: string[]
  managers: TeamBackgroundManager[]
  kbHits: TeamBackgroundKbHit[]
  nameOnlyManagers: TeamBackgroundNameOnlyManager[]
  employerBreakdown: Array<{ employer: string; n: number }>
  excludedResumeCount: number
  summary: {
    trueMatchResumeRows: number
    trueMatchManagers: number
    multiPersonManagers: number
    kbChunkMatches: number
    nameOnlyManagers: number
  }
}

/** Well-known firm → search aliases (user keyword matched case-insensitively). */
const FIRM_ALIAS_GROUPS: Array<{ keys: string[]; aliases: string[] }> = [
  {
    keys: ["ubs", "瑞银", "瑞士银行", "瑞士联合银行", "瑞士聯合銀行"],
    aliases: ["UBS", "瑞银", "瑞士银行", "瑞士联合银行", "瑞士聯合銀行", "U.B.S"],
  },
  {
    keys: ["高盛", "goldman", "gs"],
    aliases: ["高盛", "Goldman", "Goldman Sachs", "GS"],
  },
  {
    keys: ["摩根士丹利", "大摩", "morgan stanley", "ms"],
    aliases: ["摩根士丹利", "大摩", "Morgan Stanley"],
  },
  {
    keys: ["摩根大通", "摩根", "jpmorgan", "jpm", "jp morgan"],
    aliases: ["摩根大通", "摩根", "JPMorgan", "J.P. Morgan", "JP Morgan"],
  },
  {
    keys: ["中金", "cicc"],
    aliases: ["中金", "中国国际金融", "CICC"],
  },
  {
    keys: ["two sigma", "twosigma"],
    aliases: ["Two Sigma", "TwoSigma"],
  },
  {
    keys: ["jump", "jump trading"],
    aliases: ["Jump", "Jump Trading"],
  },
  {
    keys: ["citadel", "城堡"],
    aliases: ["Citadel", "城堡"],
  },
  {
    keys: ["德劭", "de shaw", "d.e. shaw"],
    aliases: ["德劭", "D.E. Shaw", "DE Shaw"],
  },
  {
    keys: ["瑞信", "credit suisse", "cs"],
    aliases: ["瑞信", "Credit Suisse"],
  },
  {
    keys: ["花旗", "citi", "citigroup"],
    aliases: ["花旗", "Citi", "Citigroup"],
  },
  {
    keys: ["美林", "merrill"],
    aliases: ["美林", "Merrill", "Merrill Lynch"],
  },
  {
    keys: ["巴克莱", "barclays"],
    aliases: ["巴克莱", "Barclays"],
  },
  {
    keys: ["法兴", "societe generale", "socgen", "sg"],
    aliases: ["法兴", "Societe Generale", "Société Générale", "SocGen"],
  },
]

/** Employers that contain an alias but are not the target firm (per firm key). */
const EXCLUDE_EMPLOYER_PATTERNS: Record<string, string[]> = {
  ubs: [
    "国投瑞银",
    "瑞银电子",
    "瑞银律师",
    "瑞银俊东",
    "瑞银方达",
    "瑞银京华",
    "弘安瑞银",
    "合一瑞银",
    "中佳瑞银",
    "时代瑞银",
    "瑞银汇通",
    "瑞银投资顾问",
  ],
}

function normalizeKeyword(raw: string): string {
  return raw.trim().replace(/\s+/g, " ")
}

function matchFirmGroup(keyword: string): { aliases: string[]; excludeKey: string | null } | null {
  const lower = keyword.toLowerCase()
  for (const group of FIRM_ALIAS_GROUPS) {
    const hit = group.keys.some((k) => {
      if (lower === k) return true
      // Short Latin keys (gs/ms/cs) require exact match to avoid noise
      if (/^[a-z]{1,3}$/.test(k)) return false
      return lower.includes(k) || (k.length >= 2 && k.includes(lower) && lower.length >= 2)
    })
    if (hit) {
      const excludeKey = group.keys[0]
      return { aliases: group.aliases, excludeKey }
    }
  }
  return null
}

/** Build distinct search patterns from keyword + optional client aliases. */
export function expandTeamBackgroundAliases(
  keyword: string,
  extraAliases?: string[] | null,
): { aliases: string[]; patterns: string[]; excludeKey: string | null } {
  const kw = normalizeKeyword(keyword)
  if (!kw) return { aliases: [], patterns: [], excludeKey: null }

  const group = matchFirmGroup(kw)
  const aliases = new Set<string>()
  aliases.add(kw)
  if (group) {
    for (const a of group.aliases) aliases.add(a)
  }
  if (Array.isArray(extraAliases)) {
    for (const a of extraAliases) {
      const t = normalizeKeyword(a)
      if (t) aliases.add(t)
    }
  }

  // For "UBS/瑞银" style chip input, split on /
  if (kw.includes("/")) {
    for (const part of kw.split("/")) {
      const t = normalizeKeyword(part)
      if (t) aliases.add(t)
      const nested = matchFirmGroup(t)
      if (nested) for (const a of nested.aliases) aliases.add(a)
    }
  }

  const patterns = [...aliases]
  return { aliases: patterns, patterns, excludeKey: group?.excludeKey ?? null }
}

function isExcludedEmployer(employer: string | null | undefined, excludeKey: string | null): boolean {
  if (!employer || !excludeKey) return false
  const list = EXCLUDE_EMPLOYER_PATTERNS[excludeKey]
  if (!list) return false
  return list.some((p) => employer.includes(p))
}

function isTrueEmployerMatch(
  employer: string | null | undefined,
  patterns: string[],
  excludeKey: string | null,
): boolean {
  if (!employer) return false
  if (isExcludedEmployer(employer, excludeKey)) return false
  const e = employer.toLowerCase()
  return patterns.some((p) => e.includes(p.toLowerCase()))
}

async function tableExists(name: string): Promise<boolean> {
  const rows = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [name],
  )
  return Boolean(rows[0]?.exists)
}

function extractWindows(text: string, patterns: string[], maxWindows = 3): string[] {
  const windows: string[] = []
  const lower = text.toLowerCase()
  for (const p of patterns) {
    const needle = p.toLowerCase()
    let from = 0
    while (windows.length < maxWindows) {
      const idx = lower.indexOf(needle, from)
      if (idx < 0) break
      const start = Math.max(0, idx - 80)
      const end = Math.min(text.length, idx + needle.length + 120)
      const w = text.slice(start, end).replace(/\s+/g, " ").trim()
      if (w && !windows.includes(w)) windows.push(w)
      from = idx + needle.length
    }
    if (windows.length >= maxWindows) break
  }
  return windows
}

function looksLikeTeamBackground(text: string): boolean {
  return /曾任|就职|背景|团队|工作|加盟|加入|来自|历任|任职|负责|董事|基金经理|创始/.test(text)
}

export type TeamBackgroundSearchOptions = {
  keyword: string
  aliases?: string[] | null
  kbPath?: string | null
  maxManagers?: number
  maxKbHits?: number
}

export async function searchTeamBackground(
  options: TeamBackgroundSearchOptions,
): Promise<TeamBackgroundSearchResult> {
  const keyword = normalizeKeyword(options.keyword)
  const { aliases, patterns, excludeKey } = expandTeamBackgroundAliases(keyword, options.aliases)
  const maxManagers = options.maxManagers ?? 120
  const maxKbHits = options.maxKbHits ?? 40
  const kbPath = (options.kbPath || "").trim()

  if (!keyword || patterns.length === 0) {
    return {
      keyword,
      aliases,
      patterns,
      managers: [],
      kbHits: [],
      nameOnlyManagers: [],
      employerBreakdown: [],
      excludedResumeCount: 0,
      summary: {
        trueMatchResumeRows: 0,
        trueMatchManagers: 0,
        multiPersonManagers: 0,
        kbChunkMatches: 0,
        nameOnlyManagers: 0,
      },
    }
  }

  // Build OR ILIKE clauses for patterns
  const likeParams = patterns.map((p) => `%${p}%`)

  let resumeRows: TeamBackgroundResumeRow[] = []
  let excludedResumeCount = 0

  if (await tableExists("amac_manager_executive_resume")) {
    // Fetch broad ILIKE hits, then classify in JS (exclusions are firm-specific).
    const orParts = patterns
      .map((_, i) => {
        const p = `$${i + 1}`
        return `(employer ILIKE ${p} OR department ILIKE ${p} OR title ILIKE ${p} OR COALESCE(executive_title,'') ILIKE ${p})`
      })
      .join(" OR ")

    const broad = await query<TeamBackgroundResumeRow>(
      `SELECT registration_no, manager_name, person_name, executive_title,
              period, employer, department, title
       FROM amac_manager_executive_resume
       WHERE ${orParts}
       ORDER BY manager_name, person_name, period
       LIMIT 2000`,
      likeParams,
    )

    for (const row of broad) {
      if (isExcludedEmployer(row.employer, excludeKey)) {
        excludedResumeCount += 1
        continue
      }
      // Keep if employer matches, or department/title matches with a non-junk employer
      const empOk = isTrueEmployerMatch(row.employer, patterns, excludeKey)
      const otherOk =
        patterns.some(
          (p) =>
            (row.department || "").toLowerCase().includes(p.toLowerCase())
            || (row.title || "").toLowerCase().includes(p.toLowerCase())
            || (row.executive_title || "").toLowerCase().includes(p.toLowerCase()),
        ) && !isExcludedEmployer(row.employer, excludeKey)
      if (empOk || otherOk) resumeRows.push(row)
    }
  }

  // Deduplicate resume rows
  const seenResume = new Set<string>()
  const uniqResumes: TeamBackgroundResumeRow[] = []
  for (const r of resumeRows) {
    const k = [r.registration_no, r.person_name, r.period, r.employer, r.department, r.title].join("|")
    if (seenResume.has(k)) continue
    seenResume.add(k)
    uniqResumes.push(r)
  }

  // Group by manager
  const mgrMap = new Map<string, TeamBackgroundManager>()
  for (const r of uniqResumes) {
    const key = r.registration_no || r.manager_name
    if (!mgrMap.has(key)) {
      mgrMap.set(key, {
        registration_no: r.registration_no,
        manager_name: r.manager_name,
        personCount: 0,
        people: [],
      })
    }
    const mgr = mgrMap.get(key)!
    let person = mgr.people.find((p) => p.name === r.person_name)
    if (!person) {
      person = { name: r.person_name, history: [] }
      mgr.people.push(person)
    }
    person.history.push({
      period: r.period,
      employer: r.employer,
      department: r.department,
      title: r.title,
      executive_title: r.executive_title,
    })
  }
  for (const mgr of mgrMap.values()) {
    mgr.personCount = mgr.people.length
  }

  const allManagers = [...mgrMap.values()].sort(
    (a, b) => b.personCount - a.personCount || a.manager_name.localeCompare(b.manager_name, "zh"),
  )
  const managers = allManagers.slice(0, maxManagers)

  // Employer breakdown
  const empCount = new Map<string, number>()
  for (const r of uniqResumes) {
    const e = (r.employer || "").trim()
    if (!e) continue
    empCount.set(e, (empCount.get(e) || 0) + 1)
  }
  const employerBreakdown = [...empCount.entries()]
    .map(([employer, n]) => ({ employer, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 40)

  // KB chunks
  let kbHits: TeamBackgroundKbHit[] = []
  let kbChunkMatches = 0
  if (await tableExists("kb_chunks")) {
    const contentOr = patterns.map((_, i) => `content ILIKE $${i + 1}`).join(" OR ")
    const params: unknown[] = [...likeParams]
    let pathFilter = ""
    if (kbPath) {
      params.push(`%${kbPath}%`)
      const pi = params.length
      pathFilter = ` AND (source ILIKE $${pi} OR scope ILIKE $${pi})`
    }

    const countRows = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM kb_chunks WHERE (${contentOr})${pathFilter}`,
      params,
    )
    kbChunkMatches = Number(countRows[0]?.n || 0)

    const rows = await query<{ scope: string; source: string; snippet: string }>(
      `SELECT scope, source, LEFT(content, 1400) AS snippet
       FROM kb_chunks
       WHERE (${contentOr})${pathFilter}
       ORDER BY
         CASE WHEN source ILIKE '%内部尽调%' THEN 0 ELSE 1 END,
         source
       LIMIT 200`,
      params,
    )

    const bySource = new Map<string, TeamBackgroundKbHit>()
    for (const r of rows) {
      const windows = extractWindows(r.snippet || "", patterns)
      if (!windows.length) continue
      const existing = bySource.get(r.source)
      if (existing) {
        for (const w of windows) {
          if (existing.windows.length < 3 && !existing.windows.includes(w)) existing.windows.push(w)
        }
        continue
      }
      bySource.set(r.source, {
        scope: r.scope,
        source: r.source,
        snippet: r.snippet,
        windows,
      })
    }

    kbHits = [...bySource.values()]
      .sort((a, b) => {
        const score = (h: TeamBackgroundKbHit) => {
          let s = 0
          if (h.source.includes("内部尽调")) s += 5
          const text = h.windows.join(" ")
          if (looksLikeTeamBackground(text)) s += 3
          return -s
        }
        return score(a) - score(b)
      })
      .slice(0, maxKbHits)
  }

  // Name-only managers (caution list)
  let nameOnlyManagers: TeamBackgroundNameOnlyManager[] = []
  if (await tableExists("amac_managers")) {
    const nameOr = patterns.map((_, i) => `manager_name ILIKE $${i + 1}`).join(" OR ")
    const rows = await query<TeamBackgroundNameOnlyManager>(
      `SELECT registration_no, manager_name, org_type, legal_rep_name,
              active_fund_count
       FROM amac_managers
       WHERE ${nameOr}
       ORDER BY active_fund_count DESC NULLS LAST
       LIMIT 40`,
      likeParams,
    )
    // Exclude those already in true-match managers (they are fine to show elsewhere)
    const trueRegs = new Set(managers.map((m) => m.registration_no))
    nameOnlyManagers = rows.filter((r) => !trueRegs.has(r.registration_no))
  }

  return {
    keyword,
    aliases,
    patterns,
    managers,
    kbHits,
    nameOnlyManagers,
    employerBreakdown,
    excludedResumeCount,
    summary: {
      trueMatchResumeRows: uniqResumes.length,
      trueMatchManagers: allManagers.length,
      multiPersonManagers: allManagers.filter((m) => m.personCount >= 2).length,
      kbChunkMatches,
      nameOnlyManagers: nameOnlyManagers.length,
    },
  }
}

/** Compact text block for LLM prompts. */
export function formatTeamBackgroundForPrompt(
  result: TeamBackgroundSearchResult,
  opts?: { maxManagers?: number; maxKbHits?: number },
): string {
  const maxManagers = opts?.maxManagers ?? 80
  const maxKbHits = opts?.maxKbHits ?? 30
  const lines: string[] = []
  lines.push(`## 检索关键词`)
  lines.push(`主关键词：${result.keyword}`)
  lines.push(`扩展别名：${result.aliases.join("、")}`)
  lines.push(`排除履历条数（合资/同名干扰）：${result.excludedResumeCount}`)
  lines.push("")
  lines.push(`## 统计`)
  lines.push(
    `真正匹配履历 ${result.summary.trueMatchResumeRows} 条；管理人 ${result.summary.trueMatchManagers} 家；`
      + `多人命中 ${result.summary.multiPersonManagers} 家；知识库切片 ${result.summary.kbChunkMatches} 条；`
      + `名称含关键词管理人 ${result.summary.nameOnlyManagers} 家`,
  )
  lines.push("")
  lines.push(`## 雇主分布 Top`)
  for (const e of result.employerBreakdown.slice(0, 15)) {
    lines.push(`- ${e.employer}：${e.n}`)
  }
  lines.push("")
  lines.push(`## 管理人名单（按背景人数降序，最多 ${maxManagers} 家）`)
  for (const m of result.managers.slice(0, maxManagers)) {
    lines.push(`### ${m.manager_name}（${m.registration_no}）— ${m.personCount} 人`)
    for (const p of m.people) {
      const hist = p.history
        .map((h) => {
          const role = h.title || h.department || h.executive_title || ""
          return `${h.period || ""} ${h.employer || ""}${role ? ` / ${role}` : ""}`.trim()
        })
        .join("；")
      lines.push(`- ${p.name}：${hist}`)
    }
  }
  lines.push("")
  lines.push(`## 知识库命中（最多 ${maxKbHits} 条来源）`)
  for (const h of result.kbHits.slice(0, maxKbHits)) {
    lines.push(`### ${h.source}`)
    for (const w of h.windows.slice(0, 2)) lines.push(`> ${w}`)
  }
  lines.push("")
  lines.push(`## 名称含关键词但未必具备该机构履历（需甄别）`)
  for (const n of result.nameOnlyManagers.slice(0, 20)) {
    lines.push(
      `- ${n.manager_name}（${n.registration_no}）${n.org_type ? `｜${n.org_type}` : ""}`
        + `${n.active_fund_count != null ? `｜在管 ${n.active_fund_count}` : ""}`,
    )
  }
  return lines.join("\n")
}

