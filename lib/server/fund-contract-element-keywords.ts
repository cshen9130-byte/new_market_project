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
  if (/业绩报酬的计提基准日|申购和赎回的金额限制|私募基金合同\s*\d/.test(s) && s.length > 80) return true
  if (/PFij：|其中：E 为应计提|单个基金份额持有人单笔/.test(s) && s.length > 140) return true
  if (/其中[:：]/.test(s) && /应计提的业绩报酬|本计提日/.test(s) && s.length > 100) return true
  if (/^(商解决|划款|账册记录)/.test(s)) return true
  if (s.length < 12 && !/[=＝]/.test(s) && !/计提|提取|公式/.test(s)) return true
  return isDumpText(s, FORMULA_MAX)
}

export function isWeakFeePay(value: string | null | undefined): boolean {
  const s = (value ?? "").trim()
  if (!s || s === "—" || /^-+$/.test(s) || /^详见/.test(s)) return true
  // LLM-generated generic "couldn't extract" statements
  if (/未明确(?:说明|规定|披露)|按(?:基金)?合同约定收取/.test(s) && s.length < 60) return true
  return isDumpText(s, 90)
}

export function isWeakFeeManage(value: string | null | undefined): boolean {
  const s = (value ?? "").trim()
  if (!s || s === "—" || /^-+$/.test(s) || /^详见/.test(s)) return true
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
  const high = s.match(/年(?:托管|运营服务|外包|基金服务)费率\s*([\d.]+)\s*%/)
  if (high?.[1] && parseFloat(high[1]) >= 3) return true
  return isDumpText(s, SHORT_MAX)
}

export function isWeakTemporaryOpen(value: string | number | null | undefined): boolean {
  const s = String(value ?? "").trim()
  if (!s) return true
  return /^-?\d+(?:\.0+)?$/.test(s)
}

function formatRiskGrade(grade: string, label?: string): string | null {
  const g = grade.toUpperCase()
  if (!/^R[1-5]$/.test(g)) return null
  const lab = (label ?? "").replace(/[（）()\s]/g, "") || RISK_LABEL[g]
  return lab ? `${g}（${lab}）` : g
}

function skipRiskMatch(source: string, index: number): boolean {
  if (looksLikeToc(source, index)) return true
  const ctx = nearby(source, index, 36, 36)
  if (/洗钱|身份识别|可疑交易|反洗钱|客户洗钱风险等级/.test(ctx)) return true
  if (/高于本基金的?风险等级|标的产品风险等级|投资标的的风险等级/.test(ctx)) return true
  const productHit = /本基金|本产品|管理人评定|风险收益特征|基金产品/.test(nearby(source, index, 48, 20))
  if (!productHit && /期货是一种高风险|私募基金风险评级标准/.test(ctx)) return true
  return false
}

function classifyMandateScope(scope: string): string | null {
  const hasDeriv = /商品期货|股指期货|国债期货|期货|期权|收益互换|场外期权|权证/.test(scope)
  const hasEquity = /股票|存托凭证|融资融券/.test(scope)
  if (hasEquity || hasDeriv) return formatRiskGrade("R4")
  if (/债券|同业存单|逆回购/.test(scope) && !hasEquity && !hasDeriv) return formatRiskGrade("R3")
  if (/货币|现金管理|银行存款/.test(scope) && !hasEquity && !hasDeriv) return formatRiskGrade("R2")
  return null
}

/** Last resort: AMAC-style grade from the 投资范围 clause, not TOC pointers. */
export function inferRiskLevelFromMandate(text: string): string | null {
  const source = flatten(text)
  const re = /投资范围[：:]?\s*/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) {
    const window = source.slice(match.index, match.index + 900)
    if (
      /具体详见|详见本合|详见本基金|详见“私募基金的投资”|同本基金合同|同本合同|约定的投资目标/.test(
        window.slice(0, 120),
      )
    ) {
      continue
    }
    if (/风险揭示章节|一般风险揭示|期货是一种高风险/.test(window.slice(0, 200))) continue
    if (!/(?:股票|债券|期货|期权|同业存单|收益互换)/.test(window)) continue
    const grade = classifyMandateScope(window)
    if (grade) return grade
  }
  return null
}

