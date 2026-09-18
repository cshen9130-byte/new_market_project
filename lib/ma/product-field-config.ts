export const PRODUCT_FIELD_TABS = ["基本信息", "申赎信息", "团队策略/标签/池", "净值信息", "团队字段", "其他"] as const

export const PRODUCT_FIELD_OPTIONS: Record<string, string[]> = {
  "基本信息": ["备案编码", "成立日期", "基金全称", "备案日期", "基准指数", "基金管理人", "管理人规模", "投资顾问", "托管券商", "平台一级策略", "平台二级策略", "平台三级策略"],
  "申赎信息": ["申购状态", "赎回状态", "申购费率", "赎回费率", "赎回费", "最低申购金额", "封闭期", "开放日", "管理费", "业绩报酬"],
  "团队策略/标签/池": ["团队一级策略", "团队二级策略", "团队三级策略", "团队标签", "所在跟踪池"],
  "净值信息": ["最新净值日期", "最新单位净值", "最新累计净值", "最新涨跌幅", "托管账户余额", "资产净值", "市值", "持仓市值(元)", "成立以来收益", "近两年收益", "近三年收益", "最大回撤", "年化收益", "年化波动率", "信息比率", "卡玛比率"],
  "团队字段": ["团队评级", "团队备注", "关注度"],
  "其他": ["产品规模", "基金托管人", "外部评级"],
}

export const PRODUCT_ELEMENT_FIELD_DEFAULT = ["开放日", "管理费", "业绩报酬", "赎回费"] as const
export const PRODUCT_FIELD_DEFAULT = ["最新净值日期", "最新单位净值", "最新涨跌幅", ...PRODUCT_ELEMENT_FIELD_DEFAULT] as const
export const MANAGED_FIELD_DEFAULT = ["最新净值日期", "最新单位净值", "最新涨跌幅", "托管账户余额", "资产净值"] as const
export const OPS_MANAGED_FIELD_DEFAULT = ["备案编码", "最新净值日期", "最新单位净值", "最新涨跌幅", "托管账户余额", "资产净值"] as const
export const FOF_FIELD_DEFAULT = ["最新净值日期", "最新单位净值", "最新涨跌幅", "市值", ...PRODUCT_ELEMENT_FIELD_DEFAULT] as const
export const DIRECT_FIELD_DEFAULT = ["备案编码", "最新单位净值", "最新净值日期", "最新涨跌幅", "持仓市值(元)"] as const
export const INV_DIRECT_FIELD_DEFAULT = ["最新净值日期", "最新单位净值", "市值"] as const
export const OPS_FOF_FIELD_DEFAULT = ["备案编码", "最新净值日期", "最新单位净值", "最新涨跌幅", ...PRODUCT_ELEMENT_FIELD_DEFAULT] as const

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
  "开放日": "open_day",
  "管理费": "fee_manage",
  "管理费说明": "fee_manage",
  "业绩报酬": "fee_pay",
  "业绩报酬说明": "fee_pay",
  "赎回费": "fee_redeem",
}

const ELEMENT_FIELDS_SEED_SUFFIX = ":seed_element_fields_v2"

function appendNewDefaultElementFields(
  storageKey: string,
  selected: string[],
  defaultFields: readonly string[],
): string[] {
  const flagKey = `${storageKey}${ELEMENT_FIELDS_SEED_SUFFIX}`
  try {
    if (localStorage.getItem(flagKey)) return selected
    const extras = PRODUCT_ELEMENT_FIELD_DEFAULT.filter(
      (f) => defaultFields.includes(f) && !selected.includes(f),
    )
    localStorage.setItem(flagKey, "1")
    if (extras.length === 0) return selected
    const next = [...selected, ...extras]
    localStorage.setItem(storageKey, JSON.stringify(next))
    return next
  } catch {
    return selected
  }
}

const LEGACY_PRODUCT_FIELD_LABELS: Record<string, string> = {
  "业绩报酬说明": "业绩报酬",
}

function normalizeProductFieldLabel(label: string): string {
  return LEGACY_PRODUCT_FIELD_LABELS[label] ?? label
}

function isPerfFeeField(label: string) {
  return label === "业绩报酬" || label === "业绩报酬说明"
}

