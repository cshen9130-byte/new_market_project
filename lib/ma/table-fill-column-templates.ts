import { rawQuery } from "@/lib/db"

export type TableFillColumnTemplate = {
  name: string
  title: string
  columns: string[]
  source: "knowledge-base" | "fallback"
}

const SHORT_NAME_RE = /^[\u4e00-\u9fff]{2,4}$/

const ROW_HEADER_WORDS = new Set([
  "代表产品", "基金经理", "细分策略", "团队背景", "策略原理", "策略演进史",
  "历年收益", "回撤情况", "胜率", "赔率", "仓位变化", "选股范围", "选股因子",
  "策略风格", "适应市场", "星级排序", "管理人", "净值表现", "策略标签",
  "管理人介绍", "因子情况", "组合模型", "优化器", "特点", "风险点",
  "交易品种", "频段特征", "风险控制", "暂无数据", "暂无", "合计", "平均",
])

/** Fallback lists when KB search returns nothing (e.g. local dev). */
export const TABLE_FILL_COLUMN_TEMPLATE_FALLBACKS: TableFillColumnTemplate[] = [
  {
    name: "打板策略",
    title: "打板策略横向比较表",
    columns: ["量桥", "量道", "六妙星", "鉴拾", "衍复", "均成", "致诚", "阜力", "矩融"],
    source: "fallback",
  },
  {
    name: "强势股策略",
    title: "强势股策略横向比较表",
    columns: ["务扬", "凯瑞", "青钱", "臻选", "波克", "古曲", "古木", "趣时"],
    source: "fallback",
  },
  {
    name: "CTA策略",
    title: "CTA策略横向比较表",
    columns: ["艾方", "黑玺", "智领", "爱凡哲", "蜂起", "泓湖", "坤复", "奥创"],
    source: "fallback",
  },
]

function isLikelyColumnName(value: string): boolean {
  if (!SHORT_NAME_RE.test(value)) return false
  if (ROW_HEADER_WORDS.has(value)) return false
  return true
}

/** Extract the longest plausible column-header name list from table text. */
export function extractColumnNamesFromText(text: string): string[] {
  const lines = text.replace(/\r/g, "").split("\n")
  let best: string[] = []

  for (const line of lines) {
    for (const sep of [/[\t]+/, /[,，|｜]+/, /\s{2,}/, /\s+/] as const) {
      const parts = line
        .split(sep)
        .map((s) => s.trim())
        .filter(isLikelyColumnName)
      if (parts.length > best.length) best = parts
    }
  }

  return [...new Set(best)]
}

function scoreChunkForStrategy(content: string, strategy: string): number {
  let score = 0
  if (content.includes(strategy)) score += 3
  if (/横向比较/.test(content)) score += 2
  if (/代表产品/.test(content)) score += 1
  const names = extractColumnNamesFromText(content)
  if (names.length >= 5) score += names.length
  return score
}

async function searchKbChunksForStrategy(strategy: string): Promise<string[]> {
  const patterns = [
    `%${strategy}横向比较%`,
    `%${strategy}%`,
    `%${strategy.replace("策略", "")}%`,
  ]

  const seen = new Set<string>()
  const candidates: Array<{ names: string[]; score: number }> = []

  for (const pattern of patterns) {
    let rows: Array<{ content: string; source: string }>
    try {
      rows = await rawQuery<{ content: string; source: string }>(
        `SELECT content, source
           FROM kb_chunks
          WHERE content ILIKE $1 OR source ILIKE $1
          ORDER BY LENGTH(content) DESC
          LIMIT 30`,
        [pattern],
      )
    } catch {
      return []
    }

    for (const row of rows) {
      const key = `${row.source}::${row.content.slice(0, 80)}`
      if (seen.has(key)) continue
      seen.add(key)
      const names = extractColumnNamesFromText(row.content)
      if (names.length < 3) continue
      let score = scoreChunkForStrategy(row.content, strategy) + names.length
      if (row.source.includes(strategy)) score += 4
      if (/横向比较/.test(row.source)) score += 3
      candidates.push({ names, score })
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  return candidates[0]?.names ?? []
}

export async function resolveTableFillColumnTemplates(): Promise<TableFillColumnTemplate[]> {
  const results: TableFillColumnTemplate[] = []

  for (const fallback of TABLE_FILL_COLUMN_TEMPLATE_FALLBACKS) {
    const kbColumns = await searchKbChunksForStrategy(fallback.name)
    if (kbColumns.length >= 3) {
      results.push({
        name: fallback.name,
        title: fallback.title,
        columns: kbColumns,
        source: "knowledge-base",
      })
    } else {
      results.push(fallback)
    }
  }

  return results
}
