/**
 * Export 团队数据 未分类 team-strategy suggestions for review.
 * Universe matches 产品运维 → 团队数据 → 一级策略=未分类.
 *   npx tsx scripts/ma/_export_email_pool_unclassified_suggestions.ts
 */
import fs from "fs"
import path from "path"
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

type Triple = { l1: string | null; l2: string | null; l3: string | null }
type Guess = Triple & { confidence: "high" | "medium" | "low"; reasons: string[] }
type DdKbHint = Guess & { note?: string }

/** Product-level hints from 尽调表格 / 尽调笔记 / AI知识库 (keyed by 备案号 or 名称片段). */
const DD_KB_HINTS: Array<{ match: RegExp; hint: DdKbHint }> = [
  {
    match: /SADE15|汉鸿景明/,
    hint: { l1: "套利策略", l2: "ETF套利", l3: null, confidence: "high", reasons: ["尽调表格代表产品+知识库路演：主策略ETF套利"], note: "尽调表格初筛写量化可转债、ETF套利，结论明确主策略为ETF套利" },
  },
  {
    match: /XY7653|汉盛晓希/,
    hint: { l1: "股票多头", l2: "可转债多头", l3: "量化", confidence: "high", reasons: ["知识库汉鸿材料将其列为可转债策略代表产品"], note: "汉鸿可转债路演/公司介绍以汉盛晓希1号为业绩样本" },
  },
  {
    match: /SJC726|元苔边际/,
    hint: { l1: "股票多头", l2: "主观多头", l3: "交易型", confidence: "high", reasons: ["尽调表格代表产品已标注策略"], note: "初筛=强势股；结论为主观+量化强势股" },
  },
  {
    match: /SXP646|前海安银6号/,
    hint: { l1: "股票对冲", l2: "打板", l3: "强势股,主观", confidence: "high", reasons: ["知识库大树短线强势股文件夹+强势股尽调纪要"], note: "尽调纪要写投资策略=强势股（手工），含涨停/连板/炸板" },
  },
  {
    match: /SBPC39|前海安溋8号/,
    hint: { l1: "股票对冲", l2: "打板", l3: "强势股,主观", confidence: "high", reasons: ["知识库大树短线强势股文件夹+绩效报告/净值"], note: "与安银6号同文件夹；绩效报告基准中证500" },
  },
  {
    match: /SJ392B|SSJ392|熙典基金百富/,
    hint: { l1: "期权策略", l2: "场内期权", l3: "金融卖波", confidence: "high", reasons: ["知识库熙典期权策略尽调纪要明确集合产品为百富1号"], note: "纪要写做空中证1000期权隐含波动率；团队库同系列曾标商品波动率，请人工确认三级" },
  },
  {
    match: /SACB73|明阅金银/,
    hint: { l1: "套利策略", l2: "期货套利", l3: "高频套利,跨期套利", confidence: "medium", reasons: ["尽调表格公司策略+知识库高频套利路演"], note: "尽调表格标混合套利/高频套利；知识库材料为商品期货高频跨期套利，未点名金银1号" },
  },
  {
    match: /BVS97A|SBVS97|德贝瑞悦龄/,
    hint: { l1: "期权策略", l2: "场内期权", l3: null, confidence: "medium", reasons: ["尽调表格同管理人已标期权策略/场内期权"], note: "尽调表格德贝瑞行未写代表产品；该公司其他产品策略不一，请人工确认" },
  },
  {
    match: /SJA874|SBBX56|SBUV99|青蚨万德|青蚨万华|青蚨万亿/,
    hint: { l1: "股票多头", l2: "主观多头", l3: "交易型", confidence: "medium", reasons: ["尽调表格同管理人信实2号+知识库主观多头青蚨基金"], note: "尽调表格代表产品是信实2号，非本产品" },
  },
  {
    match: /ATL22A|木莲安澜/,
    hint: { l1: "期货策略", l2: "主观期货", l3: null, confidence: "medium", reasons: ["知识库内部尽调资料/2026.2.5-木莲主观CTA"] },
  },
  {
    match: /AEB07A|SAEB07|藤创1号/,
    hint: { l1: "期货策略", l2: null, l3: null, confidence: "medium", reasons: ["知识库外部尽调资料CTA策略描述含藤创介绍"], note: "材料为管理人CTA介绍，未写清主观/量化" },
  },
  {
    match: /SBTZ74|SAMR74|大椿全球精选/,
    hint: { l1: "股票多头", l2: "主观多头", l3: null, confidence: "medium", reasons: ["知识库外部尽调资料归在股票主观"], note: "知识库仅有管理人层面材料（大椿资本介绍/鲁班一号），非本产品专属" },
  },
  {
    match: /SY2965|聚鸣积极成长/,
    hint: { l1: "股票多头", l2: "主观多头", l3: null, confidence: "medium", reasons: ["知识库尽调笔记-主观多头/聚鸣"], note: "尽调笔记为管理人层面，未点名本产品" },
  },
]

