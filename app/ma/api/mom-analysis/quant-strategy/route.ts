import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { withMomCache } from "@/lib/server/mom-cache"
import { getPrefix } from "@/lib/server/prod-utils"
import { QUANT_ACCOUNT_IDS, accountNumericId } from "@/lib/ma/quant-accounts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function toNum(v: unknown): number {
  if (v == null) return 0
  const n = parseFloat(String(v).replace(/[,%\s]/g, ""))
  return Number.isFinite(n) ? n : 0
}

function r0(n: number): number { return Math.round(n) }
function r1(n: number): number { return Math.round(n * 10) / 10 }
function r2(n: number): number { return Math.round(n * 100) / 100 }

const numExpr = (col: string) =>
  `COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("${col}"::text, ''), ',', ''), ' ', ''), '')::numeric, 0)`

const ACC = `REGEXP_REPLACE(REGEXP_REPLACE(TRIM("账户"::text), '[^0-9]', '', 'g'), '^0+', '') = $1`

const OPEN_DATE = `CASE
  WHEN NULLIF(TRIM(COALESCE("开仓日期", '')), '') IS NULL THEN NULL
  WHEN TRIM("开仓日期") ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN TRIM("开仓日期")::date
  ELSE to_date(ROUND(TRIM("开仓日期")::numeric)::bigint::text, 'YYYYMMDD')
END`

const SESSION = `CASE
  WHEN COALESCE(TRIM("成交时间"), '') ~ '^[0-9]{1,2}:'
       AND (SPLIT_PART(TRIM("成交时间"), ':', 1)::int >= 21
            OR SPLIT_PART(TRIM("成交时间"), ':', 1)::int < 8)
  THEN 'night' ELSE 'day'
END`

const SECTOR_MAP: Record<string, string> = {
  C: "农产", CS: "农产", WH: "农产", PM: "农产", RR: "农产", RI: "农产", JR: "农产", LR: "农产",
  A: "农产", B: "农产", M: "农产", Y: "农产", RM: "农产", OI: "农产", RS: "农产", PK: "农产", P: "农产",
  SR: "农产", CF: "农产", CY: "农产", LG: "农产", SP: "农产", OP: "农产",
  AP: "生鲜", CJ: "生鲜", LH: "生鲜", JD: "生鲜",
  AU: "贵金属", AG: "贵金属", PT: "贵金属", PD: "贵金属",
  CU: "有色", BC: "有色", AL: "有色", AO: "有色", AD: "有色", ZN: "有色", PB: "有色", NI: "有色", SN: "有色",
  LC: "新能源", PS: "新能源", SI: "新能源",
  I: "黑色", SF: "黑色", SM: "黑色", RB: "黑色", HC: "黑色", SS: "黑色", WR: "黑色",
  JM: "黑色", J: "黑色", ZC: "黑色", FG: "黑色", BB: "黑色", FB: "黑色",
  SC: "能源化工", FU: "能源化工", LU: "能源化工", PG: "能源化工", BU: "能源化工",
  TA: "能源化工", EG: "能源化工", PF: "能源化工", PR: "能源化工",
  PL: "能源化工", PP: "能源化工", L: "能源化工",
  BZ: "能源化工", PX: "能源化工", EB: "能源化工",
  RU: "能源化工", BR: "能源化工", NR: "能源化工",
  SA: "能源化工", SH: "能源化工", V: "能源化工",
  UR: "能源化工", MA: "能源化工",
  EC: "航运",
  IH: "股指", IF: "股指", IC: "股指", IM: "股指", MO: "股指",
  TS: "国债", TF: "国债", T: "国债", TL: "国债",
}

const PROD_NAMES: Record<string, string> = {
  C: "玉米", CS: "淀粉", WH: "强麦", PM: "普麦", RR: "粳米", RI: "早籼稻", JR: "粳稻", LR: "晚籼稻",
  A: "黄大豆1号", B: "黄大豆2号", M: "豆粕", Y: "豆油", RM: "菜籽粕", OI: "菜籽油", RS: "油菜籽", PK: "花生", P: "棕榈油",
  SR: "白糖", CF: "棉花", CY: "棉纱", LG: "原木", SP: "纸浆", OP: "双胶纸",
  AP: "苹果", CJ: "红枣", LH: "生猪", JD: "鸡蛋",
  AU: "黄金", AG: "白银", PT: "铂", PD: "钯",
  CU: "沪铜", BC: "国际铜", AL: "沪铝", AO: "氧化铝", AD: "铝合金", ZN: "沪锌", PB: "沪铅", NI: "沪镍", SN: "沪锡",
  LC: "碳酸锂", PS: "多晶硅", SI: "工业硅",
  I: "铁矿石", SF: "硅铁", SM: "锰硅", RB: "螺纹钢", HC: "热卷", SS: "不锈钢", WR: "线材",
  JM: "焦煤", J: "焦炭", ZC: "动力煤", FG: "玻璃", BB: "胶合板", FB: "纤维板",
  SC: "原油", FU: "燃料油", LU: "低硫燃料油", PG: "液化石油气", BU: "沥青",
  TA: "PTA", EG: "乙二醇", PF: "短纤", PR: "瓶片", PL: "丙烯", PP: "聚丙烯", L: "塑料",
  BZ: "纯苯", PX: "对二甲苯", EB: "苯乙烯",
  RU: "天然橡胶", BR: "丁二烯橡胶", NR: "20号胶",
  SA: "纯碱", SH: "烧碱", V: "PVC", UR: "尿素", MA: "甲醇",
  EC: "航运指数",
  IH: "上证50", IF: "沪深300", IC: "中证500", IM: "中证1000", MO: "中证1000期权",
  TS: "2年期国债", TF: "5年期国债", T: "10年期国债", TL: "30年期国债",
}