export function readProductFieldConfig(storageKey: string, defaultFields: readonly string[]): string[] {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return [...defaultFields]
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...defaultFields]
    let remapped = false
    const mapped = parsed.map((f) => {
      if (typeof f !== "string") return f
      const next = normalizeProductFieldLabel(f)
      if (next !== f) remapped = true
      return next
    })
    const valid = uniqueKeepOrder(
      mapped.filter((f): f is string => typeof f === "string" && ALL_LABELS.has(f)),
    )
    if (valid.length > 0 && remapped) {
      writeProductFieldConfig(storageKey, valid)
    }
    const selected = valid.length > 0 ? valid : [...defaultFields]
    return appendNewDefaultElementFields(storageKey, selected, defaultFields)
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
    "开放日": pick("open_day"),
    "管理费": pick("fee_manage") || pick("fee_manage_rate"),
    "管理费说明": pick("fee_manage") || pick("fee_manage_rate"),
    "业绩报酬": pick("fee_pay"),
    "业绩报酬说明": pick("fee_pay"),
    "赎回费": pick("fee_redeem"),
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

export function isProductFieldLongText(label: string) {
  return label === "开放日" || label === "管理费" || label === "管理费说明" || isPerfFeeField(label) || label === "赎回费"
}

export function isProductFieldSummarized(label: string) {
  return label === "开放日" || label === "管理费" || label === "管理费说明" || isPerfFeeField(label) || label === "赎回费"
}

/** Fixed px width so short 要素 columns do not absorb leftover table space. */
export function productFieldColWidthPx(label: string): number {
  if (label === "管理费" || label === "管理费说明" || label === "赎回费") return 64
  if (label === "开放日") return 120
  if (isPerfFeeField(label)) return 76
  if (label === "最新单位净值") return 90
  if (label === "最新涨跌幅") return 88
  return 100
}

function uniqueKeepOrder(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

function formatPctNumber(n: number): string {
  const rounded = parseFloat(n.toFixed(2))
  return `${rounded}%`
}

/** Huofuniu-style fractions: 0.01 → 1%, 0.2 → 20%, 0.001 → 0.1%. */
export function formatBareFeeRate(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim()
  if (!s || !/^\d+(?:\.\d+)?$/.test(s)) return null
  const n = parseFloat(s)
  if (!Number.isFinite(n)) return null
  if (n === 0) return "0%"
  const pct = n <= 1 ? n * 100 : n
  if (pct < 0 || pct > 100) return null
  return formatPctNumber(pct)
}

function parseManageRate(rate: string | null | undefined): string | null {
  const rateText = String(rate ?? "").trim()
  if (!rateText) return null
  const hasPct = /[%％]/.test(rateText)
  const n = parseFloat(rateText.replace(/[%％]/g, ""))
  if (!Number.isFinite(n) || n === 0) return null
  if (hasPct) return formatPctNumber(n)
  const pct = n <= 1 ? n * 100 : n
  if (pct <= 0 || pct > 10) return null
  return formatPctNumber(pct)
}

function extractPercents(text: string): string[] {
  const out: string[] = []
  const re = /(\d+(?:\.\d+)?)\s*%/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const n = parseFloat(m[1])
    if (!Number.isFinite(n)) continue
    out.push(formatPctNumber(n))
  }
  return out
}

function weekdaysFrom(text: string): string[] {
  const compact = text.replace(/\s+/g, "")
  const weeklyHits = uniqueKeepOrder(
    [...compact.matchAll(/每(?:个自然)?周(?:的)?(?:周|星期)?([一二三四五六日天])/g)].map((m) => (m[1] === "天" ? "日" : m[1])),
  )
  if (weeklyHits.length >= 2) return weeklyHits
  const list = compact.match(
    /每周(?:的)?((?:周|星期)?[一二三四五六日天](?:[、,，和及](?:每)?(?:周|星期)?[一二三四五六日天])*)/,
  )
  if (list) {
    const days = [...list[1].matchAll(/[一二三四五六日天]/g)].map((m) => (m[0] === "天" ? "日" : m[0]))
    if (days.length) return uniqueKeepOrder(days)
  }
  const found: string[] = []
  const pairs: [RegExp, string][] = [
    [/周一|星期一/, "一"],
    [/周二|星期二/, "二"],
    [/周三|星期三/, "三"],
    [/周四|星期四/, "四"],
    [/周五|星期五/, "五"],
    [/周六|星期六/, "六"],
    [/周日|周天|星期日|星期天/, "日"],
  ]
  for (const [re, day] of pairs) {
    if (re.test(compact)) found.push(day)
  }
  return uniqueKeepOrder(found)
}

