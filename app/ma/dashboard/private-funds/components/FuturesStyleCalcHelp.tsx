"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

type HelpSection = "latest" | "daily" | "interval" | "cumulative"

type HelpBlock = {
  title: string
  paragraphs?: string[]
  formula?: string
  bullets?: string[]
}

const FACTOR_DEFINITIONS: HelpBlock = {
  title: "各因子的研究定义（已落地为真实多空组合）",
  paragraphs: [
    "信号一律用 t−1 及更早的价格/持仓数据构造，收益取各品种下一交易日主力连续合约收益 r_{i,t} = P_{i,t}/P_{i,t−1} − 1。组合在商品期货池内做多空（剔除股指/国债）。",
    "价格主源：AkShare 主力连续 + EMQuant 近远月。报告名因子为本机 REPORT_FIT 价格/持仓重构（非 Wind NAV）。data/gtjaqh_closes.csv 仅作离线校准真值，默认不接入实时图表（USE_WIND_GTJAQH=false）。",
  ],
  bullets: [
    "时间序列动量(短/中/长)：回看 L = 20 / 60 / 120，信号 s_i = sign(R_i(L))，σ_i 为 60 日波动，权重 w_i = s_i/σ_i，日收益 = Σ w_i r_{i,t} / Σ |w_i|。",
    "截面动量(短) / 截面动量：按 L = 20 / 60 过去收益排序，做多最高 20%、做空最低 20%，多空等权。",
    "期限结构 / 基差 / 价值收益：Carry_i = 近月价/次近月价 − 1，做多 Carry 高、做空 Carry 低。",
    "基差动量：Carry 相对 20 日前的变化，做多变化高、做空变化低。",
    "波动因子(短)/波动/低波动：σ 为 20/60 日收益波动，做多低波动、做空高波动。",
    "流动性因子：Amihud ≈ |r|/成交量（20 日均量），做多 Amihud 低、做空高。",
    "价格偏离 / 均价突破：Dev = P/MA20 − 1，反转：做多 Dev 低、做空 Dev 高。",
    "偏度 / 峰度：20 日收益偏度或超额峰度，做多低、做空高。",
    "投机意愿：成交量/持仓量，做多意愿高、做空低。",
    "持仓变化：Score = sign(r)·ΔOI，做多 Score 高、做空低。",
    "基差（周报代理）：CS ln(近/远) 多贴水/空升水；topFrac≈20%；日收益×scale（REPORT_FIT.basis*，Wind GTJAQH012 校准）。",
    "长期截面（周报代理）：price~time OLS（L≈120，用斜率而非 −z），截面 demean/中性，topFrac≈15%，scale 为负（REPORT_FIT.csLong*；对照 Wind GTJAQH013 截面动量）。",
    "量价相关性（周报代理）：多腿 dOi/oiPct/turnover/amount shock blend（REPORT_FIT.pvBlend）；Wind 日收益相关仍偏弱，保留水平路径较稳的 blend。",
    "长期规则（周报代理）：低波动动量 momLowVol（L≈150，volCap≈1.2，逆波动加权，flip + 负 scale；REPORT_FIT.longRule*，对照 Wind GTJAQH010）。",
    "库存代理：截面 −ΔOI（无基本面库存序列时的弱代理）；利润代理：Carry 截面。对照 Wind 007/009，非实时 NAV。",
    "中期动量：MA20/60 本地交叉。离线校准 CSV 映射：012基差/011量价/010长期规则动量/013截面动量/007库存/009利润。",
  ],
}

const DATA_SOURCE: HelpBlock = {
  title: "数据与板块",
  paragraphs: [
    "接口：GET /ma/api/style-factors/returns?from=&to=&sector=。报告名因子为 REPORT_FIT 本地重构；Wind CSV 仅离线校准，不作为实时图源。",
  ],
  bullets: [
    "全部 / 商品：全商品池。",
    "黑色 / 有色 / 能化 / 农产：仅该板块品种；基差动量标在黑色，短期基差动量与基差因子标在能化。",
    "刷新：页面改日期后点「查询」，或切换板块会自动重新请求；底层表由夜间 ETL/AkShare·EMQuant 拉取更新。",
  ],
}

