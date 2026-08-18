/** Compact keyword extractors. Never return contract-chapter dumps. */

const RISK_LABEL: Record<string, string> = {
  R1: "低风险",
  R2: "中低风险",
  R3: "中风险",
  R4: "中高风险",
  R5: "高风险",
}

const RISK_GRADE_FROM_LABEL: Record<string, string> = {
  低风险: "R1",
  中低风险: "R2",
  中风险: "R3",
  中高风险: "R4",
  高风险: "R5",
}

const LOCK_MAX = 80
const FEE_DESC_MAX = 90
const FORMULA_MAX = 220
const SHORT_MAX = 80

const DUMP_RE =
  /--\s*\d+\s*of\s*\d+\s*--|不可抗力|形式监督|费用的种类|基金费用的种类|划款指令|收费账户|计算方法如下|H\s*[=＝]\s*[E年]|代码：|申购申请及确认|洗钱风险|客户身份识别|可疑交易|强制赎回份额不受|可以在基金财产中列支|费用计提方法|私募办法/

function collapseWs(value: string): string {
  return value.replace(/\u0000/g, "").replace(/[ \t\u00a0]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()
}

function isDumpText(value: string, maxChars: number): boolean {
  const s = value.trim()
  if (!s) return true
  if (s.length > maxChars) return true
  if (DUMP_RE.test(s)) return true
  if ((s.match(/。/g) || []).length >= 3) return true
  if (/\(\s*\d+\s*\)|（\s*\d+\s*）/.test(s) && s.length > 60) return true
  return false
}

/** One line, fullwidth percent normalized. PDF extracts are full of newlines inside sentences. */
function flatten(text: string): string {
  return collapseWs(text.replace(/[\r\n]+/g, " ")).replace(/％/g, "%")
}

function nearby(text: string, index: number, before: number, after: number): string {
  return text.slice(Math.max(0, index - before), Math.min(text.length, index + after))
}

function looksLikeToc(text: string, index: number): boolean {
  const after = text.slice(index, Math.min(text.length, index + 60)).replace(/\s+/g, "")
  return /[.…·]{2,}\d{1,3}$/.test(after)
}

function looksLikeGlossary(text: string, index: number): boolean {
  const before = nearby(text, index, 12, 0)
  return /\d{1,3}[、.．]\s*$/.test(before) || /释义|定义/.test(nearby(text, index, 80, 20))
}

function pct(raw: string): string {
  const n = parseFloat(raw.replace(/[％%\s]/g, ""))
  if (!Number.isFinite(n)) return `${raw.replace(/％/g, "%")}%`.replace(/%%$/, "%")
  return `${n}%`
}

function payPhrase(text: string): string | null {
  if (/按自然季度支付|按季度支付|按季支付/.test(text)) return "按自然季度支付"
  if (/按月支付|按自然月支付/.test(text)) return "按月支付"
  if (/按年支付|按自然年支付/.test(text)) return "按年支付"
  return null
}

function compactFeeLine(rateLabel: string, rateRaw: string, scope: string): string {
  const bits = [`${rateLabel}${pct(rateRaw)}`]
  if (/每日计提/.test(scope)) bits.push("每日计提")
  const pay = payPhrase(scope)
  if (pay) bits.push(pay)
  return `${bits.join("，")}。`
}

export function isWeakRiskLevel(value: string | null | undefined): boolean {
  const s = (value ?? "").trim()
  if (!s) return true
  if (/^C[1-5]\b/.test(s)) return true
  if (/^—+$/.test(s) || s === "无" || s === "详见合同") return true
  if (/期货是一种高风险|私募基金风险评级标准/.test(s)) return true
  return isDumpText(s, 40)
}

export function isWeakLockPeriod(value: string | null | undefined): boolean {
  const s = (value ?? "").trim()
  if (!s || s === "—" || s === "无" || s === "无锁定期" || /^详见/.test(s)) return true
  if (/针对每一基金份额设有限制赎回的期限|不可抗力|形式监督|开放取消/.test(s)) return true
  if (/申购申请及确认|私募办法|风险揭示书|强制赎回份额不受/.test(s)) return true
  if (/临时开放|固定开放日/.test(s) && !/^(不设置|无|无锁定期)$/.test(s)) return true
  return isDumpText(s, LOCK_MAX)
}

export function isWeakFormula(value: string | null | undefined): boolean {
  const s = (value ?? "").trim()
  if (!s) return true
  if (/^详见|^见合同|^同上|^—+$/.test(s)) return true
  if (/与基金运作有关的费用|基金的管理费；|费用的种类|托管费年费率/.test(s)) return true
  if (/^(商解决|划款|账册记录)/.test(s)) return true
  if (s.length < 12 && !/[=＝]/.test(s) && !/计提|提取|公式/.test(s)) return true
  return isDumpText(s, FORMULA_MAX)
}

export function isWeakFeePay(value: string | null | undefined): boolean {
  const s = (value ?? "").trim()
  if (!s || s === "—" || /^详见/.test(s)) return true
  return isDumpText(s, 90)
}

export function isWeakFeeManage(value: string | null | undefined): boolean {
  const s = (value ?? "").trim()
  if (!s || s === "—" || /^详见/.test(s)) return true
  return isDumpText(s, FEE_DESC_MAX)
}

export function summarizeFeePayDesc(text: string): string | null {
  const { bench, rate } = formulaBenchRate(text)
  if (!bench && !rate) return null
  const bits = ["按业绩基准计提"]
  if (bench) bits.push(`业绩基准${bench}`)
  if (rate) bits.push(`计提比例${rate}`)
  return `${bits.join("，")}。`.slice(0, 90)
}

export function isWeakAddAmount(value: string | null | undefined): boolean {
  const s = (value ?? "").trim()
  return !s || s === "—" || /^详见/.test(s) || isDumpText(s, 120)
}

export function isWeakShortFee(value: string | null | undefined): boolean {
  const s = (value ?? "").trim()
  if (!s || s === "—" || s === "无" || /^详见/.test(s)) return true
  return isDumpText(s, SHORT_MAX)
}

export function isWeakTemporaryOpen(value: string | null | undefined): boolean {
  const s = (value ?? "").trim()
  if (!s) return true
  return /^-?\d+$/.test(s)
}

export function extractRiskLevelFromText(text: string): string | null {
  const source = flatten(text)
  const patterns: Array<{ re: RegExp; grade: number; label?: number }> = [
    { re: /本基金属于\s*(R[1-5])\s*[（(]([^)）]{1,16})[)）]/g, grade: 1, label: 2 },
    { re: /属于\s*(R[1-5])\s*[（(]([^)）]{0,16}风险[^)）]*)[)）]/g, grade: 1, label: 2 },
    { re: /风险等级为\s*[\[【（(]?\s*(R[1-5])\s*[\]】）)]?/gi, grade: 1 },
    { re: /风险等级[为是：:\s]*[（(\[【]?(R[1-5])[)）\]】]?/g, grade: 1 },
    { re: /风险评级[为是：:\s]*[\[【（(]?(R[1-5])[\]】）)]?/g, grade: 1 },
    { re: /(R[1-5])\s*级\s*[（(](中高风险|中低风险|高风险|低风险|中风险)[)）]/g, grade: 1, label: 2 },
    { re: /(R[1-5])\s*[（(](中高风险|中低风险|高风险|低风险|中风险)[)）]/g, grade: 1, label: 2 },
    { re: /本基金.{0,40}?(R[1-5]).{0,16}?投资品种/g, grade: 1 },
    { re: /(?:本基金为|本基金风险为)\s*(R[1-5])/g, grade: 1 },
  ]

  for (const pattern of patterns) {
    const re = new RegExp(pattern.re.source, "gi")
    let match: RegExpExecArray | null
    while ((match = re.exec(source)) !== null) {
      if (looksLikeToc(source, match.index)) continue
      const ctx = nearby(source, match.index, 40, 40)
      if (/期货是一种高风险|私募基金风险评级标准|洗钱|身份识别|可疑交易|反洗钱|投资者适当性/.test(ctx)) continue
      const grade = (match[pattern.grade] ?? "").toUpperCase()
      if (!/^R[1-5]$/.test(grade)) continue
      const rawLabel = pattern.label ? (match[pattern.label] ?? "").trim() : ""
      const label = rawLabel.replace(/[（）()\s]/g, "") || RISK_LABEL[grade]
      return label ? `${grade}（${label}）` : grade
    }
  }

  const named = source.match(/本基金属于\s*(中高风险|中低风险|高风险|低风险|中风险)/)
    || source.match(/本基金为\s*(中高风险|中低风险|高风险|低风险|中风险)\s*投资/)
    || source.match(/本基金的?风险等级为\s*(中高风险|中低风险|高风险|低风险|中风险)/)
  if (named?.[1]) {
    const label = named[1]
    const grade = RISK_GRADE_FROM_LABEL[label]
    return grade ? `${grade}（${label}）` : label
  }
  return null
}

