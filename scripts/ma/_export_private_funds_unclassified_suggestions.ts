/**
 * Export 私募数据库 未分类 team-strategy suggestions for review.
 *   npx tsx scripts/ma/_export_private_funds_unclassified_suggestions.ts
 */
import fs from "fs"
import path from "path"
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

type Triple = { l1: string | null; l2: string | null; l3: string | null }
type Guess = Triple & { confidence: "high" | "medium" | "low"; reasons: string[] }

function blank(v: string | null | undefined): string | null {
  const s = (v || "").trim()
  return s && s !== "-" ? s : null
}

function shareBase(code: string): string {
  return code.trim().toUpperCase().replace(/[ABC]$/u, "")
}

function nameStem(name: string): string {
  return name
    .replace(/[ABC]类(份额)?$/u, "")
    .replace(/(私募证券投资基金|私募基金|证券投资基金|投资基金|集合资产管理计划)$/u, "")
    .replace(/[0-9]+号$/u, "")
    .trim()
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, "\"\"")}"`
  return value
}

function inferFromName(name: string): Guess | null {
  const n = name.replace(/\s+/g, "")

  const indexHits: Array<[RegExp, string]> = [
    [/A500指增|A500指数增强|中证A500(指增|指数增强)|A500增强/, "A500指增"],
    [/2000指增|中证2000(指增|指数增强)|2000增强/, "2000指增"],
    [/1000指增|中证1000(指增|指数增强)|1000增强/, "1000指增"],
    [/500指增|中证500(指增|指数增强)|500增强/, "500指增"],
    [/300指增|沪深300(指增|指数增强)|HS300(指增|指数增强)|300增强/, "300指增"],
    [/红利指增/, "红利指增"],
    [/行业指增/, "行业指增"],
    [/转债指增/, "转债指增"],
    [/风格指增/, "风格指增"],
  ]
  for (const [re, l3] of indexHits) {
    if (re.test(n) && !/中性/.test(n)) {
      return { l1: "股票多头", l2: "指数增强", l3, confidence: "high", reasons: [`产品名含${l3}`] }
    }
  }
  if (/指增|指数增强/.test(n)) {
    return { l1: "股票多头", l2: "指数增强", l3: null, confidence: "high", reasons: ["产品名含指增/指数增强"] }
  }
  if (/中性增强|市场中性|中性策略|量化中性|股票中性|中性[0-9]/.test(n) || /中性$/.test(n)) {
    return { l1: "股票对冲", l2: "股票市场中性", l3: null, confidence: "high", reasons: ["产品名含中性"] }
  }
  if (/宏观量化|宏观混合|宏观配置|宏观策略/.test(n)) {
    return { l1: "多资产策略", l2: "宏观策略", l3: /量化/.test(n) ? "量化" : null, confidence: "high", reasons: ["产品名含宏观"] }
  }
  if (/多资产轮动|ETF轮动/.test(n)) {
    return { l1: "多资产策略", l2: "ETF轮动", l3: null, confidence: "high", reasons: ["产品名含轮动"] }
  }
  if (/股票多空|多空对冲|多空策略/.test(n)) {
    return { l1: "股票对冲", l2: "股票多空", l3: null, confidence: "high", reasons: ["产品名含多空"] }
  }
  if (/T0|日内回转/.test(n)) {
    return { l1: "股票对冲", l2: "股票T0", l3: null, confidence: "high", reasons: ["产品名含T0"] }
  }
  if (/打板|盘前板|盘中板|排板|扫板/.test(n)) {
    return { l1: "股票对冲", l2: "打板", l3: null, confidence: "high", reasons: ["产品名含打板"] }
  }
  if (/择时对冲/.test(n)) {
    return { l1: "股票对冲", l2: "择时对冲", l3: null, confidence: "high", reasons: ["产品名含择时对冲"] }
  }
  if (/可转债套利|转债套利/.test(n)) {
    return { l1: "套利策略", l2: "可转债套利", l3: null, confidence: "high", reasons: ["产品名含转债套利"] }
  }
  if (/基金套利/.test(n)) return { l1: "套利策略", l2: "基金套利", l3: null, confidence: "high", reasons: ["产品名含基金套利"] }
  if (/期货套利/.test(n)) return { l1: "套利策略", l2: "期货套利", l3: null, confidence: "high", reasons: ["产品名含期货套利"] }
  if (/期权套利/.test(n)) return { l1: "套利策略", l2: "期权套利", l3: null, confidence: "high", reasons: ["产品名含期权套利"] }
  if (/股票套利/.test(n)) return { l1: "套利策略", l2: "股票套利", l3: null, confidence: "high", reasons: ["产品名含股票套利"] }
  if (/场外期权/.test(n)) return { l1: "期权策略", l2: "场外期权", l3: null, confidence: "high", reasons: ["产品名含场外期权"] }
  if (/场内期权/.test(n)) return { l1: "期权策略", l2: "场内期权", l3: null, confidence: "high", reasons: ["产品名含场内期权"] }
  if (/期权/.test(n)) return { l1: "期权策略", l2: null, l3: null, confidence: "medium", reasons: ["产品名含期权"] }
  if (/主观期货/.test(n)) return { l1: "期货策略", l2: "主观期货", l3: null, confidence: "high", reasons: ["产品名含主观期货"] }
  if (/量化期货|量化CTA|CTA量化/.test(n)) {
    return { l1: "期货策略", l2: "量化期货", l3: null, confidence: "high", reasons: ["产品名含量化期货/CTA"] }
  }
  if (/CTA/.test(n)) return { l1: "期货策略", l2: null, l3: null, confidence: "medium", reasons: ["产品名含CTA"] }
  if (/期货/.test(n) && !/证券|股票|对冲|套利|期权/.test(n)) {
    return { l1: "期货策略", l2: null, l3: null, confidence: "medium", reasons: ["产品名含期货"] }
  }
  if (/FOF/.test(n)) return { l1: "多资产策略", l2: "FOF", l3: null, confidence: "high", reasons: ["产品名含FOF"] }
  if (/MOM/.test(n)) return { l1: "多资产策略", l2: "MOM", l3: null, confidence: "high", reasons: ["产品名含MOM"] }
  if (/信用债/.test(n)) return { l1: "债券策略", l2: "信用债", l3: null, confidence: "high", reasons: ["产品名含信用债"] }
  if (/利率债/.test(n)) return { l1: "债券策略", l2: "利率债", l3: null, confidence: "high", reasons: ["产品名含利率债"] }
  if (/债券|固收|固定收益/.test(n) && !/转债|可转/.test(n)) {
    return { l1: "债券策略", l2: null, l3: null, confidence: "medium", reasons: ["产品名含债券/固收"] }
  }
  if (/主观多头/.test(n)) return { l1: "股票多头", l2: "主观多头", l3: null, confidence: "high", reasons: ["产品名含主观多头"] }
  if (/股票多头|多头策略/.test(n)) return { l1: "股票多头", l2: null, l3: null, confidence: "medium", reasons: ["产品名含股票多头"] }
  if (/股票对冲|对冲策略|对冲/.test(n) && !/期货|CTA/.test(n)) {
    return { l1: "股票对冲", l2: null, l3: null, confidence: /股票对冲|对冲策略/.test(n) ? "medium" : "low", reasons: ["产品名含对冲"] }
  }
  if (/套利/.test(n)) return { l1: "套利策略", l2: null, l3: null, confidence: "medium", reasons: ["产品名含套利"] }
  return null
}

