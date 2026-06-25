export interface StyleFactorCatalogItem {
  code: string
  name: string
  unit_nav: string
  nav_date: string
}

const PERIODS = ["短期", "中期", "长期"] as const
const FACTORS = [
  "时间序列动量",
  "截面动量",
  "价值",
  "质量",
  "低波动",
  "流动性",
  "盈利",
  "成长",
  "杠杆",
  "规模",
  "反转",
  "残差动量",
  "偏度",
  "基差",
  "期限结构",
  "Carry",
  "波动率",
  "股息",
  "盈利质量",
  "投资",
] as const
const ASSETS = ["期货", "股票", "债券", "商品", "期权", "多资产"] as const

function hashNav(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return (1 + (Math.abs(h) % 4500) / 10000).toFixed(4)
}

function buildCatalog(): StyleFactorCatalogItem[] {
  const navDate = (() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return d.toISOString().slice(0, 10)
  })()

  const items: StyleFactorCatalogItem[] = []
  let id = 1
  for (const period of PERIODS) {
    for (const factor of FACTORS) {
      for (const asset of ASSETS) {
        if (items.length >= 118) return items
        const code = `SF${String(id).padStart(4, "0")}`
        const name = `${period}${factor}-${asset}`
        items.push({
          code,
          name,
          unit_nav: hashNav(code),
          nav_date: navDate,
        })
        id++
      }
    }
  }
  return items
}

export const STYLE_FACTOR_CATALOG: StyleFactorCatalogItem[] = buildCatalog()

export function filterStyleFactors(keyword: string) {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return STYLE_FACTOR_CATALOG
  return STYLE_FACTOR_CATALOG.filter(
    (item) =>
      item.code.toLowerCase().includes(kw)
      || item.name.toLowerCase().includes(kw),
  )
}

export function sortStyleFactors(
  rows: StyleFactorCatalogItem[],
  sort: string,
  dir: "asc" | "desc",
) {
  const factor = dir === "asc" ? 1 : -1
  return [...rows].sort((a, b) => {
    if (sort === "unit_nav") {
      return (parseFloat(a.unit_nav) - parseFloat(b.unit_nav)) * factor
    }
    if (sort === "nav_date") {
      return a.nav_date.localeCompare(b.nav_date, "zh-CN") * factor
    }
    return a.name.localeCompare(b.name, "zh-CN") * factor
  })
}