export function extractLockPeriodFromText(text: string): string | null {
  const s = flatten(text)
  if (/份额锁定期\s*[:：]?\s*(不设置|无|无锁定期)/.test(s)) return "不设置"

  const soft = s.match(/软锁\s*(\d+)\s*个?月/)
  if (soft) return `软锁${soft[1]}个月`

  const hold = s.match(
    /(?:基金份额持有人)?持有基金份额自份额确认日起不满\s*[【\[［]?\s*(\d+)\s*[】\]］]?\s*个?月的不得赎回/,
  ) || s.match(/自(?:份额)?(?:申购)?确认日[起始]?不满\s*[【\[［]?\s*(\d+)\s*[】\]］]?\s*个?月的不得赎回/)
  if (hold?.[1]) return `份额确认日起不满${hold[1].replace(/\s/g, "")}个月不得赎回`

  const months = s.match(/锁定[期限][^。]{0,24}?[为是：:]\s*[【\[［]?\s*(\d+)\s*[】\]］]?\s*个?月/)
    || s.match(/锁定期[限]?\s*[为是：:]?\s*[【\[［]?\s*(\d+)\s*[】\]］]?\s*个?月/)
  if (months?.[1] && !/流通受限|限售|股票|估值/.test(nearby(s, months.index ?? 0, 40, 40))) {
    const idx = months.index ?? 0
    if (!looksLikeGlossary(s, idx) && !/针对每一基金份额设有限制赎回/.test(nearby(s, idx, 20, 40))) {
      return `${months[1].replace(/\s/g, "")}个月`
    }
  }

  const redeemSoft = s.match(
    /持有时间\s*(?:小于|不足|少于)\s*(\d+)\s*个?(?:自然日|天)赎回费率[为是]?\s*([\d.]+)\s*%/,
  )
  if (redeemSoft) {
    return `不设置硬锁；持有不足${redeemSoft[1]}天赎回费${pct(redeemSoft[2])}`
  }

  if (/不(?:设|设置|设定)\s*锁定期|无锁定期/.test(s)) return "不设置"
  if (/锁定期\s*[（(]如有[)）]/.test(s)) return "不设置"
  return null
}