function getSector(prefix: string): string {
  return SECTOR_MAP[prefix] ?? "其他"
}

function mean(xs: number[]): number {
  if (!xs.length) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 15 || ys.length !== n) return null
  const mx = mean(xs)
  const my = mean(ys)
  let num = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) {
    const x = xs[i] - mx
    const y = ys[i] - my
    num += x * y
    dx += x * x
    dy += y * y
  }
  const den = Math.sqrt(dx * dy)
  if (den < 1e-12) return null
  return num / den
}

function fmtWan(n: number): string {
  const abs = Math.abs(n)
  const sign = n > 0 ? "+" : ""
  if (abs >= 10000) return `${sign}${(n / 10000).toFixed(1)}万`
  return `${sign}${Math.round(n).toLocaleString("zh-CN")}`
}

function fmtPct(n: number | null, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return `${n.toFixed(digits)}%`
}

type Tone = "good" | "bad" | "neutral"
type PortraitItem = { title: string; detail: string; tone: Tone }

function buildPortrait(p: {
  days: number
  nCloses: number
  dayWinRate: number
  tradeWinRate: number
  profitFactor: number | null
  avgWin: number
  avgLoss: number
  avgHoldWin: number | null
  avgHoldLoss: number | null
  medianHold: number | null
  hedgeAvg: number
  lockShare: number
  nightPnl: number
  dayPnl: number
  nightLots: number
  dayLots: number
  corrNhci: number | null
  afterLossDRisk: number | null
  afterWinDRisk: number | null
  afterLossOpenShare: number | null
  afterWinOpenShare: number | null
  longPnl: number
  shortPnl: number
  regime: { key: string; pnl: number; days: number }[]
  sectors: { sector: string; pnl: number }[]
}): { strategyLabel: string; summary: string; items: PortraitItem[] } {
  const thin = p.days < 20 || p.nCloses < 30
  const payoff = p.avgLoss < 0 ? p.avgWin / Math.abs(p.avgLoss) : null
  const hold = p.medianHold
  const nightLotsShare = (p.nightLots + p.dayLots) > 0 ? p.nightLots / (p.nightLots + p.dayLots) : 0
  const nightPnlAbs = Math.abs(p.nightPnl) + Math.abs(p.dayPnl)
  const nightPnlShare = nightPnlAbs > 0 ? p.nightPnl / (p.nightPnl + p.dayPnl || 1) : 0

  const wr = p.tradeWinRate
  let strategyLabel = "商品量化"
  if (p.lockShare > 0.2) strategyLabel = "锁仓 / 套利倾向"
  else if (p.hedgeAvg > 0.5) strategyLabel = "多空组合 CTA"
  else if (hold != null && hold <= 1 && wr >= 0.55) strategyLabel = "日内高胜率短线"
  else if (hold != null && hold <= 1) strategyLabel = "日内短周期"
  else if (wr < 0.48 && payoff != null && payoff > 1.4) strategyLabel = "趋势跟踪（低胜率高盈亏比）"
  else if (wr >= 0.55 && (payoff == null || payoff <= 1.2)) strategyLabel = "高胜率低盈亏比"
  else if (hold != null && hold <= 5) strategyLabel = "短周期 CTA"
  else strategyLabel = "中周期 CTA"

  if (p.corrNhci != null && Math.abs(p.corrNhci) >= 0.22) {
    strategyLabel += p.corrNhci > 0 ? " · 商品多头 beta" : " · 逆商品 / 对冲 beta"
  }

  const regimeMap = Object.fromEntries(p.regime.map((x) => [x.key, x]))
  const better = (a: string, b: string) => (regimeMap[a]?.pnl ?? 0) >= (regimeMap[b]?.pnl ?? 0) ? a : b
  const trendVsRange = better("trend", "range")
  const upVsDown = better("up", "down")
  const hiVsLo = better("highVol", "lowVol")

  const fitBits: string[] = []
  const unfitBits: string[] = []
  if (trendVsRange === "trend") {
    fitBits.push("趋势市（南华指数 20 日方向清晰）")
    unfitBits.push("震荡市")
  } else {
    fitBits.push("震荡 / 均值回归市")
    unfitBits.push("单边趋势市")
  }
  if (upVsDown === "up") {
    fitBits.push("商品指数上涨日")
    unfitBits.push("商品指数下跌日")
  } else {
    fitBits.push("商品指数下跌日")
    unfitBits.push("商品指数上涨日")
  }
  if (hiVsLo === "highVol") {
    fitBits.push("高波动环境")
    unfitBits.push("低波动环境")
  } else {
    fitBits.push("低波动环境")
    unfitBits.push("波动突然放大")
  }

  const sectorsSorted = [...p.sectors].sort((a, b) => b.pnl - a.pnl)
  const posSectors = sectorsSorted.filter((s) => s.pnl > 0).slice(0, 3)
  const negSectors = sectorsSorted.filter((s) => s.pnl < 0).sort((a, b) => a.pnl - b.pnl).slice(0, 3)
  const goodAt = posSectors.length
    ? posSectors.map((s) => `${s.sector}（${fmtWan(s.pnl)}）`)
    : sectorsSorted.slice(0, 2).map((s) => `${s.sector}（相对亏得少，${fmtWan(s.pnl)}）`)
  const badAt = negSectors.map((s) => `${s.sector}（${fmtWan(s.pnl)}）`)

  let afterLoss = "样本不足以判断亏损后行为。"
  let lossTone: Tone = "neutral"
  if (p.afterLossDRisk != null) {
    if (p.afterLossDRisk < -0.3) {
      afterLoss = `亏损次日平均风险度下降 ${Math.abs(p.afterLossDRisk).toFixed(2)} 个百分点，偏止损 / 降杠杆。`
      lossTone = "good"
    } else if (p.afterLossDRisk > 0.3) {
      afterLoss = `亏损次日平均风险度上升 ${p.afterLossDRisk.toFixed(2)} 个百分点，有摊平或加仓倾向。`
      lossTone = "bad"
    } else {
      afterLoss = `亏损次日风险度变化不大（${p.afterLossDRisk.toFixed(2)} 个百分点），仓位纪律相对稳定。`
    }
    if (p.afterLossOpenShare != null) {
      afterLoss += p.afterLossOpenShare > 0.55
        ? ` 次日仍以开仓为主（开仓手数占比 ${fmtPct(p.afterLossOpenShare * 100, 0)}）。`
        : ` 次日更偏平仓（开仓手数占比 ${fmtPct(p.afterLossOpenShare * 100, 0)}）。`
    }
  }

  let afterWin = "样本不足以判断盈利后行为。"
  if (p.afterWinDRisk != null) {
    if (p.afterWinDRisk > 0.3) {
      afterWin = `盈利次日平均风险度上升 ${p.afterWinDRisk.toFixed(2)} 个百分点，偏盈利加仓（金字塔）。`
    } else if (p.afterWinDRisk < -0.3) {
      afterWin = `盈利次日平均风险度下降 ${Math.abs(p.afterWinDRisk).toFixed(2)} 个百分点，偏落袋为安。`
    } else {
      afterWin = `盈利次日风险度变化不大（${p.afterWinDRisk.toFixed(2)} 个百分点）。`
    }
    if (p.afterWinOpenShare != null) {
      afterWin += ` 次日开仓手数占比 ${fmtPct(p.afterWinOpenShare * 100, 0)}。`
    }
  }

  let payoffStyle = "盈亏结构不明显。"
  let payoffTone: Tone = "neutral"
  if (payoff != null) {
    if (wr >= 0.55 && payoff <= 1.2) {
      payoffStyle = `高胜率、低盈亏比：平仓胜率 ${fmtPct(wr * 100, 0)}，平均盈利/平均亏损 = ${payoff.toFixed(2)}。靠频率吃饭，单笔赔率一般。`
      payoffTone = "neutral"
    } else if (wr < 0.48 && payoff > 1.4) {
      payoffStyle = `低胜率、高盈亏比：平仓胜率 ${fmtPct(wr * 100, 0)}，平均盈利/平均亏损 = ${payoff.toFixed(2)}。典型趋势跟踪，靠少次大赢覆盖多次小亏。`
      payoffTone = "good"
    } else {
      payoffStyle = `平仓胜率 ${fmtPct(wr * 100, 0)}，平均盈利 ${fmtWan(p.avgWin)} / 平均亏损 ${fmtWan(p.avgLoss)}，盈亏比 ${payoff.toFixed(2)}。`
    }
  }

  let holdStyle = "持仓周期样本不足。"
  if (p.avgHoldWin != null && p.avgHoldLoss != null) {
    if (p.avgHoldLoss > p.avgHoldWin * 1.25) {
      holdStyle = `盈利单平均持有 ${p.avgHoldWin.toFixed(1)} 天，亏损单 ${p.avgHoldLoss.toFixed(1)} 天。亏了扛、赚了跑（处置效应）。`
    } else if (p.avgHoldWin > p.avgHoldLoss * 1.25) {
      holdStyle = `盈利单平均持有 ${p.avgHoldWin.toFixed(1)} 天，亏损单 ${p.avgHoldLoss.toFixed(1)} 天。让利润奔跑、亏损更快止损。`
    } else {
      holdStyle = `盈亏单持仓天数接近：盈利 ${p.avgHoldWin.toFixed(1)} 天，亏损 ${p.avgHoldLoss.toFixed(1)} 天。中位数 ${hold?.toFixed(1) ?? "—"} 天。`
    }
  }

  const hedgeStyle = p.hedgeAvg >= 0.4
    ? `账面多空对锁较高，平均对冲度 ${fmtPct(p.hedgeAvg * 100, 0)}，同一合约双开占比 ${fmtPct(p.lockShare * 100, 0)}。偏套利或对冲，而不是单边。`
    : p.hedgeAvg >= 0.18
      ? `有一定多空对冲：平均对冲度 ${fmtPct(p.hedgeAvg * 100, 0)}，同一合约双开 ${fmtPct(p.lockShare * 100, 0)}。方向仓为主，辅以对冲。`
      : `基本是方向性持仓。平均对冲度 ${fmtPct(p.hedgeAvg * 100, 0)}，同一合约双开 ${fmtPct(p.lockShare * 100, 0)}。`

  const sessionWinner = p.nightPnl >= p.dayPnl ? "夜盘" : "日盘"
  const sessionStyle = `成交手数夜盘占 ${fmtPct(nightLotsShare * 100, 0)}。平仓盈亏：日盘 ${fmtWan(p.dayPnl)}，夜盘 ${fmtWan(p.nightPnl)}。相对更赚在${sessionWinner}。`

  const lsStyle = p.longPnl === 0 && p.shortPnl === 0
    ? "多空盈亏拆分不足。"
    : `多头平仓 ${fmtWan(p.longPnl)}，空头平仓 ${fmtWan(p.shortPnl)}。${p.longPnl >= p.shortPnl ? "多头贡献更大。" : "空头贡献更大。"}`

  const prefix = thin ? "样本偏短，以下为粗画像，请结合图表看稳定性。" : "由成交、平仓与日核算倒推，不是投顾自述。"
  const summary = `${prefix} 更像「${strategyLabel}」。日胜率 ${fmtPct(p.dayWinRate * 100, 0)}，平仓胜率 ${fmtPct(wr * 100, 0)}。`

  const items: PortraitItem[] = [
    { title: "策略类型", detail: `${strategyLabel}。${hold != null ? `持仓中位数约 ${hold.toFixed(1)} 天。` : ""}与南华商品指数日收益相关 ${p.corrNhci == null ? "样本不足" : r2(p.corrNhci)}。`, tone: "neutral" },
    { title: "适合的市场", detail: fitBits.join("；") + "。", tone: "good" },
    { title: "不适合的市场", detail: unfitBits.join("；") + "。", tone: "bad" },
    { title: "亏损之后", detail: afterLoss, tone: lossTone },
    { title: "盈利之后", detail: afterWin, tone: "neutral" },
    { title: "盈亏偏好", detail: payoffStyle, tone: payoffTone },
    { title: "对冲程度", detail: hedgeStyle, tone: p.hedgeAvg >= 0.4 ? "neutral" : "neutral" },
    { title: "日盘 / 夜盘", detail: sessionStyle, tone: "neutral" },
    { title: "持仓习惯", detail: holdStyle, tone: p.avgHoldLoss != null && p.avgHoldWin != null && p.avgHoldLoss > p.avgHoldWin * 1.25 ? "bad" : "good" },
    { title: "多空", detail: lsStyle, tone: "neutral" },
    { title: "擅长", detail: goodAt.length ? goodAt.join("、") : "区间内没有稳定正贡献板块。", tone: "good" },
    { title: "不擅长", detail: badAt.length ? badAt.join("、") : "区间内没有明显拖累板块。", tone: "bad" },
  ]

  return { strategyLabel, summary, items }
}