function summarizeMonthlyCalendarOpenDay(compact: string): string | null {
  if (!/每月|每自然月/.test(compact)) return null
  const days: string[] = []
  const seen = new Set<string>()
  const add = (raw: string) => {
    const n = parseInt(raw, 10)
    if (!Number.isFinite(n) || n < 1 || n > 31) return
    const d = String(n)
    if (seen.has(d)) return
    seen.add(d)
    days.push(d)
  }
  const numbered = compact.matchAll(/(?:每月|每自然月份?)(?:的)?(\d{1,2})\s*号|和(\d{1,2})\s*号/g)
  for (const match of numbered) {
    add(match[1] || match[2])
  }
  if (/每月最后(?:一个)?(?:交易|工作)日|每月最后一日/.test(compact)) add("31")
  if (!days.length) return null
  return `每月${days.join("，")}日`
}

function stripOpenDayPoolJunk(raw: string): string {
  return raw
    .replace(/FOF投资产品池/g, "")
    .replace(/^[；;、,\s]+|[；;、,\s]+$/g, "")
    .trim()
}

function firstClause(text: string, max = 16): string {
  const first = text.split(/[。；;\n]/)[0].replace(/\s+/g, "").trim()
  if (!first) return text.trim()
  return first.length > max ? `${first.slice(0, max)}…` : first
}

export function summarizeOpenDay(raw: string | null | undefined): string | null {
  const s = stripOpenDayPoolJunk(String(raw ?? "").trim())
  if (!s) return null
  const compact = s.replace(/\s+/g, "")
  if (/每个交易日|每日开放|每个工作日/.test(compact) && !/每周/.test(compact)) {
    return "每个交易日"
  }
  if (/每(?:个自然)?周的?最后/.test(compact) && /(?:工作|交易)日/.test(compact)) {
    return "每周五"
  }
  const firstOfWeek = compact.match(
    /每(?:个自然)?周(?:的)?第([一二三四五1-5])个(?:交易|工作)日/,
  )
  if (firstOfWeek?.[1]) {
    const nth: Record<string, string> = {
      一: "一",
      二: "二",
      三: "三",
      四: "四",
      五: "五",
      "1": "一",
      "2": "二",
      "3": "三",
      "4": "四",
      "5": "五",
    }
    const day = nth[firstOfWeek[1]]
    if (day) return `每周${day}`
  }
  const nthWork = compact.match(/每周的?第([0-9、,，和\-至到]+)个工作日/)
  if (nthWork) return `每周第${nthWork[1].replace(/[和]/g, "、")}个工作日`
  const monthly = summarizeMonthlyCalendarOpenDay(compact)
  if (monthly) return monthly

  const sub = compact.match(/申购开放日[^。]{0,100}/)?.[0] ?? ""
  const red = compact.match(/赎回开放日[^。]{0,100}/)?.[0] ?? ""
  if (sub && red) {
    const subDays = weekdaysFrom(sub)
    if (subDays.length) return `每周${subDays.join("、周")}`
  }

  const days = weekdaysFrom(compact)
  if (days.length) return `每周${days.join("、周")}`
  if (/每(?:自然)?季度|每季/.test(compact)) {
    const nthNatural = compact.match(/第([0-9一二三四五六七八九十]+)个自然日/)
    if (nthNatural) return `每季首月第${nthNatural[1]}日`
    const nthTrade = compact.match(/第([0-9一二三四五六七八九十]+)个(?:交易|工作)日/)
    if (nthTrade) return `每季第${nthTrade[1]}个交易日`
  }
  if (!/开放|每周|每月|每季|交易日|工作日|申购|赎回|预约/.test(compact)) return null
  return firstClause(s)
}

export function summarizeManageFee(
  full: string | null | undefined,
  rate: string | null | undefined,
): string | null {
  const fromRate = parseManageRate(rate)
  if (fromRate) return fromRate
  const s = String(full ?? "").trim()
  if (!s) return null
  const classRates: string[] = []
  const cre = /([ABC])类[^。%；;\n]{0,28}?(\d+(?:\.\d+)?)\s*%/g
  let cm: RegExpExecArray | null
  while ((cm = cre.exec(s)) !== null) {
    classRates.push(`${cm[1]}${formatPctNumber(parseFloat(cm[2]))}`)
  }
  const uniqClass = uniqueKeepOrder(classRates)
  if (uniqClass.length >= 2) return uniqClass.join("/")
  const pcts = extractPercents(s)
  if (pcts.length) return pcts[0]
  const bare = formatBareFeeRate(s)
  if (bare) return bare
  return firstClause(s, 10)
}

