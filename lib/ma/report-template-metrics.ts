export type MetricFormat = "text" | "percent" | "number" | "date" | "currency" | "integer"

export type MetricDef = {
  key: string
  label: string
  category: string
  format: MetricFormat
  period?: string
  description?: string
}

export type ProductFieldDef = {
  key: string
  label: string
  format: MetricFormat
  category: string
}

export const METRIC_CATALOG: MetricDef[] = [
  { key: "ret_1w", label: "近一周收益", category: "收益", format: "percent", period: "近一周" },
  { key: "ret_1m", label: "近一月收益", category: "收益", format: "percent", period: "近一月" },
  { key: "ret_3m", label: "近三月收益", category: "收益", format: "percent", period: "近三月" },
  { key: "ret_6m", label: "近六月收益", category: "收益", format: "percent", period: "近六月" },
  { key: "ret_1y", label: "近一年收益", category: "收益", format: "percent", period: "近一年" },
  { key: "ret_ytd", label: "今年以来收益", category: "收益", format: "percent", period: "今年以来" },
  { key: "ret_inception", label: "成立以来收益", category: "收益", format: "percent", period: "成立以来" },
  { key: "ann_ret_1y", label: "近一年年化收益", category: "收益", format: "percent", period: "近一年" },
  { key: "ann_ret_inception", label: "成立以来年化收益", category: "收益", format: "percent", period: "成立以来" },
  { key: "excess_ret_1y", label: "近一年超额收益", category: "收益", format: "percent", period: "近一年" },
  { key: "vol_1y", label: "近一年年化波动率", category: "风险", format: "percent", period: "近一年" },
  { key: "vol_inception", label: "成立以来年化波动率", category: "风险", format: "percent", period: "成立以来" },
  { key: "downside_vol_1y", label: "近一年下行波动率", category: "风险", format: "percent", period: "近一年" },
  { key: "max_dd_1y", label: "近一年最大回撤", category: "风险", format: "percent", period: "近一年" },
  { key: "max_dd_inception", label: "成立以来最大回撤", category: "风险", format: "percent", period: "成立以来" },
  { key: "max_dd_recovery_days", label: "最大回撤回补期(天)", category: "风险", format: "integer" },
  { key: "sharpe_1y", label: "近一年夏普比率", category: "风险调整", format: "number", period: "近一年", description: "基于净值自动计算" },
  { key: "calmar_1y", label: "近一年卡玛比率", category: "风险调整", format: "number", period: "近一年", description: "年化收益/最大回撤，基于净值自动计算" },
  { key: "sortino_1y", label: "近一年索提诺比率", category: "风险调整", format: "number", period: "近一年" },
  { key: "sharpe_inception", label: "成立以来夏普比率", category: "风险调整", format: "number", period: "成立以来" },
  { key: "calmar_inception", label: "成立以来卡玛比率", category: "风险调整", format: "number", period: "成立以来" },
  { key: "alpha_1y", label: "近一年 Alpha", category: "归因", format: "number", period: "近一年" },
  { key: "beta_1y", label: "近一年 Beta", category: "归因", format: "number", period: "近一年" },
  { key: "win_rate_1y", label: "近一年胜率", category: "统计", format: "percent", period: "近一年" },
  { key: "nav_latest", label: "最新单位净值", category: "净值", format: "number" },
  { key: "nav_date", label: "最新净值日期", category: "净值", format: "date" },
  { key: "nav_change", label: "最新涨跌幅", category: "净值", format: "percent" },
]

export const PRODUCT_FIELD_CATALOG: ProductFieldDef[] = [
  { key: "product_name", label: "产品名称", format: "text", category: "基本信息" },
  { key: "beian_hao", label: "备案编码", format: "text", category: "基本信息" },
  { key: "short_name", label: "产品简称", format: "text", category: "基本信息" },
  { key: "manager", label: "管理人", format: "text", category: "基本信息" },
  { key: "strategy_l1", label: "一级策略", format: "text", category: "基本信息" },
  { key: "strategy_l2", label: "二级策略", format: "text", category: "基本信息" },
  { key: "inception_date", label: "成立日期", format: "date", category: "基本信息" },
  { key: "scale", label: "产品规模", format: "currency", category: "基本信息" },
  { key: "custodian", label: "托管人", format: "text", category: "基本信息" },
]

export const METRIC_PRESETS: { id: string; label: string; keys: string[] }[] = [
  {
    id: "core_performance",
    label: "核心业绩指标",
    keys: ["ret_1w", "ret_1m", "ret_3m", "ret_6m", "ret_1y", "ret_inception"],
  },
  {
    id: "risk_adjusted",
    label: "风险调整指标",
    keys: ["sharpe_1y", "calmar_1y", "sortino_1y", "max_dd_1y", "vol_1y"],
  },
  {
    id: "full_nav",
    label: "净值全指标",
    keys: ["nav_latest", "nav_date", "nav_change", "ret_1y", "max_dd_1y", "sharpe_1y", "calmar_1y", "vol_1y"],
  },
  {
    id: "dd_risk",
    label: "回撤与风险",
    keys: ["max_dd_1y", "max_dd_inception", "max_dd_recovery_days", "vol_1y", "downside_vol_1y"],
  },
]

export function metricByKey(key: string): MetricDef | undefined {
  return METRIC_CATALOG.find((m) => m.key === key)
}

export function productFieldByKey(key: string): ProductFieldDef | undefined {
  return PRODUCT_FIELD_CATALOG.find((f) => f.key === key)
}

export function formatMetricPreview(format: MetricFormat): string {
  switch (format) {
    case "percent": return "12.34%"
    case "number": return "1.85"
    case "currency": return "1.23亿"
    case "date": return "2025-06-30"
    case "integer": return "128"
    default: return "示例"
  }
}