function lookupDdKbHint(code: string, name: string): DdKbHint | null {
  const blob = `${code} ${name}`
  for (const row of DD_KB_HINTS) {
    if (row.match.test(blob)) return row.hint
  }
  return null
}

function blank(v: string | null | undefined): string | null {
  const s = (v || "").trim()
  return s && s !== "-" ? s : null
}

function shareBase(code: string): string {
  return code.trim().toUpperCase().replace(/[ABC]$/u, "")
}

function nameStem(name: string): string {
  return name
    .replace(/[（(][ABC]类份额[)）]?$/u, "")
    .replace(/[ABC]类(份额)?$/u, "")
    .replace(/(私募证券投资基金|私募基金|证券投资基金|投资基金|集合资产管理计划)$/u, "")
    .replace(/[0-9]+号$/u, "")
    .trim()
}

function shareClassNameVariants(name: string): string[] {
  const n = name.trim()
  const out = new Set<string>([n])
  const stripped = n
    .replace(/[（(][ABC]类份额[)）]?$/u, "")
    .replace(/[ABC]类(份额)?$/u, "")
    .trim()
  if (stripped) out.add(stripped)
  const noFund = stripped
    .replace(/(私募证券投资基金|私募基金|证券投资基金|投资基金|集合资产管理计划)$/u, "")
    .trim()
  if (noFund) {
    out.add(noFund)
    out.add(`${noFund}私募证券投资基金`)
  }
  return [...out].filter((s) => s.length >= 2)
}

function shareClassCodeVariants(code: string): string[] {
  const c = code.trim().toUpperCase()
  if (!c) return []
  const out = new Set<string>([c])
  const noShare = c.replace(/[ABC]$/u, "")
  if (noShare && noShare !== c) {
    out.add(noShare)
    if (!noShare.startsWith("S") && noShare.length >= 5) out.add(`S${noShare}`)
  }
  if (!c.startsWith("S") && /^[A-Z]/.test(c) && c.length >= 5) out.add(`S${c}`)
  if (c.startsWith("S") && c.length >= 6) out.add(c.slice(1))
  return [...out]
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, "\"\"")}"`
  return value
}