const HELP: Record<HelpSection, { heading: string; intro: string; blocks: HelpBlock[] }> = {
  latest: {
    heading: "最新风格因子收益 · 计算说明",
    intro: "每张卡片是查询区间内最后一个交易日、当前板块下该因子的真实日收益率（%）。",
    blocks: [
      DATA_SOURCE,
      {
        title: "卡片取值",
        paragraphs: [
          "取区间最后一个有行情的交易日 T 的因子组合日收益，乘 100 后保留两位小数。",
        ],
        formula: `卡片(f) = round( 100 × r_f(T) , 2 )`,
        bullets: [
          "正收益红色，负收益绿色，零为灰色。",
          "不再使用哈希伪随机或板块常数漂移。",
        ],
      },
      FACTOR_DEFINITIONS,
    ],
  },
  daily: {
    heading: "单日风格因子收益 · 计算说明",
    intro: "每根柱子是该因子在该交易日的真实日收益率（%）。同一天的多个因子并排，图例可点选显隐。",
    blocks: [
      DATA_SOURCE,
      {
        title: "柱高",
        paragraphs: [
          "日收益乘 100 后画图；为避免极端值撑破坐标，展示层截断到 [−3.8, 3.8]，截断只影响画图高度，不回写底层序列。",
        ],
        formula: `y(f, t) = clip( round( 100 × r_f(t) , 2 ) , −3.8, 3.8 )`,
      },
      FACTOR_DEFINITIONS,
    ],
  },
  interval: {
    heading: "区间统计 · 计算说明",
    intro: "表格是各因子在近一周、近一月、近三月、近六月、近一年、今年以来的复利累计收益率（%）。",
    blocks: [
      DATA_SOURCE,
      {
        title: "区间收益",
        paragraphs: [
          "对因子日收益做复利：R = Π(1 + r_t) − 1，窗口截止于查询区间最后一个交易日。",
        ],
        formula: `区间(f, k) = round( 100 × ( Π_{t∈k} (1 + r_f(t)) − 1 ) , 2 )`,
        bullets: [
          "不再使用静态假表或板块平移。",
        ],
      },
      FACTOR_DEFINITIONS,
    ],
  },
  cumulative: {
    heading: "风格因子累计收益 · 计算说明",
    intro: "折线是查询区间内各因子日收益率（百分点）的算术累计路径，起点为 0。纵轴单位是 %。",
    blocks: [
      DATA_SOURCE,
      {
        title: "累计路径",
        paragraphs: [
          "报告名因子用未四舍入日收益复利：(Π(1+r)−1)×100。其他风格因子可为日收益百分点算术累计。",
        ],
        formula: `报告名: C_t = ( Π (1+r_f) − 1 ) × 100
其他: C_0 = 0; C_t = round( C_{t−1} + 100 × r_f(t) , 2 )`,
        bullets: [
          "若真实收益接近平坦，曲线也可能较直；那是市场结果，不是常数漂移 mock。",
        ],
      },
      FACTOR_DEFINITIONS,
    ],
  },
}

export function FuturesStyleCalcHelp({ section }: { section: HelpSection }) {
  const content = HELP[section]

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-zinc-300 text-[11px] font-semibold leading-none text-zinc-500 hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-800 transition-colors"
          aria-label={content.heading}
          title="计算说明"
        >
          ?
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base pr-6">{content.heading}</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">{content.intro}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm text-zinc-700">
          {content.blocks.map((block) => (
            <section key={block.title} className="space-y-2">
              <h4 className="text-sm font-semibold text-zinc-900">{block.title}</h4>
              {block.paragraphs?.map((paragraph) => (
                <p key={paragraph} className="text-xs leading-relaxed text-zinc-600">
                  {paragraph}
                </p>
              ))}
              {block.formula ? (
                <pre className="overflow-x-auto rounded bg-zinc-50 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-800 whitespace-pre-wrap">
                  {block.formula}
                </pre>
              ) : null}
              {block.bullets ? (
                <ul className="list-disc pl-5 space-y-1 text-xs leading-relaxed text-zinc-600">
                  {block.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