function formulaBenchRate(scope: string): { bench: string | null; rate: string | null } {
  const s = flatten(scope)
  const bench =
    s.match(/计提基准为年化\s*([\d.]+)\s*%/)
    || s.match(/业绩(?:报酬)?(?:计提)?基准[为是：:]\s*([\d.]+)\s*%/)
    || s.match(/年化收益率\s*R\s*(?:小于或等于|小于等于|不高于|不超过|≤|<=|<)\s*([\d.]+)\s*%/)
    || s.match(/R\s*(?:小于或等于|小于等于|≤|<=)\s*([\d.]+)\s*%/)
    || s.match(/R\s*>\s*([\d.]+)\s*%/)
  const rate =
    s.match(/(?:提取比例|计提比例)\s*[（(]?\s*X?\s*[)）]?\s*[为是：:]*\s*[【[]?\s*([\d.]+)\s*[】]]?\s*%/)
    || s.match(/差额收益按\s*[【[]?\s*([\d.]+)\s*[】]]?\s*%/)
    || s.match(/按\s*[【[]?\s*([\d.]+)\s*[】]]?\s*%\s*比例/)
    || s.match(/(?:超额|正收益|全部正收益)[^。]{0,12}提取\s*[【[]?\s*([\d.]+)\s*[】]]?\s*%/)
    || s.match(/提取\s*[【[]?\s*([\d.]+)\s*[】]]?\s*%/)
    || s.match(/全部正收益提取\s*([\d.]+)/)
  return {
    bench: bench?.[1] ? pct(bench[1]) : null,
    rate: rate?.[1] ? pct(rate[1]) : null,
  }
}

function cleanEquation(eq: string): string | null {
  const s = collapseWs(eq).replace(/％/g, "%")
  if (!s || /[\uFFFD]/.test(s)) return null
  if (s.length > 80) return null
  if (!/[=＝]/.test(s)) return null
  const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length
  if (cjk > 4) return null
  if (/实际业绩报酬提取值|计算方法如下/.test(s)) return null
  return s
}

function firstEquation(scope: string, pattern: RegExp): string | null {
  const m = scope.match(pattern)
  if (!m) return null
  return cleanEquation(m[0].split(/其中/)[0])
}

