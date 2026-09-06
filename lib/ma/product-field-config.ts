export const PRODUCT_FIELD_TABS = ["基本信息", "申赎信息", "团队策略/标签/池", "净值信息", "团队字段", "其他"] as const

export const PRODUCT_FIELD_OPTIONS: Record<string, string[]> = {
  "基本信息": ["备案编码", "成立日期", "基金全称", "备案日期", "基准指数", "基金管理人", "管理人规模", "投资顾问", "托管券商", "平台一级策略", "平台二级策略", "平台三级策略"],
  "申赎信息": ["申购状态", "赎回状态", "申购费率", "赎回费率", "最低申购金额", "封闭期"],
  "团队策略/标签/池": ["团队一级策略", "团队二级策略", "团队三级策略", "团队标签", "所在跟踪池"],
  "净值信息": ["最新净值日期", "最新单位净值", "最新累计净值", "最新涨跌幅", "托管账户余额", "资产净值", "市值", "持仓市值(元)", "成立以来收益", "近两年收益", "近三年收益", "最大回撤", "年化收益", "年化波动率", "信息比率", "卡玛比率"],
  "团队字段": ["团队评级", "团队备注", "关注度"],
  "其他": ["产品规模", "基金托管人", "外部评级"],
}

export const PRODUCT_FIELD_DEFAULT = ["最新净值日期", "最新单位净值", "最新涨跌幅"] as const
export const MANAGED_FIELD_DEFAULT = ["最新净值日期", "最新单位净值", "最新涨跌幅", "托管账户余额", "资产净值"] as const
export const OPS_MANAGED_FIELD_DEFAULT = ["备案编码", "最新净值日期", "最新单位净值", "最新涨跌幅", "托管账户余额", "资产净值"] as const
export const FOF_FIELD_DEFAULT = ["最新净值日期", "最新单位净值", "最新涨跌幅", "市值"] as const
export const DIRECT_FIELD_DEFAULT = ["备案编码", "最新单位净值", "最新净值日期", "最新涨跌幅", "持仓市值(元)"] as const
export const INV_DIRECT_FIELD_DEFAULT = ["最新净值日期", "最新单位净值", "市值"] as const
export const OPS_FOF_FIELD_DEFAULT = ["备案编码", "最新净值日期", "最新单位净值", "最新涨跌幅"] as const

export const FIELD_CONFIG_STORAGE_KEYS = {
  tracking: "tracking_field_config_selected",
  invActive: "inv_active_field_config_selected",
  opsActive: "ops_active_field_config_selected",
  invFof: "inv_fof_field_config_selected",
  invDirect: "inv_direct_field_config_selected",
  opsDirect: "ops_direct_field_config_selected",
  opsFof: "ops_fof_field_config_selected",
} as const

const ALL_LABELS = new Set<string>([
  ...PRODUCT_FIELD_DEFAULT,
  ...MANAGED_FIELD_DEFAULT,
  ...OPS_MANAGED_FIELD_DEFAULT,
  ...FOF_FIELD_DEFAULT,
  ...DIRECT_FIELD_DEFAULT,
  ...OPS_FOF_FIELD_DEFAULT,
  ...INV_DIRECT_FIELD_DEFAULT,
  ...Object.values(PRODUCT_FIELD_OPTIONS).flat(),
])

export const PRODUCT_FIELD_SORT_KEYS: Record<string, string> = {
  "最新净值日期": "latest_nav_date",
  "最新单位净值": "latest_nav",
  "最新累计净值": "cumulative_nav",
  "最新涨跌幅": "latest_price_change",
  "备案编码": "beian_hao",
  "基金全称": "product_name",
  "托管账户余额": "custody_balance",
  "资产净值": "net_asset_value",
  "市值": "market_value",
  "持仓市值(元)": "holding_mv",
  "持仓份额": "holding_shares",
}

export function readProductFieldConfig(storageKey: string, defaultFields: readonly string[]): string[] {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return [...defaultFields]
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...defaultFields]
    const valid = parsed.filter(
      (f): f is string => typeof f === "string" && ALL_LABELS.has(f),
    )
    return valid.length > 0 ? valid : [...defaultFields]
  } catch {
    return [...defaultFields]
  }
}

export function writeProductFieldConfig(storageKey: string, fields: string[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(fields))
  } catch { /* ignore quota */ }
}

/** Row-shaped object from list APIs (tracking, managed, FOF, direct). */
export function getProductFieldTextValue(row: Record<string, unknown>, label: string): string | null {
  const pick = (key: string) => {
    const val = row[key]
    if (val == null || val === "") return null
    return String(val)
  }
  const values: Record<string, string | null> = {
    "最新净值日期": pick("latest_nav_date"),
    "最新单位净值": pick("latest_nav"),
    "最新累计净值": pick("cumulative_nav"),
    "最新涨跌幅": pick("latest_price_change"),
    "备案编码": pick("beian_hao"),
    "基金全称": pick("product_name"),
    "成立日期": pick("inception_date"),
    "基金管理人": pick("manager"),
    "平台一级策略": pick("platform_strategy_l1"),
    "平台二级策略": pick("platform_strategy_l2"),
    "平台三级策略": pick("platform_strategy_l3"),
    "团队一级策略": pick("company_strategy_l1"),
    "团队二级策略": pick("company_strategy_l2"),
    "团队三级策略": pick("company_strategy_l3"),
    "托管账户余额": pick("custody_balance"),
    "资产净值": pick("net_asset_value"),
    "市值": pick("market_value"),
    "持仓市值(元)": pick("holding_mv"),
    "持仓份额": pick("holding_shares"),
    "估值表日期": pick("valuation_date"),
  }
  return values[label] ?? null
}

/** Split configurable columns around a total/summary column for footer rows. */
export function fieldConfigSplitAround(
  fields: readonly string[],
  totalLabel: string,
): { before: number; hasTotal: boolean; after: number } {
  const idx = fields.indexOf(totalLabel)
  if (idx < 0) return { before: fields.length, hasTotal: false, after: 0 }
  return { before: idx, hasTotal: true, after: fields.length - idx - 1 }
}

export function isProductFieldPct(label: string) {
  return label === "最新涨跌幅"
}

export function isProductFieldMoney(label: string) {
  return label === "托管账户余额" || label === "资产净值" || label === "市值" || label === "持仓市值(元)"
}

export function isProductFieldNav(label: string) {
  return label === "最新单位净值" || label === "最新累计净值"
}