export function extractRiskLevelFromText(text: string): string | null {
  const source = flatten(text)
    .replace(/[Ｒｒ]/g, "R")
    .replace(/[１]/g, "1")
    .replace(/[２]/g, "2")
    .replace(/[３]/g, "3")
    .replace(/[４]/g, "4")
    .replace(/[５]/g, "5")
    .replace(/R\s*([1-5])/g, "R$1")
  const patterns: Array<{ re: RegExp; grade: number; label?: number }> = [
    { re: /经管理人评定.{0,48}风险等级为\s*[\[【（(]?\s*(R[1-5])/g, grade: 1 },
    { re: /本基金风险收益特征.{0,80}风险等级为\s*[\[【（(]?\s*(R[1-5])/g, grade: 1 },
    { re: /本基金的?风险等级为\s*[\[【（(]?\s*(R[1-5])/g, grade: 1 },
    { re: /本产品的?风险等级为\s*[\[【（(]?\s*(R[1-5])/g, grade: 1 },
    { re: /本基金属于\s*[\[【（(]?\s*(R[1-5])\s*[\]】）)]?\s*级/g, grade: 1 },
    { re: /本基金属于\s*(R[1-5])\s*[（(]([^)）]{1,16})[)）]/g, grade: 1, label: 2 },
    { re: /属于\s*(R[1-5])\s*[（(]([^)）]{0,16}风险[^)）]*)[)）]/g, grade: 1, label: 2 },
    { re: /风险等级为\s*[\[【（(]?\s*(R[1-5])\s*[\]】）)]?\s*级?/gi, grade: 1 },
    { re: /风险等级[为是：:\s]*[（(\[【]?(R[1-5])[)）\]】]?/g, grade: 1 },
    { re: /风险评级[为是：:\s]*[\[【（(]?(R[1-5])[\]】）)]?/g, grade: 1 },
    { re: /(R[1-5])\s*级\s*[（(](中高风险|中低风险|高风险|低风险|中风险)[)）]/g, grade: 1, label: 2 },
    { re: /(R[1-5])\s*[（(](中高风险|中低风险|高风险|低风险|中风险)[)）]/g, grade: 1, label: 2 },
    { re: /本基金.{0,40}?(R[1-5]).{0,16}?投资品种/g, grade: 1 },
    { re: /(?:本基金为|本基金风险为)\s*[\[【（(]?\s*(R[1-5])/g, grade: 1 },
    { re: /[【\[]\s*(R[1-5])\s*[】\]]\s*级(?:私募|基金产品|产品)/g, grade: 1 },
  ]

  for (const pattern of patterns) {
    const re = new RegExp(pattern.re.source, "gi")
    let match: RegExpExecArray | null
    while ((match = re.exec(source)) !== null) {
      if (skipRiskMatch(source, match.index)) continue
      const formatted = formatRiskGrade(
        match[pattern.grade] ?? "",
        pattern.label ? match[pattern.label] : undefined,
      )
      if (formatted) return formatted
    }
  }

  const named = source.match(/本基金的?风险等级为\s*[\[【（(]?(中高风险|中低风险|高风险|低风险|中风险)/)
    || source.match(/本基金属于\s*(中高风险|中低风险|高风险|低风险|中风险)/)
    || source.match(/本基金为\s*(中高风险|中低风险|高风险|低风险|中风险)\s*投资/)
    || source.match(/本基金风险收益特征[：:].{0,60}?(中高风险|中低风险|高风险|低风险|中风险)/)
    || source.match(/(?<!洗钱)风险等级[为是：:\s]*[\[【]?(中高风险|中低风险|高风险|低风险|中风险)/)
  if (named?.[1]) {
    const label = named[1]
    const grade = RISK_GRADE_FROM_LABEL[label]
    const idx = named.index ?? source.indexOf(named[0])
    if (!skipRiskMatch(source, idx) && grade) return `${grade}（${label}）`
  }

  const suitability = source.match(
    /(?:本基金|本产品).{0,80}?适合.{0,40}?风险承受能力为\s*[\[【]?\s*C([1-5])/,
  )
  if (suitability?.[1]) {
    const formatted = formatRiskGrade(`R${suitability[1]}`)
    if (formatted) return formatted
  }

  return inferRiskLevelFromMandate(source)
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
  const s = collapseWs(eq).replace(/％/g, "%").replace(/＝/g, "=")
  if (!s || /[\uFFFD]/.test(s)) return null
  if (s.length > 96) return null
  if (!/=/.test(s)) return null
  const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length
  if (cjk > 6) return null
  if (/实际业绩报酬提取值|计算方法如下|托管费|管理费年|费用的种类/.test(s)) return null
  if (/^R\s*=\s*[\d.]+\s*%$/.test(s.replace(/\s/g, ""))) return null
  return s
}

function pickEquation(scope: string, pattern: RegExp): string | null {
  const m = scope.match(pattern)
  if (!m) return null
  return cleanEquation(m[0].split(/其中|PFij[:：]|∆Sij|ΔSij/)[0])
}

function formulaEquations(scope: string): string | null {
  const s = flatten(scope)
  if (
    /基金费用的种类|（一）基金费用/.test(s.slice(0, 180))
    && !/PFij|NAVn|HWMij|年化收益率/.test(s.slice(0, 500))
  ) {
    return null
  }
  const parts: string[] = []
  const patterns = [
    /PFij\s*[=＝]\s*Fij\s*[×x*]\s*[（(][^)）]{3,48}[)）]\s*[×x*]\s*[\d.]+\s*%/,
    /H\s*[=＝]\s*F\s*[×x*]\s*[（(]NAV1[^)）]{0,28}[)）]\s*[×x*]\s*[\d.]+\s*%/,
    /E\s*[=＝]\s*[（(]\s*NAVn\s*[-－]\s*NAVh\s*[)）]\s*[×x*]\s*S\s*[×x*]\s*(?:R|[\d.]+\s*%)/,
    /E\s*[=＝]\s*N\s*[×x*]\s*[（(]P1\s*[-－]\s*P0[)）]\s*[×x*]\s*[\d.]+\s*%/,
    /E\s*[=＝]\s*K[^。；;]{0,72}/,
    /Y\s*[=＝]\s*F\s*[×x*][^。；;]{8,72}/,
    /R\s*[=＝]\s*[（(][^。；;]{8,72}/,
  ]
  for (const re of patterns) {
    const got = pickEquation(s, re)
    if (got && !parts.some((p) => p.replace(/\s/g, "") === got.replace(/\s/g, ""))) parts.push(got)
  }

  const { bench, rate } = formulaBenchRate(s)
  const hwRate =
    rate
    || (s.match(/PFij\s*[=＝][^。]{0,80}[×x*]\s*([\d.]+)\s*%/)?.[1]
      ? pct(s.match(/PFij\s*[=＝][^。]{0,80}[×x*]\s*([\d.]+)\s*%/)![1])
      : null)
    || (s.match(/提取\s*([\d.]+)\s*%的业绩报酬/)?.[1] ? pct(s.match(/提取\s*([\d.]+)\s*%的业绩报酬/)![1]) : null)
  const head: string[] = []
  if (bench) head.push(`基准${bench}`)
  if (hwRate) head.push(`超额计提${hwRate}`)
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

  const fallbackIdx = s.search(
    /年化收益率\s*R|Y\s*[=＝]\s*F|E\s*[=＝]\s*K|PFij\s*[=＝]|H\s*[=＝]\s*F|NAVn\s*[-－]\s*NAVh/,
  )
  if (fallbackIdx >= 0) {
    const compact = formulaEquations(s.slice(Math.max(0, fallbackIdx - 240), fallbackIdx + 900))
    if (compact) return compact
  }
  return null
}

function shareClassManageRates(text: string): string | null {
  const s = flatten(text)
  const parts: string[] = []
  for (const cls of ["A", "B", "C", "D"]) {
    if (new RegExp(`${cls}\\s*类份额不计提管理费`).test(s)) {
      parts.push(`${cls}类不计提`)
      continue
    }
    const found =
      s.match(new RegExp(`${cls}\\s*类年(?:化)?管理费率\\s*([\\d.]+)\\s*%`))
      || s.match(new RegExp(`${cls}\\s*类份额[^。]{0,90}?([\\d.]+)\\s*%的年费率`))
      || s.match(new RegExp(`${cls}\\s*类份额\\s+([\\d.]+)\\s*%`))
    if (found?.[1] && parseFloat(found[1]) <= 5) {
      const line = `${cls}类年管理费率${pct(found[1])}`
      if (!parts.includes(line)) parts.push(line)
    }
  }
  return parts.length ? parts.join("；") : null
}

/** Per-class fee overrides extracted from a multi-share-class contract. */
export type ShareClassLetterKey = "A" | "B" | "C"

export type ShareClassFeeFields = {
  /** Percentage string, e.g. "1%" — written via encodeManageRate which handles % → decimal. */
  fee_manage_rate?: string
  /** Compact fee description, e.g. "年管理费率1%，每日计提，按自然季度支付。" */
  fee_manage?: string
  /** Performance fee short description specific to this class, e.g. "超额计提30%" */
  fee_pay?: string
}

export type ShareClassFeeOverrides = Partial<Record<ShareClassLetterKey, ShareClassFeeFields>>

/**
 * Search text for segments that start with the class letter and contain "管理费率" within a short
 * window that cannot cross another class-letter boundary.
 * Using [^A-C。%]{0,20} prevents matching across "A类...B类..." boundaries.
 */
function perClassManageInfo(
  text: string,
  cls: string,
): { ratePct: string; rateN: number } | "exempt" | null {
  // Exempt check: "A类不计提管理费"
  if (new RegExp(`${cls}\\s*类(?:份额)?不计提管理费|${cls}\\s*类不收取管理费`).test(text)) {
    return "exempt"
  }
  // Patterns ordered from most to least specific.
  // [^A-C。%]{0,20} keeps the gap short and prevents crossing another share-class header.
  const found =
    text.match(new RegExp(`${cls}\\s*类年(?:化)?管理费率\\s*([\\d.]+)\\s*%`))
    || text.match(new RegExp(`${cls}\\s*类(?:份额)?[^A-C。%]{0,20}年(?:化)?管理费率[为：:\\s]*([\\d.]+)\\s*%`))
    || text.match(new RegExp(`${cls}\\s*类(?:份额)[^A-C。%]{0,90}?([\\d.]+)\\s*%的年费率`))
    || text.match(new RegExp(`${cls}\\s*类份额\\s+([\\d.]+)\\s*%`))
  if (!found?.[1]) return null
  const n = parseFloat(found[1])
  if (!Number.isFinite(n) || n < 0 || n > 8) return null
  return { ratePct: `${n}%`, rateN: n }
}

function perClassFeePayText(text: string, cls: string): string | null {
  // Find a segment starting with the class letter and containing performance fee terms.
  const re = new RegExp(
    `${cls}(?:类|份额|份)[^;；。\\n]{3,200}(?:业绩报酬|超额计提|计提比例|超额收益|收益率)[^;；。\\n]{0,100}`,
    "i",
  )
  const m = re.exec(text)
  if (m?.[0]) {
    return m[0].trim().slice(0, 80)
  }
  // Fallback: class letter followed directly by a high percentage (≥10%) indicating carry rate
  // (deliberately excludes management-fee-sized rates which are ≤8%)
  const simple = text.match(new RegExp(`${cls}(?:类|份额)[^;；。%\\n]{0,8}([\\d.]+)\\s*%`))
  if (simple?.[1]) {
    const n = parseFloat(simple[1])
    if (Number.isFinite(n) && n >= 10 && n <= 100) {
      return `${cls}类超额计提${n}%`
    }
  }
  return null
}

/**
 * Extracts per-share-class fee overrides from a fund contract.
 * Returns non-empty only when A/B/C classes have detectably different rates/terms.
 */
export function extractShareClassFeeOverrides(text: string): ShareClassFeeOverrides {
  const s = flatten(text.slice(0, 200_000))

  // Only proceed if there are clear multi-class markers
  if (!/[AB]类(?:份额|年管理|份)/.test(s)) return {}

  // Collect per-class manage rates
  type ManageInfo = { ratePct: string; rateN: number } | "exempt"
  const manageMap: Partial<Record<ShareClassLetterKey, ManageInfo>> = {}
  for (const cls of ["A", "B", "C"] as const) {
    const info = perClassManageInfo(s, cls)
    if (info) manageMap[cls] = info
  }

  // Only generate overrides if the detected classes have DIFFERENT rates
  const rateKeys = (Object.values(manageMap) as ManageInfo[]).map((v) =>
    v === "exempt" ? "0%" : v.ratePct,
  )
  const allSameManage = rateKeys.length < 2 || new Set(rateKeys).size === 1

  // Collect per-class fee_pay
  const payMap: Partial<Record<ShareClassLetterKey, string>> = {}
  for (const cls of ["A", "B", "C"] as const) {
    const t = perClassFeePayText(s, cls)
    if (t) payMap[cls] = t
  }
  const payValues = Object.values(payMap)
  const allSamePay = payValues.length < 2 || new Set(payValues).size === 1

  const result: ShareClassFeeOverrides = {}

  for (const cls of ["A", "B", "C"] as const) {
    const override: ShareClassFeeFields = {}

    if (!allSameManage && cls in manageMap) {
      const info = manageMap[cls]!
      if (info === "exempt") {
        override.fee_manage_rate = "0%"
        const bits = ["年管理费率0%，不计提"]
        override.fee_manage = `${bits.join("，")}。`.slice(0, FEE_DESC_MAX)
      } else {
        override.fee_manage_rate = info.ratePct
        const bits = [`年管理费率${info.ratePct}`]
        if (/每日计提/.test(s)) bits.push("每日计提")
        const pay = payPhrase(s)
        if (pay) bits.push(pay)
        override.fee_manage = `${bits.join("，")}。`.slice(0, FEE_DESC_MAX)
      }
    }

    if (!allSamePay && cls in payMap) {
      override.fee_pay = payMap[cls]
    }

    if (Object.keys(override).length) {
      result[cls] = override
    }
  }

  return result
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

function eachMatch(re: RegExp, source: string): RegExpExecArray[] {
  const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`)
  const out: RegExpExecArray[] = []
  let m: RegExpExecArray | null
  while ((m = global.exec(source))) {
    out.push(m)
    if (!m[0]) global.lastIndex += 1
  }
  return out
}

function matchAnnualFeeRate(
  text: string,
  names: string[],
  maxPct = 8,
): { raw: string; index: number; matched: string } | null {
  const s = flatten(text)
  const num = `[【\\[［]?\\s*([\\d.]+)\\s*[】\\]］]?\\s*%`
  for (const name of names) {
    const patterns = [
      new RegExp(`年(?:化)?${name}率[为是：:\\s]*${num}`),
      new RegExp(`${name}年费率[为是：:\\s]*${num}`),
      new RegExp(`${name}的年费率[为是：:\\s]*${num}`),
      new RegExp(`${name}率为年费率\\s*${num}`),
      new RegExp(`${name}按基金资产净值的\\s*${num}`),
      new RegExp(`${name}按前一[日天][^\\d%]{0,48}${num}的年费率`),
      new RegExp(`${name}[^。\\d%]{0,48}${num}的年费率`),
    ]
    for (const re of patterns) {
      for (const m of eachMatch(re, s)) {
        if (!m[1]) continue
        const n = parseFloat(m[1])
        if (!Number.isFinite(n) || n <= 0 || n > maxPct) continue
        const around = nearby(s, m.index ?? 0, 36, 36)
        if (/权利|义务|不承担|业绩报酬|违约金/.test(around)) continue
        return { raw: m[1], index: m.index ?? 0, matched: m[0] }
      }
    }
  }
  return null
}

export function extractFeeTrustFromText(text: string): string | null {
  const m = matchAnnualFeeRate(text, ["基金托管费", "托管费"], 2)
  if (!m) return null
  const scope = flatten(text).slice(Math.max(0, m.index), m.index + 1200)
  return compactFeeLine("年托管费率", m.raw, scope)
}

export function extractFeeAdminFromText(text: string): string | null {
  const m = matchAnnualFeeRate(text, ["运营服务费", "外包服务费", "外包费", "行政服务费", "基金服务费"], 2)
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
  const s = flatten(text)
  const first =
    s.match(/首次净(?:申购|认购)(?:该类份额的)?金额(?:应)?不低于\s*([\d.]+)\s*万元/)
    || s.match(/首次(?:净)?申购该类份额的金额不低于\s*([\d.]+)\s*万元/)
    || s.match(/首次申购本基金的金额不低于\s*([\d.]+)\s*万元/)
    || s.match(/首次净申购金额应不低于\s*([\d.]+)\s*万元/)
  const append =
    s.match(/每次追加(?:净)?(?:认购|申购)(?:该类份额的)?金额(?:应当)?不少于\s*([\d.]+)\s*万元/)
    || s.match(/追加(?:申购)?(?:金额)?[^。]{0,24}不低于\s*([\d.]+)\s*万元/)
    || s.match(/每次(?:追加)?申购金额应不低于\s*([\d.]+)\s*万元/)
  const remain = s.match(/赎回后持有的基金资产净值不得低于\s*([\d.]+)\s*万元/)
  const parts: string[] = []
  if (first) parts.push(`首次净申购不低于${first[1]}万元`)
  if (append) parts.push(`追加不低于${append[1]}万元`)
  else if (/追加(?:净)?申购该类份额的金额不设限制|每次追加.{0,12}不设限制/.test(s)) parts.push("追加不设限制")
  if (remain) parts.push(`赎回后持有净值不得低于${remain[1]}万元`)
  if (parts.length) return `${parts.join("；")}。`.slice(0, 120)
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
  const compact = next && !isWeak(next) ? next : null
  if (isWeak(current)) return compact
  if (!compact) return current
  if ((current ?? "").length > compact.length + 20) return compact
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
  // Derive fee_manage_rate from fee_manage text when the rate field is missing
  if (!out.fee_manage_rate || parseFloat(String(out.fee_manage_rate)) === 0) {
    const rateMatch = (out.fee_manage ?? "").match(/年管理费率(\d+\.?\d*)\s*%/)
    if (rateMatch?.[1]) {
      const n = parseFloat(rateMatch[1])
      if (Number.isFinite(n) && n > 0 && n <= 10) out.fee_manage_rate = `${n}%`
    }
  }
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