function formulaEquations(scope: string): string | null {
  const s = flatten(scope)
  const parts: string[] = []
  const cleanR = firstEquation(s, /R\s*[=＝]\s*[^。；;]{8,72}/)
  const cleanY = firstEquation(s, /Y\s*[=＝]\s*[^。；;]{8,72}/)
  const cleanE = firstEquation(s, /E\s*[=＝]\s*K[^。；;]{0,72}/)
  if (cleanR && !/托管费|管理费|运营服务费/.test(cleanR)) parts.push(cleanR)
  if (cleanY) parts.push(cleanY)
  if (cleanE) parts.push(cleanE)

  const { bench, rate } = formulaBenchRate(s)
  const head: string[] = []
  if (bench) head.push(`基准${bench}`)
  if (rate) head.push(`超额计提${rate}`)
  const summary = [...head, ...parts].filter(Boolean)
  if (!summary.length) return null
  return summary.join("；").slice(0, FORMULA_MAX)
}

export function extractFeePayFormulaFromText(text: string): string | null {
  const s = flatten(text)
  const starts: number[] = []
  const re = /业绩报酬计提方法|业绩报酬的计算|业绩报酬的?计算公式|业绩报酬计提基准为|基金的业绩报酬(?!；)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(s)) !== null) {
    if (looksLikeToc(s, match.index) || looksLikeGlossary(s, match.index)) continue
    const ctx = nearby(s, match.index, 30, 40)
    if (/临时开放|费用的种类|基金的管理费；/.test(ctx)) continue
    starts.push(match.index)
  }
  for (const start of starts) {
    const scope = s.slice(start, start + 1800)
    if (/托管费年费率|运营服务费年费率/.test(scope.slice(0, 120)) && !/年化收益率/.test(scope.slice(0, 400))) {
      continue
    }
    const cut = scope.split(/业绩报酬的支付|5[、.]\s*本基金的证券账户/)[0]
    const compact = formulaEquations(cut)
    if (compact) return compact
  }

  const y = s.match(/Y\s*[=＝]\s*F\s*[×x*]\s*\([^)]{3,40}\)\s*[×x*]\s*W/)
  if (y) {
    const around = nearby(s, y.index ?? 0, 80, 120)
    const x = around.match(/提取比例[^。]{0,12}[【\[]?(\d+)[】\]]?\s*%/)
    return [x ? `提取比例${x[1]}%` : null, collapseWs(y[0])].filter(Boolean).join("；")
  }

  const fallbackIdx = s.search(/年化收益率\s*R|Y\s*[=＝]\s*F|E\s*[=＝]\s*K/)
  if (fallbackIdx >= 0) {
    const compact = formulaEquations(s.slice(Math.max(0, fallbackIdx - 240), fallbackIdx + 900))
    if (compact) return compact
  }
  return null
}

function shareClassManageRates(text: string): string | null {
  const s = flatten(text)
  const parts: string[] = []
  const re = /([ABC])类[^。；;]{0,48}?年(?:化)?管理费率\s*([\d.]+)\s*%/g
  let match: RegExpExecArray | null
  while ((match = re.exec(s)) !== null) {
    const line = `${match[1]}类年管理费率${pct(match[2])}`
    if (!parts.includes(line)) parts.push(line)
  }
  return parts.length ? `${parts.join("；")}` : null
}

function rateFromHint(hint: string | null | undefined): string | null {
  const s = String(hint ?? "").trim()
  if (!s) return null
  const pctMatch = s.match(/([\d.]+)\s*%/)
  if (pctMatch) return `年管理费率${pct(pctMatch[1])}`
  const n = parseFloat(s)
  if (!Number.isFinite(n) || n === 0) return null
  const pctVal = n > 0 && n <= 1 ? n * 100 : n
  if (pctVal > 10) return null
  return `年管理费率${pctVal}%`
}

export function summarizeFeeManageDesc(
  text: string,
  existing?: string | null,
  rateHint?: string | null,
): string | null {
  const source = flatten(`${text}\n${existing ?? ""}`)
  const classRates = shareClassManageRates(source)
  const found = matchAnnualFeeRate(source, ["管理费"])
  const loose = source.match(/年(?:化)?管理费率[^。%]{0,48}?(\d+(?:\.\d+)?)\s*%/)
    || source.match(/(\d+(?:\.\d+)?)\s*%[^。]{0,20}年(?:化)?管理费率/)
  const looseOk = loose?.[1] && parseFloat(loose[1]) <= 5 ? `年管理费率${pct(loose[1])}` : null
  const rate = classRates || (found ? `年管理费率${pct(found.raw)}` : null) || looseOk || rateFromHint(rateHint)
  if (!rate) return null
  const bits = [rate]
  if (/每日计提/.test(source)) bits.push("每日计提")
  const pay = payPhrase(source)
  if (pay) bits.push(pay)
  return `${bits.join("，")}。`.slice(0, FEE_DESC_MAX)
}