export function summarizeRedeemFee(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim()
  if (!s) return null
  const compact = s.replace(/\s+/g, "")
  const bare = formatBareFeeRate(s)
  if (bare) return bare
  if (/^0%$/.test(compact) || compact === "0") return "0%"
  if (
    /不收取赎回费|不设置赎回费|免赎回费|无赎回费|赎回费率为?零/.test(compact)
    && !/持有/.test(compact)
  ) {
    return "0%"
  }
  const pcts = uniqueKeepOrder(extractPercents(s))
  if (pcts.length === 1) return pcts[0]
  if (pcts.length > 1) return pcts.slice(0, 3).join("/")
  if (/免/.test(s)) return "0%"
  return firstClause(s, 10)
}

export function summarizePerfFee(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim()
  if (!s) return null
  const compact = s.replace(/\s+/g, "")
  const noneRe = /不收取业绩报酬|不计提业绩报酬|不提取业绩报酬|无业绩报酬/
  const classBits: string[] = []
  for (const cls of ["A", "B", "C"] as const) {
    const chunkRe = new RegExp(`${cls}类[^。；;]*`, "g")
    let chunk = ""
    let cm: RegExpExecArray | null
    while ((cm = chunkRe.exec(compact)) !== null) chunk += cm[0]
    if (!chunk) continue
    if (/不收取|不计提|不提取/.test(chunk) && !/(?:计提比例|提取比例)\s*[为是：:]*\s*\d/.test(chunk)) {
      classBits.push(`${cls}不收取`)
      continue
    }
    const rate = chunk.match(/(?:计提比例|提取比例|超额计提)\s*[为是：:]*\s*[【[]?\s*(\d+(?:\.\d+)?)\s*%/)
      || chunk.match(/(\d+(?:\.\d+)?)\s*%/)
    if (rate) {
      classBits.push(`${cls}${formatPctNumber(parseFloat(rate[1]))}`)
      continue
    }
    if (/收取业绩报酬|计提业绩报酬/.test(chunk)) classBits.push(`${cls}收取`)
  }
  const uniqClass = uniqueKeepOrder(classBits)
  if (uniqClass.length >= 2) return uniqClass.join("/")
  if (uniqClass.length === 1 && /不收取|收取/.test(uniqClass[0])) return uniqClass[0]

  const rates: string[] = []
  const rateRe = /(?:计提比例|提取比例|超额(?:部分)?计提|超额计提)\s*[为是：:]*\s*[【[]?\s*(\d+(?:\.\d+)?)\s*%/g
  let rm: RegExpExecArray | null
  while ((rm = rateRe.exec(compact)) !== null) {
    rates.push(formatPctNumber(parseFloat(rm[1])))
  }
  if (rates.length === 0) {
    const alt = compact.match(/(?:提取全部收益的|净收益的|计提比例为|提取比例为)\s*(\d+(?:\.\d+)?)\s*%/)
    if (alt) rates.push(formatPctNumber(parseFloat(alt[1])))
  }
  const uniqRates = uniqueKeepOrder(rates)
  if (uniqRates.length === 1) return uniqRates[0]
  if (uniqRates.length > 1) return uniqRates.slice(0, 3).join("/")

  const pcts = extractPercents(s)
  const carryLike = pcts.filter((p) => {
    const n = parseFloat(p)
    return n >= 10 && n <= 80
  })
  const uniqCarry = uniqueKeepOrder(carryLike)
  if (uniqCarry.length === 1) return uniqCarry[0]
  if (uniqCarry.length > 1) return uniqCarry.slice(0, 3).join("/")
  if (uniqClass.length === 1) return uniqClass[0]
  if (pcts.length) return pcts[0]
  if (noneRe.test(compact)) return "不收取"
  const bare = formatBareFeeRate(s)
  if (bare) return bare
  return firstClause(s, 12)
}

export function getProductFieldDisplay(
  row: Record<string, unknown>,
  label: string,
): { short: string | null; detail: string | null } {
  const detail = getProductFieldTextValue(row, label)
  const pick = (key: string) => {
    const val = row[key]
    if (val == null || val === "") return null
    return String(val)
  }
  if (label === "开放日") {
    return { short: summarizeOpenDay(detail), detail }
  }
  if (label === "管理费" || label === "管理费说明") {
    const short = summarizeManageFee(pick("fee_manage"), pick("fee_manage_rate"))
    const raw = pick("fee_manage") || pick("fee_manage_rate")
    return { short, detail: formatBareFeeRate(raw) || raw }
  }
  if (label === "赎回费") {
    const short = summarizeRedeemFee(detail)
    return { short, detail: formatBareFeeRate(detail) || detail }
  }
  if (isPerfFeeField(label)) {
    const short = summarizePerfFee(detail)
    return { short, detail: formatBareFeeRate(detail) || detail }
  }
  return { short: detail, detail }
}