async function main() {
  const { query } = await import("../../lib/db")
  const { getStoredTeamStrategies } = await import("../../lib/server/ops-team-strategies")
  const { findParentL2ForMisplacedName } = await import("../../lib/ma/team-strategy-tree")

  const ddTableRows = await query<{ rows: unknown }>(
    `SELECT rows FROM due_diligence_team_table WHERE id = 'team' LIMIT 1`,
  )
  const ddRows: Array<Record<string, unknown>> = Array.isArray(ddTableRows[0]?.rows)
    ? (ddTableRows[0].rows as Array<Record<string, unknown>>)
    : []

  function lookupLiveDdTable(code: string, name: string): DdKbHint | null {
    const compactName = name.replace(/\s+/g, "")
    const hit = ddRows.find((row) => {
      const beian = String(row.representativeProductBeianHao ?? "").trim()
      const product = String(row.representativeProduct ?? "").replace(/\s+/g, "")
      return (beian && (beian === code || shareBase(beian) === shareBase(code)))
        || (product && (product.includes(compactName) || compactName.includes(product)))
    })
    if (!hit) return null
    const l1 = blank(String(hit.strategyLevel1 ?? ""))
    const l2 = blank(String(hit.strategyLevel2 ?? ""))
    const l3 = blank(String(hit.strategyLevel3 ?? ""))
    if (!l1) return null
    const mapped = mapKnown(l1, l2, l3)
    if (!mapped?.l1) return null
    return {
      ...mapped,
      confidence: mapped.l2 ? "high" : "medium",
      reasons: ["尽调表格代表产品已标注策略"],
    }
  }

  const tree = await getStoredTeamStrategies()
  const officialL1 = new Set(tree.map((n) => n.l1))
  const officialL2 = new Map<string, Set<string>>()
  const officialL3 = new Map<string, Set<string>>()
  for (const n of tree) {
    officialL2.set(n.l1, new Set(n.l2s.map((x) => x.l2)))
    for (const l2 of n.l2s) officialL3.set(`${n.l1}\t${l2.l2}`, new Set(l2.l3s))
  }

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

  const { listTeamData } = await import("../../lib/server/team-data-query-pg")
  const { STRATEGY_UNCONFIGURED } = await import("../../lib/ma/strategy-unconfigured")

  const [allTeam, unclassTeam] = await Promise.all([
    listTeamData({
      page: 1,
      pageSize: 500,
      keyword: "",
      strategySource: "company",
      strategyL1: "",
      strategyL2: "",
      strategyL3: "",
      sort: "",
      sortDir: "DESC",
    }),
    listTeamData({
      page: 1,
      pageSize: 500,
      keyword: "",
      strategySource: "company",
      strategyL1: STRATEGY_UNCONFIGURED,
      strategyL2: "",
      strategyL3: "",
      sort: "",
      sortDir: "DESC",
    }),
  ])
  console.log(`团队数据 total=${allTeam.total} unclassified=${unclassTeam.total}`)

  const unclassKeys = new Set(
    unclassTeam.data.map((r) => `${(r.beian_hao || "").trim()}\t${r.product_name}`),
  )
  const enrichmentCodes = [...new Set([
    ...allTeam.data.map((r) => (r.beian_hao || "").trim()).filter(Boolean),
    ...unclassTeam.data.map((r) => (r.beian_hao || "").trim()).filter(Boolean),
  ])]

  const extra = enrichmentCodes.length
    ? await query<{
        register_number: string
        company_l1: string | null
        company_l2: string | null
        company_l3: string | null
        platform_l1: string | null
        platform_l2: string | null
        platform_l3: string | null
        amac_l1: string | null
        amac_l2: string | null
        cache_company_l1: string | null
        cache_platform_l1: string | null
        manager: string | null
      }>(
        `SELECT
           codes.code AS register_number,
           NULLIF(BTRIM(t6.company_strategy_one), '') AS company_l1,
           NULLIF(BTRIM(t6.company_strategy_two), '') AS company_l2,
           NULLIF(BTRIM(t6.company_strategy_three), '') AS company_l3,
           NULLIF(BTRIM(t6.platform_strategy_one), '') AS platform_l1,
           NULLIF(BTRIM(t6.platform_strategy_two), '') AS platform_l2,
           NULLIF(BTRIM(t6.platform_strategy_three), '') AS platform_l3,
           NULLIF(BTRIM(amac.strategy_l1), '') AS amac_l1,
           NULLIF(BTRIM(amac.strategy_l2), '') AS amac_l2,
           NULLIF(BTRIM(cache.company_strategy_l1), '') AS cache_company_l1,
           NULLIF(BTRIM(cache.platform_strategy_l1), '') AS cache_platform_l1,
           NULLIF(BTRIM(amac.manager), '') AS manager
         FROM unnest($1::text[]) AS codes(code)
         LEFT JOIN type6_ops_team_full t6 ON t6.register_number = codes.code
         LEFT JOIN private_fund_info amac ON amac.beian_hao = codes.code
         LEFT JOIN ops_tracking_funds_list_cache cache ON cache.beian_hao = codes.code`,
        [enrichmentCodes],
      )
    : []
  const extraByCode = new Map(extra.map((r) => [r.register_number, r]))

  type PoolRow = {
    register_number: string
    product_name: string
    company_l1: string | null
    company_l2: string | null
    company_l3: string | null
    platform_l1: string | null
    platform_l2: string | null
    platform_l3: string | null
    amac_l1: string | null
    amac_l2: string | null
    cache_company_l1: string | null
    cache_platform_l1: string | null
    manager: string | null
  }

  function toPoolRow(r: { beian_hao: string | null; product_name: string; strategy_l1: string | null }): PoolRow {
    const code = (r.beian_hao || "").trim()
    const x = extraByCode.get(code)
    return {
      register_number: code,
      product_name: r.product_name,
      company_l1: x?.company_l1 ?? blank(r.strategy_l1),
      company_l2: x?.company_l2 ?? null,
      company_l3: x?.company_l3 ?? null,
      platform_l1: x?.platform_l1 ?? null,
      platform_l2: x?.platform_l2 ?? null,
      platform_l3: x?.platform_l3 ?? null,
      amac_l1: x?.amac_l1 ?? null,
      amac_l2: x?.amac_l2 ?? null,
      cache_company_l1: x?.cache_company_l1 ?? null,
      cache_platform_l1: x?.cache_platform_l1 ?? null,
      manager: x?.manager ?? null,
    }
  }

  const unclassified = unclassTeam.data.map(toPoolRow)
  const classified = allTeam.data
    .filter((r) => !unclassKeys.has(`${(r.beian_hao || "").trim()}\t${r.product_name}`))
    .map(toPoolRow)

  const missingMgr = unclassified.filter((r) => !blank(r.manager))
  if (missingMgr.length) {
    const allCodes = [...new Set(missingMgr.flatMap((r) => shareClassCodeVariants(r.register_number)))]
    const allNames = [...new Set(missingMgr.flatMap((r) => shareClassNameVariants(r.product_name)))]
    const byCode = allCodes.length
      ? await query<{ beian_hao: string; manager: string }>(
          `SELECT beian_hao, NULLIF(BTRIM(manager), '') AS manager
             FROM private_fund_info
            WHERE beian_hao = ANY($1::text[])
              AND NULLIF(BTRIM(manager), '') IS NOT NULL`,
          [allCodes],
        )
      : []
    const byName = allNames.length
      ? await query<{ product_name: string; manager: string }>(
          `SELECT product_name, NULLIF(BTRIM(manager), '') AS manager
             FROM private_fund_info
            WHERE NULLIF(BTRIM(manager), '') IS NOT NULL
              AND (product_name = ANY($1::text[]) OR product_name ILIKE ANY($2::text[]))`,
          [allNames, allNames.map((n) => `${n}%`)],
        )
      : []
    const codeMap = new Map(byCode.map((x) => [x.beian_hao.toUpperCase(), x.manager]))
    const nameMap = new Map(byName.map((x) => [x.product_name, x.manager]))
    const knownMgr = new Map<string, string>()
    for (const r of [...unclassified, ...classified]) {
      if (blank(r.manager) && nameStem(r.product_name).length >= 4) {
        knownMgr.set(nameStem(r.product_name), r.manager!)
      }
    }
    for (const r of unclassified) {
      if (blank(r.manager)) continue
      for (const c of shareClassCodeVariants(r.register_number)) {
        const hit = codeMap.get(c.toUpperCase())
        if (hit) {
          r.manager = hit
          break
        }
      }
      if (blank(r.manager)) continue
      for (const n of shareClassNameVariants(r.product_name)) {
        const hit = nameMap.get(n) || [...nameMap.entries()].find(([k]) => k.startsWith(n))?.[1]
        if (hit) {
          r.manager = hit
          break
        }
      }
      if (blank(r.manager)) continue
      const stem = nameStem(r.product_name)
      if (stem.length >= 4 && knownMgr.has(stem)) r.manager = knownMgr.get(stem)!
    }
  }

  const classifiedByBase = new Map<string, Array<Guess & { name: string }>>()
  const classifiedByStem = new Map<string, Array<Guess & { name: string }>>()
  for (const r of classified) {
    const mapped = mapKnown(r.company_l1 || r.cache_company_l1, r.company_l2, r.company_l3)
    if (!mapped?.l1) continue
    const g: Guess & { name: string } = { ...mapped, confidence: "high", reasons: ["sibling"], name: r.product_name }
    const base = shareBase(r.register_number)
    classifiedByBase.set(base, [...(classifiedByBase.get(base) ?? []), g])
    const stem = nameStem(r.product_name)
    if (stem.length >= 4) classifiedByStem.set(stem, [...(classifiedByStem.get(stem) ?? []), g])
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
    if (/\bFOF\b|FOF基金|母基金/.test(n) || /FOF/.test(n)) {
      return { l1: "多资产策略", l2: "FOF", l3: null, confidence: "high", reasons: ["产品名含FOF"] }
    }
    if (/\bMOM\b|MOM基金/.test(n) || /MOM/.test(n)) {
      return { l1: "多资产策略", l2: "MOM", l3: null, confidence: "high", reasons: ["产品名含MOM"] }
    }
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

  const headers = [
    "备案号",
    "产品名称",
    "管理人",
    "建议一级",
    "建议二级",
    "建议三级",
    "信心",
    "建议依据",
    "现有平台策略",
    "现有协会策略",
    "同系列已分类产品",
    "是否接受",
    "备注",
  ]

  const outRows: string[][] = []

  for (const r of unclassified) {
    const platform = [r.platform_l1, r.platform_l2, r.platform_l3].filter(Boolean).join(" / ")
    const amac = [r.amac_l1, r.amac_l2 && r.amac_l2 !== "-" ? r.amac_l2 : null].filter(Boolean).join(" / ")
    let guess: Guess | null = null
    const siblingNote: string[] = []

    const fromPlatform = mapKnown(r.platform_l1 || r.cache_platform_l1, r.platform_l2, r.platform_l3)
    if (fromPlatform?.l1) {
      guess = { ...fromPlatform, confidence: fromPlatform.l2 ? "high" : "medium", reasons: ["已有平台策略可映射到运维树"] }
    }

    const fromAmac = mapKnown(r.amac_l1, r.amac_l2 === "-" ? null : r.amac_l2, null)
    if (fromAmac?.l1 && (!guess || (guess.confidence !== "high" && fromAmac.l2))) {
      guess = { ...fromAmac, confidence: fromAmac.l2 ? "medium" : "low", reasons: ["协会AMAC策略可映射到运维树"] }
    }

    const sibs = [
      ...(classifiedByBase.get(shareBase(r.register_number)) ?? []),
      ...(classifiedByStem.get(nameStem(r.product_name)) ?? []),
    ]
    const uniqueSibs = new Map<string, Guess & { name: string }>()
    for (const s of sibs) uniqueSibs.set(`${s.name}|${s.l1}|${s.l2}|${s.l3}`, s)
    const sibList = [...uniqueSibs.values()]
    if (sibList.length) {
      siblingNote.push(sibList.map((s) => `${s.name}=${s.l1}${s.l2 ? "/" + s.l2 : ""}${s.l3 ? "/" + s.l3 : ""}`).join("；"))
      const l1s = new Set(sibList.map((s) => s.l1))
      if (l1s.size === 1) {
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
        if (fromName.confidence === "high") {
          guess = { ...fromName, reasons: [...fromName.reasons, `与其他来源冲突:${guess.l1}/${guess.l2 ?? ""}`] }
        } else {
          guess = { ...guess, reasons: [...guess.reasons, `产品名另指向${fromName.l1}/${fromName.l2 ?? ""}`] }
        }
      } else {
        guess = { ...guess, reasons: [...guess.reasons, ...fromName.reasons] }
      }
    }

    const notes: string[] = []
    if (fromAmac?.l1 && guess?.l1 && fromAmac.l1 !== guess.l1) {
      notes.push(`协会策略为${amac}，与建议不一致，请人工确认`)
    }
    const fromDdKb = lookupDdKbHint(r.register_number, r.product_name)
      ?? lookupLiveDdTable(r.register_number, r.product_name)
    if (fromDdKb) {
      if (!guess || guess.confidence !== "high") {
        guess = fromDdKb
      } else {
        guess = { ...guess, reasons: [...guess.reasons, ...fromDdKb.reasons] }
      }
      if (fromDdKb.note) notes.push(fromDdKb.note)
    }

    if (!guess) notes.push("名称/协会/同系列/尽调表格/尽调笔记/知识库均无法可靠推断")

    const confidenceLabel = guess?.confidence === "high" ? "高" : guess?.confidence === "medium" ? "中" : guess?.confidence === "low" ? "低" : ""

    outRows.push([
      r.register_number,
      r.product_name,
      r.manager ?? "",
      guess?.l1 ?? "",
      guess?.l2 ?? "",
      guess?.l3 ?? "",
      confidenceLabel,
      guess ? [...new Set(guess.reasons)].join("；") : "",
      platform,
      amac,
      siblingNote.join("；"),
      "",
      notes.join("；"),
    ])
  }

  outRows.sort((a, b) => {
    const rank = (c: string) => (c === "高" ? 0 : c === "中" ? 1 : c === "低" ? 2 : 3)
    const d = rank(a[6]) - rank(b[6])
    if (d !== 0) return d
    return a[1].localeCompare(b[1], "zh")
  })

  const dest = path.join(process.cwd(), "data", "email-ops-unclassified-strategy-suggestions.csv")
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const body = [headers, ...outRows].map((cols) => cols.map((c) => csvEscape(c)).join(",")).join("\r\n")
  fs.writeFileSync(dest, `\uFEFF${body}\r\n`, "utf8")

  const suggested = outRows.filter((r) => r[3]).length
  const high = outRows.filter((r) => r[6] === "高").length
  const medium = outRows.filter((r) => r[6] === "中").length
  const low = outRows.filter((r) => r[6] === "低").length
  console.log(`wrote ${dest}`)
  console.log(`unclassified=${outRows.length} suggested=${suggested} high=${high} medium=${medium} low=${low} none=${outRows.length - suggested}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