export function extractFeeManageDescFromText(text: string): string | null {
  return summarizeFeeManageDesc(text)
}

function matchAnnualFeeRate(text: string, names: string[]): { raw: string; index: number; matched: string } | null {
  const s = flatten(text)
  const num = `[【\\[［]?\\s*([\\d.]+)\\s*[】\\]］]?\\s*%`
  for (const name of names) {
    const patterns = [
      new RegExp(`年(?:化)?${name}率[为是：:\\s]*${num}`),
      new RegExp(`${name}年费率[为是：:\\s]*${num}`),
      new RegExp(`${name}率为年费率\\s*${num}`),
      new RegExp(`${name}按基金资产净值的\\s*${num}`),
    ]
    for (const re of patterns) {
      const m = re.exec(s)
      if (m?.[1]) return { raw: m[1], index: m.index ?? 0, matched: m[0] }
    }
  }
  return null
}

export function extractFeeTrustFromText(text: string): string | null {
  const m = matchAnnualFeeRate(text, ["托管费"])
  if (!m) return null
  const scope = flatten(text).slice(Math.max(0, m.index), m.index + 1200)
  return compactFeeLine("年托管费率", m.raw, scope)
}

export function extractFeeAdminFromText(text: string): string | null {
  const m = matchAnnualFeeRate(text, ["运营服务费", "外包服务费", "外包费", "行政服务费", "基金服务费"])
  if (!m) return null
  const scope = flatten(text).slice(Math.max(0, m.index), m.index + 1200)
  const label = /外包/.test(m.matched)
    ? "年外包费率"
    : /行政/.test(m.matched)
      ? "年行政服务费率"
      : /基金服务费/.test(m.matched)
        ? "年基金服务费率"
        : "年运营服务费率"
  return compactFeeLine(label, m.raw, scope)
}

export function extractFeeRedeemFromText(text: string): string | null {
  const s = flatten(text)
  const band = s.match(
    /持有时间\s*(?:小于|不足|少于)\s*(\d+)\s*个?(?:自然日|天)[^。]{0,40}赎回费率[为是]?\s*([\d.]+)\s*%[^。]{0,160}赎回费率[为是]?\s*([\d.]+)\s*%/,
  ) || s.match(
    /持有期限\s*(?:小于|不足|少于)\s*(\d+)\s*个?(?:自然日|天)[^。]{0,40}([\d.]+)\s*%[^。]{0,80}(?:大于|满|不少于)\s*\1[^。]{0,40}([\d.]+)\s*%/,
  )
  if (band) {
    return `持有不足${band[1]}天赎回费${pct(band[2])}，满${band[1]}天${pct(band[3])}。`
  }
  const classes: string[] = []
  const classRe = /([ABC])类份额[^。]{0,80}赎回费率[^。]{0,40}?([\d.]+)\s*%/g
  let cm: RegExpExecArray | null
  while ((cm = classRe.exec(s)) !== null && classes.length < 3) {
    classes.push(`${cm[1]}类${pct(cm[2])}`)
  }
  if (classes.length) return `赎回费${classes.join("，")}。`
  const timed = /持有时间\s*(?:小于|不足|少于)|持有期限\s*(?:小于|不足|少于)/.test(s)
  if (!timed && /赎回费率为\s*0\s*%|不收取赎回费|赎回费率为零|不设置赎回费/.test(s)) return "0%"
  const single = s.match(/本基金的?赎回费率[为是]?\s*([\d.]+)\s*%/)
  if (single && !timed) return pct(single[1])
  return null
}