async function _GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams
    const raw = (sp.get("account") || "319").trim()
    const accountId = accountNumericId(raw)
    if (!accountId || !/^\d{1,8}$/.test(accountId)) {
      return NextResponse.json({ ok: false, error: "无效账户" }, { status: 400 })
    }

    const isoToday = new Date().toISOString().slice(0, 10)
    const defaultFrom = (() => {
      const d = new Date()
      d.setMonth(d.getMonth() - 6)
      return d.toISOString().slice(0, 10)
    })()
    const from = sp.get("from") || defaultFrom
    const to = sp.get("to") || isoToday
    const nhFrom = (() => {
      const d = new Date(`${from}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() - 40)
      return d.toISOString().slice(0, 10)
    })()

    const [dailyRows, nhciRows, closeProdRows, closeHoldRows, closeDirRows, tradeSessRows, tradeDayRows, posRows] = await Promise.all([
      query<{
        account: string; date: string; pnl: string; equity: string; margin: string; risk: string
      }>(
        `SELECT
           TRIM("账户") AS account,
           "交易日期"::text AS date,
           (${numExpr("当日盈亏")} - ${numExpr("当日手续费")} + ${numExpr("权利金收入")} - ${numExpr("权利金支出")})::text AS pnl,
           ${numExpr("客户权益")}::text AS equity,
           ${numExpr("保证金占用")}::text AS margin,
           "风险度" AS risk
         FROM mom_daily_reports
         WHERE ${ACC}
           AND "交易日期"::date BETWEEN $2::date AND $3::date
         ORDER BY "交易日期"`,
        [accountId, from, to],
      ),
      query<{ date: string; close: string }>(
        `SELECT trade_date::text AS date, close::text AS close
         FROM raw_nanhua_indices_daily
         WHERE code = 'NHCI.NH' AND close IS NOT NULL AND close > 0
           AND trade_date BETWEEN $1::date AND $2::date
         ORDER BY trade_date`,
        [nhFrom, to],
      ).catch(() => [] as { date: string; close: string }[]),
      query<{
        product: string; pnl: string; lots: string; win_lots: string; loss_lots: string
        win_pnl: string; loss_pnl: string; avg_hold_win: string | null; avg_hold_loss: string | null
        n: string
      }>(
        `SELECT
           UPPER(REGEXP_REPLACE(TRIM("合约"), '[0-9].*$', '')) AS product,
           SUM(${numExpr("平仓盈亏")})::text AS pnl,
           SUM(${numExpr("手数")})::text AS lots,
           SUM(CASE WHEN ${numExpr("平仓盈亏")} > 0 THEN ${numExpr("手数")} ELSE 0 END)::text AS win_lots,
           SUM(CASE WHEN ${numExpr("平仓盈亏")} < 0 THEN ${numExpr("手数")} ELSE 0 END)::text AS loss_lots,
           SUM(CASE WHEN ${numExpr("平仓盈亏")} > 0 THEN ${numExpr("平仓盈亏")} ELSE 0 END)::text AS win_pnl,
           SUM(CASE WHEN ${numExpr("平仓盈亏")} < 0 THEN ${numExpr("平仓盈亏")} ELSE 0 END)::text AS loss_pnl,
           AVG(GREATEST(("交易日期"::date - ${OPEN_DATE}), 0)) FILTER (WHERE ${numExpr("平仓盈亏")} > 0)::text AS avg_hold_win,
           AVG(GREATEST(("交易日期"::date - ${OPEN_DATE}), 0)) FILTER (WHERE ${numExpr("平仓盈亏")} < 0)::text AS avg_hold_loss,
           COUNT(*)::text AS n
         FROM mom_close_details
         WHERE ${ACC}
           AND "交易日期"::date BETWEEN $2::date AND $3::date
           AND "合约" IS NOT NULL
         GROUP BY 1`,
        [accountId, from, to],
      ),
      query<{
        bucket: string; outcome: string; lots: string; pnl: string; n: string
        avg_hold: string | null
      }>(
        `WITH c AS (
           SELECT
             ${numExpr("平仓盈亏")} AS pnl,
             ${numExpr("手数")} AS lots,
             GREATEST(("交易日期"::date - ${OPEN_DATE}), 0) AS hold_days
           FROM mom_close_details
           WHERE ${ACC}
             AND "交易日期"::date BETWEEN $2::date AND $3::date
         )
         SELECT
           CASE
             WHEN hold_days <= 0 THEN 'intraday'
             WHEN hold_days <= 1 THEN '1d'
             WHEN hold_days <= 5 THEN '2-5d'
             WHEN hold_days <= 20 THEN '6-20d'
             ELSE '21d+'
           END AS bucket,
           CASE WHEN pnl > 0 THEN 'win' WHEN pnl < 0 THEN 'loss' ELSE 'flat' END AS outcome,
           SUM(lots)::text AS lots,
           SUM(pnl)::text AS pnl,
           COUNT(*)::text AS n,
           AVG(hold_days)::text AS avg_hold
         FROM c
         GROUP BY 1, 2`,
        [accountId, from, to],
      ),
      query<{
        direction: string; pnl: string; lots: string; win_lots: string; n: string
      }>(
        `SELECT
           TRIM("买/卖") AS direction,
           SUM(${numExpr("平仓盈亏")})::text AS pnl,
           SUM(${numExpr("手数")})::text AS lots,
           SUM(CASE WHEN ${numExpr("平仓盈亏")} > 0 THEN ${numExpr("手数")} ELSE 0 END)::text AS win_lots,
           COUNT(*)::text AS n
         FROM mom_close_details
         WHERE ${ACC}
           AND "交易日期"::date BETWEEN $2::date AND $3::date
         GROUP BY 1`,
        [accountId, from, to],
      ),
      query<{
        session: string; pnl: string; lots: string; fee: string; open_lots: string; close_lots: string
      }>(
        `SELECT
           ${SESSION} AS session,
           SUM(${numExpr("平仓盈亏")})::text AS pnl,
           SUM(${numExpr("手数")})::text AS lots,
           SUM(${numExpr("手续费")})::text AS fee,
           SUM(CASE WHEN TRIM("开/平") LIKE '%开%' THEN ${numExpr("手数")} ELSE 0 END)::text AS open_lots,
           SUM(CASE WHEN TRIM("开/平") LIKE '%平%' THEN ${numExpr("手数")} ELSE 0 END)::text AS close_lots
         FROM mom_futures_trade_details
         WHERE ${ACC}
           AND "交易日期"::date BETWEEN $2::date AND $3::date
         GROUP BY 1`,
        [accountId, from, to],
      ),
      query<{
        date: string; open_lots: string; close_lots: string
      }>(
        `SELECT
           "交易日期"::text AS date,
           SUM(CASE WHEN TRIM("开/平") LIKE '%开%' THEN ${numExpr("手数")} ELSE 0 END)::text AS open_lots,
           SUM(CASE WHEN TRIM("开/平") LIKE '%平%' THEN ${numExpr("手数")} ELSE 0 END)::text AS close_lots
         FROM mom_futures_trade_details
         WHERE ${ACC}
           AND "交易日期"::date BETWEEN $2::date AND $3::date
         GROUP BY 1
         ORDER BY 1`,
        [accountId, from, to],
      ),
      query<{
        date: string; long_mv: string; short_mv: string; lock_mv: string; gross_mv: string
      }>(
        `SELECT
           "交易日期"::text AS date,
           SUM(CASE WHEN ${numExpr("买持仓")} > 0 THEN ${numExpr("持仓市値")} ELSE 0 END)::text AS long_mv,
           SUM(CASE WHEN ${numExpr("卖持仓")} > 0 THEN ${numExpr("持仓市値")} ELSE 0 END)::text AS short_mv,
           SUM(CASE WHEN ${numExpr("买持仓")} > 0 AND ${numExpr("卖持仓")} > 0 THEN ${numExpr("持仓市値")} ELSE 0 END)::text AS lock_mv,
           SUM(${numExpr("持仓市値")})::text AS gross_mv
         FROM mom_position_details
         WHERE ${ACC}
           AND "交易日期"::date BETWEEN $2::date AND $3::date
           AND "合约" IS NOT NULL
           AND UPPER(TRIM("合约")) !~ '[0-9][CP][0-9]'
         GROUP BY 1
         ORDER BY 1`,
        [accountId, from, to],
      ),
    ])

    const account = dailyRows[0]?.account || `rx${accountId}`

    const equity: {
      date: string; pnl: number; cumPnl: number; equity: number; margin: number; riskPct: number; ddPct: number
    }[] = []
    let cum = 0
    let peak = 0
    for (const row of dailyRows) {
      const pnl = toNum(row.pnl)
      const eq = toNum(row.equity)
      const margin = toNum(row.margin)
      const riskPct = toNum(row.risk)
      cum += pnl
      const nav = eq > 0 ? eq : cum
      if (nav > peak) peak = nav
      const ddPct = peak > 0 ? ((nav - peak) / peak) * 100 : 0
      equity.push({
        date: row.date.slice(0, 10),
        pnl: r2(pnl),
        cumPnl: r2(cum),
        equity: r0(eq),
        margin: r0(margin),
        riskPct: r2(riskPct),
        ddPct: r2(ddPct),
      })
    }

    const pnls = equity.map((x) => x.pnl)
    const winDays = pnls.filter((x) => x > 0).length
    const lossDays = pnls.filter((x) => x < 0).length
    const dayWinRate = pnls.length ? winDays / pnls.length : 0
    const winSum = pnls.filter((x) => x > 0).reduce((a, b) => a + b, 0)
    const lossSum = Math.abs(pnls.filter((x) => x < 0).reduce((a, b) => a + b, 0))
    const dayPf = lossSum > 0 ? winSum / lossSum : null

    const rets: number[] = []
    for (let i = 1; i < equity.length; i++) {
      const prev = equity[i - 1].equity
      if (prev > 0) rets.push(equity[i].pnl / prev)
    }
    const sharpe = rets.length >= 10 && stdev(rets) > 0 ? (mean(rets) / stdev(rets)) * Math.sqrt(252) : null
    const maxDdPct = equity.length ? Math.min(...equity.map((x) => x.ddPct)) : 0

    const nhci = nhciRows.map((r) => ({ date: r.date.slice(0, 10), close: toNum(r.close) }))
    const nhciRet = new Map<string, number>()
    const nhciVol = new Map<string, number>()
    const nhciTrend = new Map<string, number>()
    const nhciTs = new Map<string, number>()
    for (let i = 1; i < nhci.length; i++) {
      if (nhci[i - 1].close > 0) {
        nhciRet.set(nhci[i].date, nhci[i].close / nhci[i - 1].close - 1)
      }
    }
    const vols: number[] = []
    for (let i = 20; i < nhci.length; i++) {
      const slice = []
      for (let j = i - 19; j <= i; j++) {
        const r = nhciRet.get(nhci[j].date)
        if (r != null) slice.push(r)
      }
      const v = stdev(slice)
      nhciVol.set(nhci[i].date, v)
      vols.push(v)
      const prev = nhci[i - 20]?.close
      if (prev > 0) {
        const tr = nhci[i].close / prev - 1
        nhciTrend.set(nhci[i].date, tr)
        nhciTs.set(nhci[i].date, v > 0 ? Math.abs(tr) / (v * Math.sqrt(20)) : 0)
      }
    }
    const medVol = [...vols].sort((a, b) => a - b)[Math.floor(vols.length / 2)] ?? 0

    type Bucket = { pnl: number; days: number; wins: number }
    const regimeAcc: Record<string, Bucket> = {
      up: { pnl: 0, days: 0, wins: 0 },
      down: { pnl: 0, days: 0, wins: 0 },
      trend: { pnl: 0, days: 0, wins: 0 },
      range: { pnl: 0, days: 0, wins: 0 },
      highVol: { pnl: 0, days: 0, wins: 0 },
      lowVol: { pnl: 0, days: 0, wins: 0 },
    }
    const px: number[] = []
    const py: number[] = []
    for (const d of equity) {
      const ret = nhciRet.get(d.date)
      if (ret != null) {
        px.push(d.pnl)
        py.push(ret)
        const side = ret >= 0 ? "up" : "down"
        regimeAcc[side].pnl += d.pnl
        regimeAcc[side].days += 1
        if (d.pnl > 0) regimeAcc[side].wins += 1
      }
      const vol = nhciVol.get(d.date)
      if (vol != null && medVol > 0) {
        const k = vol >= medVol ? "highVol" : "lowVol"
        regimeAcc[k].pnl += d.pnl
        regimeAcc[k].days += 1
        if (d.pnl > 0) regimeAcc[k].wins += 1
      }
      const ts = nhciTs.get(d.date)
      if (ts != null) {
        const k = ts >= 1 ? "trend" : "range"
        regimeAcc[k].pnl += d.pnl
        regimeAcc[k].days += 1
        if (d.pnl > 0) regimeAcc[k].wins += 1
      }
    }
    const corrNhci = pearson(px, py)
    const REGIME_LABEL: Record<string, string> = {
      up: "商品上涨日",
      down: "商品下跌日",
      trend: "趋势市",
      range: "震荡市",
      highVol: "高波动",
      lowVol: "低波动",
    }
    const regime = Object.entries(regimeAcc).map(([key, v]) => ({
      key,
      label: REGIME_LABEL[key] ?? key,
      pnl: r0(v.pnl),
      days: v.days,
      winRate: v.days ? r2((v.wins / v.days) * 100) : 0,
    }))

    const products = closeProdRows
      .map((r) => {
        const code = getPrefix(r.product)
        const lots = toNum(r.lots)
        const winLots = toNum(r.win_lots)
        const lossLots = toNum(r.loss_lots)
        const winPnl = toNum(r.win_pnl)
        const lossPnl = toNum(r.loss_pnl)
        const pf = Math.abs(lossPnl) > 0 ? winPnl / Math.abs(lossPnl) : null
        return {
          code,
          name: PROD_NAMES[code] ?? code,
          sector: getSector(code),
          pnl: r0(toNum(r.pnl)),
          lots: r1(lots),
          winRate: winLots + lossLots > 0 ? r2((winLots / (winLots + lossLots)) * 100) : 0,
          profitFactor: pf == null ? null : r2(pf),
          avgHoldWin: r.avg_hold_win == null ? null : r1(toNum(r.avg_hold_win)),
          avgHoldLoss: r.avg_hold_loss == null ? null : r1(toNum(r.avg_hold_loss)),
          n: toNum(r.n),
        }
      })
      .filter((p) => p.code && p.n > 0)
      .sort((a, b) => b.pnl - a.pnl)

    const sectorMap = new Map<string, { pnl: number; lots: number }>()
    for (const p of products) {
      const cur = sectorMap.get(p.sector) ?? { pnl: 0, lots: 0 }
      cur.pnl += p.pnl
      cur.lots += p.lots
      sectorMap.set(p.sector, cur)
    }
    const sectors = [...sectorMap.entries()]
      .map(([sector, v]) => ({ sector, pnl: r0(v.pnl), lots: r1(v.lots) }))
      .sort((a, b) => b.pnl - a.pnl)

    const HOLD_LABEL: Record<string, string> = {
      intraday: "日内",
      "1d": "1 天",
      "2-5d": "2–5 天",
      "6-20d": "6–20 天",
      "21d+": "20 天以上",
    }
    const holdBuckets = ["intraday", "1d", "2-5d", "6-20d", "21d+"].map((bucket) => {
      const win = closeHoldRows.find((r) => r.bucket === bucket && r.outcome === "win")
      const loss = closeHoldRows.find((r) => r.bucket === bucket && r.outcome === "loss")
      return {
        bucket,
        label: HOLD_LABEL[bucket] ?? bucket,
        winLots: r1(toNum(win?.lots)),
        lossLots: r1(toNum(loss?.lots)),
        winPnl: r0(toNum(win?.pnl)),
        lossPnl: r0(toNum(loss?.pnl)),
      }
    })

    let winLots = 0, lossLots = 0, winPnl = 0, lossPnl = 0, nCloses = 0
    let holdWinW = 0, holdLossW = 0, holdWinN = 0, holdLossN = 0, holdAllW = 0, holdAllN = 0
    for (const r of closeHoldRows) {
      const lots = toNum(r.lots)
      const pnl = toNum(r.pnl)
      const n = toNum(r.n)
      const avgH = toNum(r.avg_hold)
      nCloses += n
      if (r.outcome === "win") {
        winLots += lots
        winPnl += pnl
        holdWinW += avgH * n
        holdWinN += n
      } else if (r.outcome === "loss") {
        lossLots += lots
        lossPnl += pnl
        holdLossW += avgH * n
        holdLossN += n
      }
      holdAllW += avgH * n
      holdAllN += n
    }
    const tradeWinRate = winLots + lossLots > 0 ? winLots / (winLots + lossLots) : 0
    const avgWin = winLots > 0 ? winPnl / winLots : 0
    const avgLoss = lossLots > 0 ? lossPnl / lossLots : 0
    const tradePf = Math.abs(lossPnl) > 0 ? winPnl / Math.abs(lossPnl) : null
    const avgHoldWin = holdWinN > 0 ? holdWinW / holdWinN : null
    const avgHoldLoss = holdLossN > 0 ? holdLossW / holdLossN : null
    const medianHold = holdAllN > 0 ? holdAllW / holdAllN : null

    const longRow = closeDirRows.find((r) => r.direction === "卖")
    const shortRow = closeDirRows.find((r) => r.direction === "买")
    const longLots = toNum(longRow?.lots)
    const shortLots = toNum(shortRow?.lots)
    const longWinLots = toNum(longRow?.win_lots)
    const shortWinLots = toNum(shortRow?.win_lots)
    const longShort = {
      longPnl: r0(toNum(longRow?.pnl)),
      shortPnl: r0(toNum(shortRow?.pnl)),
      longLots: r1(longLots),
      shortLots: r1(shortLots),
      longWinRate: longLots > 0 ? r2((longWinLots / longLots) * 100) : 0,
      shortWinRate: shortLots > 0 ? r2((shortWinLots / shortLots) * 100) : 0,
    }

    const sessDay = tradeSessRows.find((r) => r.session === "day")
    const sessNight = tradeSessRows.find((r) => r.session === "night")
    const session = {
      day: {
        pnl: r0(toNum(sessDay?.pnl)),
        lots: r1(toNum(sessDay?.lots)),
        fee: r0(toNum(sessDay?.fee)),
      },
      night: {
        pnl: r0(toNum(sessNight?.pnl)),
        lots: r1(toNum(sessNight?.lots)),
        fee: r0(toNum(sessNight?.fee)),
      },
    }

    const tradeByDate = new Map(tradeDayRows.map((r) => [r.date.slice(0, 10), {
      open: toNum(r.open_lots),
      close: toNum(r.close_lots),
    }]))

    const afterWin: number[] = []
    const afterLoss: number[] = []
    const afterWinM: number[] = []
    const afterLossM: number[] = []
    const afterWinOpen: number[] = []
    const afterLossOpen: number[] = []
    for (let i = 0; i < equity.length - 1; i++) {
      const dRisk = equity[i + 1].riskPct - equity[i].riskPct
      const dM = equity[i].margin > 0 ? (equity[i + 1].margin / equity[i].margin - 1) * 100 : null
      const nxt = tradeByDate.get(equity[i + 1].date)
      const openShare = nxt && (nxt.open + nxt.close) > 0 ? nxt.open / (nxt.open + nxt.close) : null
      if (equity[i].pnl > 0) {
        afterWin.push(dRisk)
        if (dM != null) afterWinM.push(dM)
        if (openShare != null) afterWinOpen.push(openShare)
      } else if (equity[i].pnl < 0) {
        afterLoss.push(dRisk)
        if (dM != null) afterLossM.push(dM)
        if (openShare != null) afterLossOpen.push(openShare)
      }
    }
    const afterMove = {
      afterWin: {
        dRisk: afterWin.length ? r2(mean(afterWin)) : null,
        dMarginPct: afterWinM.length ? r2(mean(afterWinM)) : null,
        nextOpenShare: afterWinOpen.length ? r2(mean(afterWinOpen) * 100) : null,
        n: afterWin.length,
      },
      afterLoss: {
        dRisk: afterLoss.length ? r2(mean(afterLoss)) : null,
        dMarginPct: afterLossM.length ? r2(mean(afterLossM)) : null,
        nextOpenShare: afterLossOpen.length ? r2(mean(afterLossOpen) * 100) : null,
        n: afterLoss.length,
      },
    }

    const hedge = posRows.map((r) => {
      const longMv = toNum(r.long_mv)
      const shortMv = toNum(r.short_mv)
      const lockMv = toNum(r.lock_mv)
      const gross = longMv + shortMv
      const ratio = gross > 0 ? (2 * Math.min(longMv, shortMv)) / gross : 0
      return {
        date: r.date.slice(0, 10),
        ratio: r2(ratio * 100),
        longMv: r0(longMv),
        shortMv: r0(shortMv),
        lockShare: gross > 0 ? r2((lockMv / gross) * 100) : 0,
      }
    })
    const hedgeAvg = hedge.length ? mean(hedge.map((h) => h.ratio)) / 100 : 0
    const lockShare = hedge.length ? mean(hedge.map((h) => h.lockShare)) / 100 : 0

    const portrait = buildPortrait({
      days: equity.length,
      nCloses,
      dayWinRate,
      tradeWinRate,
      profitFactor: tradePf,
      avgWin,
      avgLoss,
      avgHoldWin,
      avgHoldLoss,
      medianHold,
      hedgeAvg,
      lockShare,
      nightPnl: session.night.pnl,
      dayPnl: session.day.pnl,
      nightLots: session.night.lots,
      dayLots: session.day.lots,
      corrNhci,
      afterLossDRisk: afterMove.afterLoss.dRisk,
      afterWinDRisk: afterMove.afterWin.dRisk,
      afterLossOpenShare: afterMove.afterLoss.nextOpenShare == null ? null : afterMove.afterLoss.nextOpenShare / 100,
      afterWinOpenShare: afterMove.afterWin.nextOpenShare == null ? null : afterMove.afterWin.nextOpenShare / 100,
      longPnl: longShort.longPnl,
      shortPnl: longShort.shortPnl,
      regime,
      sectors,
    })

    return NextResponse.json({
      ok: true,
      account,
      accountId,
      quantIds: [...QUANT_ACCOUNT_IDS],
      from,
      to,
      kpis: {
        tradingDays: equity.length,
        totalPnl: r0(cum),
        dayWinRate: r2(dayWinRate * 100),
        tradeWinRate: r2(tradeWinRate * 100),
        profitFactor: tradePf == null ? null : r2(tradePf),
        dayProfitFactor: dayPf == null ? null : r2(dayPf),
        sharpe: sharpe == null ? null : r2(sharpe),
        maxDdPct: r2(maxDdPct),
        avgHoldWin: avgHoldWin == null ? null : r1(avgHoldWin),
        avgHoldLoss: avgHoldLoss == null ? null : r1(avgHoldLoss),
        medianHold: medianHold == null ? null : r1(medianHold),
        hedgeRatioAvg: r2(hedgeAvg * 100),
        lockShareAvg: r2(lockShare * 100),
        nCloses,
        corrNhci: corrNhci == null ? null : r2(corrNhci),
      },
      portrait,
      equity,
      regime,
      sectors,
      products,
      payoff: {
        winRate: r2(tradeWinRate * 100),
        avgWin: r0(avgWin),
        avgLoss: r0(avgLoss),
        profitFactor: tradePf == null ? null : r2(tradePf),
        winLots: r1(winLots),
        lossLots: r1(lossLots),
        winDays,
        lossDays,
      },
      hold: {
        buckets: holdBuckets,
        avgWin: avgHoldWin == null ? null : r1(avgHoldWin),
        avgLoss: avgHoldLoss == null ? null : r1(avgHoldLoss),
      },
      session,
      afterMove,
      hedge,
      longShort,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, notYetRun: true, account: null, equity: [], products: [], sectors: [], portrait: { strategyLabel: "无数据", summary: "核算表尚未导入。", items: [] } })
    }
    console.error("[quant-strategy]", err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = withMomCache("quant-strategy", _GET)
