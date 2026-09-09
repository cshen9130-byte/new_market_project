/**
 * Export 基金数据库 → 私募基金 suggestions for:
 *   基金策略=未分类 (团队策略 empty) + 基金类型=私募证券基金
 * Matches the list filter that shows ~124,779 rows.
 *
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
  if (/指增|指数增强/.test(n) && !/中性/.test(n)) {
    return { l1: "股票多头", l2: "指数增强", l3: null, confidence: "high", reasons: ["产品名含指增/指数增强"] }
  }
  if (/中性增强|市场中性|中性策略|量化中性|股票中性|量化市场中性/.test(n) || /中性[0-9]/.test(n) || /中性$/.test(n)) {
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
  if (/可转债|转债/.test(n) && !/套利|指增/.test(n)) {
    return { l1: "股票多头", l2: "可转债多头", l3: null, confidence: "medium", reasons: ["产品名含可转债"] }
  }
  if (/主观多头/.test(n)) return { l1: "股票多头", l2: "主观多头", l3: null, confidence: "high", reasons: ["产品名含主观多头"] }
  if (/量化多头|量化选股|量化精选/.test(n) && !/中性|对冲|指增/.test(n)) {
    return { l1: "股票多头", l2: "量化多头", l3: null, confidence: "medium", reasons: ["产品名含量化多头/选股"] }
  }
  if (/股票多头|多头策略/.test(n)) {
    return { l1: "股票多头", l2: null, l3: null, confidence: "medium", reasons: ["产品名含股票多头"] }
  }
  if (/量化对冲|灵活对冲|股票对冲|对冲策略/.test(n) && !/期货|CTA/.test(n)) {
    return { l1: "股票对冲", l2: null, l3: null, confidence: "medium", reasons: ["产品名含对冲"] }
  }
  if (/对冲/.test(n) && !/期货|CTA/.test(n)) {
    return { l1: "股票对冲", l2: null, l3: null, confidence: "low", reasons: ["产品名含对冲"] }
  }
  if (/套利/.test(n)) return { l1: "套利策略", l2: null, l3: null, confidence: "medium", reasons: ["产品名含套利"] }
  return null
}

function preferGuess(current: Guess | null, next: Guess | null): Guess | null {
  if (!next) return current
  if (!current) return next
  if (next.confidence === "high" && current.confidence !== "high") return next
  if (current.confidence === "high" && next.confidence !== "high") {
    if (next.l1 === current.l1 && next.l2 && !current.l2) {
      return { ...current, l2: next.l2, l3: next.l3 ?? current.l3, reasons: [...current.reasons, ...next.reasons] }
    }
    if (next.l1 !== current.l1) {
      return { ...current, reasons: [...current.reasons, `其他来源另指向${next.l1}/${next.l2 ?? ""}`] }
    }
    return { ...current, reasons: [...current.reasons, ...next.reasons] }
  }
  if (next.l1 === current.l1 && next.l2 && !current.l2) {
    return { ...current, l2: next.l2, l3: next.l3 ?? current.l3, reasons: [...current.reasons, ...next.reasons] }
  }
  if (next.l1 !== current.l1 && next.confidence === "high") {
    return { ...next, reasons: [...next.reasons, `与其他来源冲突:${current.l1}/${current.l2 ?? ""}`] }
  }
  return { ...current, reasons: [...current.reasons, ...next.reasons] }
}

async function main() {
  const { query } = await import("../../lib/db")
  const { getStoredTeamStrategies } = await import("../../lib/server/ops-team-strategies")
  const { mapPlatformToOfficialTeam } = await import("../../lib/ma/team-strategy-tree")
  const { sqlPreferAmacOfficialName } = await import("../../lib/server/fund-name-match")
  const { sqlType6LatestStrategyJoin } = await import("../../lib/server/fund-strategy-resolve")

  const tree = await getStoredTeamStrategies()
  const officialL2 = new Map<string, Set<string>>()
  for (const n of tree) officialL2.set(n.l1, new Set(n.l2s.map((x) => x.l2)))

  function mapKnown(l1raw: string | null, l2raw: string | null, l3raw: string | null): Triple | null {
    return mapPlatformToOfficialTeam(tree, { l1: blank(l1raw), l2: blank(l2raw), l3: blank(l3raw) })
  }

  const classified = await query<{
    register_number: string
    product_name: string
    manager: string | null
    l1: string | null
    l2: string | null
    l3: string | null
  }>(
    `SELECT t6.register_number,
            COALESCE(NULLIF(BTRIM(t6.fund_short_name), ''), NULLIF(BTRIM(t6.fund_name), ''), t6.register_number) AS product_name,
            NULLIF(BTRIM(i.manager), '') AS manager,
            NULLIF(BTRIM(t6.company_strategy_one), '') AS l1,
            NULLIF(BTRIM(t6.company_strategy_two), '') AS l2,
            NULLIF(BTRIM(t6.company_strategy_three), '') AS l3
     FROM type6_ops_team_full t6
     LEFT JOIN private_fund_info i ON i.beian_hao = t6.register_number
     WHERE NULLIF(BTRIM(t6.company_strategy_one), '') IS NOT NULL`,
  )

  const classifiedByBase = new Map<string, Array<Guess & { name: string }>>()
  const classifiedByStem = new Map<string, Array<Guess & { name: string }>>()
  const managerCounts = new Map<string, Map<string, { n: number; sample: Guess }>>()
  for (const r of classified) {
    if (!r.register_number?.trim()) continue
    const mapped = mapKnown(r.l1, r.l2, r.l3)
    if (!mapped?.l1) continue
    const g: Guess & { name: string } = { ...mapped, confidence: "high", reasons: ["sibling"], name: r.product_name }
    const base = shareBase(r.register_number)
    classifiedByBase.set(base, [...(classifiedByBase.get(base) ?? []), g])
    const stem = nameStem(r.product_name)
    if (stem.length >= 4) classifiedByStem.set(stem, [...(classifiedByStem.get(stem) ?? []), g])
    const mgr = (r.manager || "").trim()
    if (mgr) {
      let byL1 = managerCounts.get(mgr)
      if (!byL1) {
        byL1 = new Map()
        managerCounts.set(mgr, byL1)
      }
      const prev = byL1.get(mapped.l1)
      if (prev) prev.n += 1
      else byL1.set(mapped.l1, { n: 1, sample: { ...mapped, confidence: "medium", reasons: ["同管理人已有团队策略"] } })
    }
  }

  const nameExpr = sqlPreferAmacOfficialName("i.product_name", "a.fund_name")
  const teamJoin = sqlType6LatestStrategyJoin("i.beian_hao", "t6")
  const rows = await query<{
    beian_hao: string
    product_name: string
    manager: string | null
    amac_l1: string | null
    amac_l2: string | null
    platform_l1: string | null
    platform_l2: string | null
    platform_l3: string | null
  }>(
    `SELECT
       i.beian_hao,
       ${nameExpr} AS product_name,
       NULLIF(BTRIM(i.manager), '') AS manager,
       NULLIF(NULLIF(BTRIM(i.strategy_l1), ''), '-') AS amac_l1,
       NULLIF(NULLIF(BTRIM(i.strategy_l2), ''), '-') AS amac_l2,
       t6.platform_l1,
       t6.platform_l2,
       t6.platform_l3
     FROM private_fund_info i
     LEFT JOIN amac_private_funds a ON a.fund_no = i.beian_hao
     ${teamJoin}
     WHERE COALESCE(t6.company_l1, t6.company_l2, t6.company_l3) IS NULL
       AND (
         EXISTS (
           SELECT 1 FROM amac_private_funds _ft
           WHERE _ft.fund_no = i.beian_hao
             AND _ft.fund_type = ANY($1::text[])
         )
         OR i.product_name ILIKE $2
       )
     ORDER BY i.beian_hao`,
    [["私募证券投资基金"], "%私募证券%"],
  )

  console.log(`universe=${rows.length}`)

  const headers = [
    "备案号",
    "产品名称",
    "管理人",
    "建议一级",
    "建议二级",
    "建议三级",
    "信心",
    "建议依据",
    "现有协会策略",
    "现有平台策略",
    "同系列已分类产品",
    "是否接受",
    "备注",
  ]

  const dest = path.join(process.cwd(), "data", "private-funds-unclassified-securities-strategy-suggestions.csv")
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const out = fs.createWriteStream(dest, { encoding: "utf8" })
  out.write("\uFEFF")
  out.write(`${headers.map(csvEscape).join(",")}\r\n`)

  let high = 0
  let medium = 0
  let low = 0
  let none = 0

  const pending: string[][] = []

  for (const r of rows) {
    if (!r.beian_hao?.trim() || !r.product_name) continue
    const amac = [r.amac_l1, r.amac_l2].filter(Boolean).join(" / ")
    const platform = [r.platform_l1, r.platform_l2, r.platform_l3].filter(Boolean).join(" / ")
    let guess: Guess | null = null
    const siblingNote: string[] = []

    const fromPlatform = mapKnown(r.platform_l1, r.platform_l2, r.platform_l3)
    if (fromPlatform?.l1) {
      guess = { ...fromPlatform, confidence: fromPlatform.l2 ? "medium" : "low", reasons: ["已有平台策略可映射到运维树"] }
    }
    const fromAmac = mapKnown(r.amac_l1, r.amac_l2, null)
    if (fromAmac?.l1) {
      guess = preferGuess(guess, {
        ...fromAmac,
        confidence: fromAmac.l2 ? "medium" : "low",
        reasons: ["协会策略可映射到运维树"],
      })
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
      siblingNote.push(
        sibList
          .slice(0, 6)
          .map((s) => `${s.name}=${s.l1}${s.l2 ? "/" + s.l2 : ""}${s.l3 ? "/" + s.l3 : ""}`)
          .join("；"),
      )
      const l1s = new Set(sibList.map((s) => s.l1))
      if (l1s.size === 1) {
        const best = sibList.find((s) => s.l2) ?? sibList[0]
        guess = preferGuess(guess, { ...best, confidence: "high", reasons: ["同系列/份额已有团队策略"] })
      }
    }

    const mgr = (r.manager || "").trim()
    if (mgr) {
      const byL1 = managerCounts.get(mgr)
      if (byL1) {
        let total = 0
        let top: { l1: string; n: number; sample: Guess } | null = null
        for (const [l1, info] of byL1) {
          total += info.n
          if (!top || info.n > top.n) top = { l1, n: info.n, sample: info.sample }
        }
        if (top && total >= 3 && top.n / total >= 0.8) {
          guess = preferGuess(guess, {
            ...top.sample,
            confidence: total >= 8 ? "medium" : "low",
            reasons: [`同管理人${top.n}/${total}已标${top.l1}`],
          })
        }
      }
    }

    const fromName = inferFromName(r.product_name)
    if (fromName) {
      const mappedName = mapKnown(fromName.l1, fromName.l2, fromName.l3)
      const snapped: Guess = mappedName?.l1
        ? { ...fromName, ...mappedName, confidence: fromName.confidence, reasons: fromName.reasons }
        : fromName
      guess = preferGuess(guess, snapped)
    }

    const notes: string[] = []
    if (!guess) notes.push("名称/协会/平台/同系列/同管理人均无法可靠推断")

    const confidenceLabel =
      guess?.confidence === "high" ? "高" : guess?.confidence === "medium" ? "中" : guess?.confidence === "low" ? "低" : ""
    if (confidenceLabel === "高") high++
    else if (confidenceLabel === "中") medium++
    else if (confidenceLabel === "低") low++
    else none++

    pending.push([
      r.beian_hao,
      r.product_name,
      r.manager ?? "",
      guess?.l1 ?? "",
      guess?.l2 ?? "",
      guess?.l3 ?? "",
      confidenceLabel,
      guess ? [...new Set(guess.reasons)].join("；") : "",
      amac,
      platform,
      siblingNote.join("；"),
      "",
      notes.join("；"),
    ])
  }

  pending.sort((a, b) => {
    const rank = (c: string) => (c === "高" ? 0 : c === "中" ? 1 : c === "低" ? 2 : 3)
    const d = rank(a[6]) - rank(b[6])
    if (d !== 0) return d
    return a[1].localeCompare(b[1], "zh")
  })

  for (const cols of pending) {
    out.write(`${cols.map(csvEscape).join(",")}\r\n`)
  }

  await new Promise<void>((resolve, reject) => {
    out.end(() => resolve())
    out.on("error", reject)
  })

  console.log(`wrote ${dest}`)
  console.log(
    `candidates=${pending.length} suggested=${pending.length - none} high=${high} medium=${medium} low=${low} none=${none}`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