export function extractClosedPeriodFromText(text: string): string | null {
  const s = flatten(text)
  if (/封闭期\s*[:：]?\s*(不设置|无)|不设置封闭期|无封闭期|不设封闭期/.test(s)) return "不设置"
  const months = s.match(/封闭期[为是：:\s]*[【\[［]?\s*(\d+)\s*[】\]］]?\s*个?月/)
  if (months?.[1]) {
    const ctx = nearby(s, months.index ?? 0, 48, 48)
    if (!/超过基金存续期|流通受限|投资的产品封闭期|限售期/.test(ctx)) {
      return `${months[1]}个月`
    }
  }
  if (/封闭期[（(]如有[)）]/.test(s) && !/封闭期为\s*\d+/.test(s)) return "不设置"
  if (/投资的产品封闭期/.test(s) && !/本基金.{0,20}封闭期为/.test(s)) return "不设置"
  return null
}

export function extractAddAmountFromText(text: string): string | null {
  const first = text.match(/首次净(?:申购|认购)金额应不低于\s*([\d.]+)\s*万元/)
  const append = text.match(/每次追加(?:认购|申购)金额[^。]{0,24}不少于\s*([\d.]+)\s*万元/)
    || text.match(/追加(?:申购)?(?:金额)?[^。]{0,24}不低于\s*([\d.]+)\s*万元/)
    || text.match(/每次(?:追加)?申购金额应不低于\s*([\d.]+)\s*万元/)
  const remain = text.match(/赎回后持有的基金资产净值不得低于\s*([\d.]+)\s*万元/)
  const parts: string[] = []
  if (first) parts.push(`首次净申购不低于${first[1]}万元`)
  if (append) parts.push(`追加不低于${append[1]}万元`)
  if (remain) parts.push(`赎回后持有净值不得低于${remain[1]}万元`)
  if (parts.length) return `${parts.join("；")}。`
  return null
}

export function extractTemporaryOpenFromText(text: string): string | null {
  if (/不(?:设|设置|设定)\s*临时开放|无临时开放|不设临时开放日/.test(text)) return "否"
  if (/可(?:以)?临时开放|设置临时开放日|增设临时开放日/.test(text)) return "可临开"
  return null
}

export type KeywordFillable = {
  risk_level?: string | null
  lock_period_desc?: string | null
  fee_pay_formula?: string | null
  fee_manage?: string | null
  is_temporary_open?: string | null
  add_amount?: string | null
  fee_pay?: string | null
  fee_redeem?: string | null
  closed_period?: string | null
  fee_trust?: string | null
  fee_admin_service?: string | null
  fee_manage_rate?: string | null
}

function preferCompact<T extends string>(
  current: string | null | undefined,
  next: string | null,
  isWeak: (v: string | null | undefined) => boolean,
): string | null | undefined {
  if (isWeak(current)) return next ?? null
  if (!next) return current
  if ((current ?? "").length > next.length + 20 && !isDumpText(next, next.length + 1)) return next
  return current
}

export function fillMissingElementsFromKeywords<T extends KeywordFillable>(
  text: string,
  extracted: T,
): T {
  const source = text.slice(0, 200_000)
  const out = { ...extracted }

  out.risk_level = preferCompact(out.risk_level, extractRiskLevelFromText(source), isWeakRiskLevel)
  out.lock_period_desc = preferCompact(out.lock_period_desc, extractLockPeriodFromText(source), isWeakLockPeriod)
  if (isWeakLockPeriod(out.lock_period_desc)) out.lock_period_desc = "不设置"
  out.fee_pay_formula = preferCompact(out.fee_pay_formula, extractFeePayFormulaFromText(source), isWeakFormula)
  out.fee_manage = preferCompact(
    out.fee_manage,
    summarizeFeeManageDesc(source, out.fee_manage, out.fee_manage_rate),
    isWeakFeeManage,
  )
  out.fee_pay = preferCompact(out.fee_pay, summarizeFeePayDesc(source), isWeakFeePay)
  out.add_amount = preferCompact(out.add_amount, extractAddAmountFromText(source), isWeakAddAmount)
  out.fee_redeem = preferCompact(out.fee_redeem, extractFeeRedeemFromText(source), isWeakShortFee)
  out.closed_period = preferCompact(out.closed_period, extractClosedPeriodFromText(source), isWeakShortFee)
  if (isWeakShortFee(out.closed_period)) out.closed_period = "不设置"
  out.fee_trust = preferCompact(out.fee_trust, extractFeeTrustFromText(source), isWeakShortFee)
  out.fee_admin_service = preferCompact(out.fee_admin_service, extractFeeAdminFromText(source), isWeakShortFee)
  if (isWeakTemporaryOpen(out.is_temporary_open)) {
    const value = extractTemporaryOpenFromText(source)
    if (value) out.is_temporary_open = value
  }
  return out
}