async function main() {
  const { query } = await import("../../lib/db")
  const { getStoredTeamStrategies } = await import("../../lib/server/ops-team-strategies")
  const { findParentL2ForMisplacedName } = await import("../../lib/ma/team-strategy-tree")

  const tree = await getStoredTeamStrategies()
  const officialL1 = new Set(tree.map((n) => n.l1))
  const officialL2 = new Map<string, Set<string>>()
  for (const n of tree) officialL2.set(n.l1, new Set(n.l2s.map((x) => x.l2)))

  const L1_ALIASES: Record<string, string> = {
    组合策略: "多资产策略",
    其他: "其他策略",
    股票策略: "股票多头",
    固定收益: "债券策略",
    固收策略: "债券策略",
  }

  function mapL1(raw: string | null): string | null {
    if (!raw) return null
    if (officialL1.has(raw)) return raw
    return officialL1.has(L1_ALIASES[raw] ?? "") ? L1_ALIASES[raw] : null
  }

  function mapKnown(l1raw: string | null, l2raw: string | null, l3raw: string | null): Triple | null {
    const l1 = mapL1(l1raw)
    if (!l1) return null
    let l2 = blank(l2raw)
    let l3 = blank(l3raw)
    if (l2 && !(officialL2.get(l1)?.has(l2))) {
      const parent = findParentL2ForMisplacedName(tree, l1, l2)
      if (parent) {
        const parts = (l3 ? l3.split(/[，,、/]/) : []).map((s) => s.trim()).filter(Boolean)
        if (!parts.includes(l2)) parts.unshift(l2)
        l3 = parts.join(",") || null
        l2 = parent
      } else {
        l2 = null
        l3 = null
      }
    }
    return { l1, l2, l3 }
  }

  const classified = await query<{
    register_number: string
    product_name: string
    l1: string | null
    l2: string | null
    l3: string | null
  }>(
    `SELECT register_number,
            COALESCE(NULLIF(BTRIM(fund_short_name), ''), NULLIF(BTRIM(fund_name), ''), register_number) AS product_name,
            NULLIF(BTRIM(company_strategy_one), '') AS l1,
            NULLIF(BTRIM(company_strategy_two), '') AS l2,
            NULLIF(BTRIM(company_strategy_three), '') AS l3
     FROM type6_ops_team_full
     WHERE NULLIF(BTRIM(company_strategy_one), '') IS NOT NULL`,
  )

  const classifiedByBase = new Map<string, Array<Guess & { name: string }>>()
  const classifiedByStem = new Map<string, Array<Guess & { name: string }>>()
  for (const r of classified) {
    if (!r.register_number?.trim()) continue
    const mapped = mapKnown(r.l1, r.l2, r.l3)
    if (!mapped?.l1) continue
    const g: Guess & { name: string } = { ...mapped, confidence: "high", reasons: ["sibling"], name: r.product_name }
    const base = shareBase(r.register_number)
    classifiedByBase.set(base, [...(classifiedByBase.get(base) ?? []), g])
    const stem = nameStem(r.product_name)
    if (stem.length >= 4) classifiedByStem.set(stem, [...(classifiedByStem.get(stem) ?? []), g])
  }

  const rows = await query<{
    beian_hao: string
    product_name: string
    manager: string | null
    company_l1: string | null
    company_l2: string | null
    company_l3: string | null
    platform_l1: string | null
    platform_l2: string | null
    platform_l3: string | null
  }>(
    `SELECT
       i.beian_hao,
       i.product_name,
       NULLIF(BTRIM(i.manager), '') AS manager,
       NULLIF(BTRIM(t6.company_strategy_one), '') AS company_l1,
       NULLIF(BTRIM(t6.company_strategy_two), '') AS company_l2,
       NULLIF(BTRIM(t6.company_strategy_three), '') AS company_l3,
       NULLIF(BTRIM(t6.platform_strategy_one), '') AS platform_l1,
       NULLIF(BTRIM(t6.platform_strategy_two), '') AS platform_l2,
       NULLIF(BTRIM(t6.platform_strategy_three), '') AS platform_l3
     FROM private_fund_info i
     LEFT JOIN type6_ops_team_full t6 ON t6.register_number = i.beian_hao
     WHERE (NULLIF(BTRIM(i.strategy_l1), '') IS NULL OR BTRIM(i.strategy_l1) = '-')
       AND i.latest_nav_date >= CURRENT_DATE - INTERVAL '6 months'
     ORDER BY i.product_name, i.beian_hao`,
  )

  const headers = [
    "备案号",
    "产品名称",
    "管理人",
    "建议一级",
    "建议二级",
    "建议三级",
    "信心",
    "建议依据",
    "现有团队策略",
    "现有平台策略",
    "同系列已分类产品",
    "是否接受",
    "备注",
  ]

  const outRows: string[][] = []

  for (const r of rows) {
    if (!r.beian_hao?.trim() || !r.product_name) continue
    const team = [r.company_l1, r.company_l2, r.company_l3].filter(Boolean).join(" / ")
    const platform = [r.platform_l1, r.platform_l2, r.platform_l3].filter(Boolean).join(" / ")
    let guess: Guess | null = null
    const siblingNote: string[] = []

    const fromTeam = mapKnown(r.company_l1, r.company_l2, r.company_l3)
    if (fromTeam?.l1) {
      guess = { ...fromTeam, confidence: "high", reasons: ["团队数据已有团队策略"] }
    }

    const fromPlatform = mapKnown(r.platform_l1, r.platform_l2, r.platform_l3)
    if (fromPlatform?.l1 && (!guess || (guess.confidence !== "high" && fromPlatform.l2))) {
      guess = { ...fromPlatform, confidence: fromPlatform.l2 ? "medium" : "low", reasons: ["已有平台策略可映射到运维树"] }
    }

    const sibs = [
      ...(classifiedByBase.get(shareBase(r.beian_hao)) ?? []),
      ...(classifiedByStem.get(nameStem(r.product_name)) ?? []),
    ]
    const uniqueSibs = new Map<string, Guess & { name: string }>()
    for (const s of sibs) {
      if (s.name === r.product_name) continue
      uniqueSibs.set(`${s.name}|${s.l1}|${s.l2}|${s.l3}`, s)
    }
    const sibList = [...uniqueSibs.values()]
    if (sibList.length) {
      siblingNote.push(sibList.slice(0, 8).map((s) => `${s.name}=${s.l1}${s.l2 ? "/" + s.l2 : ""}${s.l3 ? "/" + s.l3 : ""}`).join("；"))
      const l1s = new Set(sibList.map((s) => s.l1))
      if (!guess && l1s.size === 1) {
        const best = sibList.find((s) => s.l2) ?? sibList[0]
        guess = { ...best, confidence: "high", reasons: ["同系列/份额已有团队策略"] }
      }
    }

    const fromName = inferFromName(r.product_name)
    if (fromName) {
      if (!guess) guess = fromName
      else if (fromName.confidence === "high" && guess.confidence !== "high") guess = fromName
      else if (fromName.l1 === guess.l1 && fromName.l2 && !guess.l2) {
        guess = { ...guess, l2: fromName.l2, l3: fromName.l3 ?? guess.l3, reasons: [...guess.reasons, ...fromName.reasons] }
      } else if (fromName.l1 !== guess.l1) {
        if (fromName.confidence === "high" && guess.reasons[0] !== "团队数据已有团队策略") {
          guess = { ...fromName, reasons: [...fromName.reasons, `与其他来源冲突:${guess.l1}/${guess.l2 ?? ""}`] }
        } else {
          guess = { ...guess, reasons: [...guess.reasons, `产品名另指向${fromName.l1}/${fromName.l2 ?? ""}`] }
        }
      } else {
        guess = { ...guess, reasons: [...guess.reasons, ...fromName.reasons] }
      }
    }

    const notes: string[] = []
    if (fromTeam?.l1 && fromName?.l1 && fromTeam.l1 !== fromName.l1 && fromName.confidence === "high") {
      notes.push(`产品名指向${fromName.l1}/${fromName.l2 ?? ""}，与已有团队策略不一致`)
    }
    if (!guess) notes.push("名称/团队数据/同系列均无法可靠推断")

    const confidenceLabel = guess?.confidence === "high" ? "高" : guess?.confidence === "medium" ? "中" : guess?.confidence === "low" ? "低" : ""

    outRows.push([
      r.beian_hao,
      r.product_name,
      r.manager ?? "",
      guess?.l1 ?? "",
      guess?.l2 ?? "",
      guess?.l3 ?? "",
      confidenceLabel,
      guess ? [...new Set(guess.reasons)].join("；") : "",
      team,
      platform,
      siblingNote.join("；"),
      "",
      notes.join("；"),
    ])
  }

  outRows.sort((a, b) => {
    const rank = (c: string) => (c === "高" ? 0 : c === "中" ? 1 : 2)
    const d = rank(a[6]) - rank(b[6])
    if (d !== 0) return d
    return a[1].localeCompare(b[1], "zh")
  })

  const dest = path.join(process.cwd(), "data", "private-funds-unclassified-strategy-suggestions.csv")
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const body = [headers, ...outRows].map((cols) => cols.map((c) => csvEscape(c)).join(",")).join("\r\n")
  fs.writeFileSync(dest, `\uFEFF${body}\r\n`, "utf8")

  const high = outRows.filter((r) => r[6] === "高").length
  const medium = outRows.filter((r) => r[6] === "中").length
  const low = outRows.filter((r) => r[6] === "低").length
  console.log(`wrote ${dest}`)
  const none = outRows.length - high - medium - low
  console.log(`candidates=${rows.length} suggested=${outRows.length - none} high=${high} medium=${medium} low=${low} none=${none}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
