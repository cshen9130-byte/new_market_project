"use client"

import { type ButtonHTMLAttributes, forwardRef } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export type ChartHelpBlock = {
  title: string
  paragraphs?: string[]
  formula?: string
  bullets?: string[]
}

export type ChartHelpSpec = {
  heading: string
  blocks: ChartHelpBlock[]
}

const HelpTrigger = forwardRef<
  HTMLButtonElement,
  { label: string } & ButtonHTMLAttributes<HTMLButtonElement>
>(function HelpTrigger({ label, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={`${label} 计算说明`}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-input text-[11px] font-medium leading-none text-muted-foreground hover:bg-muted hover:text-foreground"
      {...props}
    >
      ?
    </button>
  )
})

export function QuantChartHelp({ spec }: { spec: ChartHelpSpec }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <HelpTrigger label={spec.heading} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[26rem] max-h-[75vh] overflow-y-auto p-3.5 text-xs leading-relaxed text-muted-foreground">
        <div className="font-semibold text-foreground mb-2">{spec.heading}</div>
        <div className="space-y-3">
          {spec.blocks.map((block) => (
            <section key={block.title} className="space-y-1.5">
              <h4 className="font-semibold text-foreground">{block.title}</h4>
              {block.paragraphs?.map((p) => <p key={p}>{p}</p>)}
              {block.formula ? (
                <p className="rounded bg-muted px-2.5 py-2 font-mono text-[11px] text-foreground tabular-nums whitespace-pre-wrap">
                  {block.formula}
                </p>
              ) : null}
              {block.bullets?.length ? (
                <ul className="list-disc space-y-1 pl-4">
                  {block.bullets.map((item) => <li key={item}>{item}</li>)}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

const STATS: ChartHelpBlock = {
  title: "柱高与统计",
  paragraphs: [
    "柱高是该档内账户日盈亏的算术平均，不是区间合计。合计、天数、日胜率、t 统计在 tooltip。",
  ],
  formula: "日均 = Σ 日盈亏 / 天数\nt = 日均 / (样本标准差 / √天数)\n日胜率 = 日盈亏>0 的天数 / 天数",
  bullets: [
    "t 需至少 5 个交易日才计算。|t|≥2 大致说明该档均值不为 0。",
    "同一天可以同时落在不同因子族里，不能把各图的柱加总。",
    "日盈亏来自核算日报：当日盈亏 − 手续费 + 权利金净额。",
  ],
}

export const FACTOR_HELP: Record<string, ChartHelpSpec> = {
  nhSide: {
    heading: "商品涨跌 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: ["用南华商品指数（NHCI.NH）当日收益给每个交易日贴标签，再汇总账户当天净盈亏。"],
      },
      {
        title: "计算",
        formula: "r_南华,t = NHCI_t / NHCI_{t-1} − 1\n上涨日：r ≥ 0　　下跌日：r < 0",
      },
      {
        title: "怎么读",
        bullets: [
          "上涨日大赚、下跌日大亏 = 商品多头 beta，不一定是趋势跟踪。",
          "KPI「南华涨/跌捕获」= 账户日收益率之和 / 南华日收益之和，涨日与跌日分开。",
          "捕获接近 1 表示几乎跟着指数走；下跌捕获低于上涨捕获说明跌时少亏或没跟上。",
        ],
      },
      STATS,
    ],
  },
  carry: {
    heading: "期限结构 / Carry · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: [
          "商品曲线的近月相对远月贵还是便宜。贴水（backwardation）时多头展期通常有正收益；升水（contango）相反。",
        ],
      },
      {
        title: "计算",
        paragraphs: ["每天对每个商品品种取持仓量最大的两个合约（主力、次主力），去掉股指和国债。"],
        formula: "年化价差 = (远月结算 / 近月结算 − 1) × 12 / 月份差\n当日市场 Carry = 各品种年化价差的中位数",
      },
      {
        title: "分档",
        bullets: [
          "把区间内所有交易日的 Carry 按数值排序，再按秩次切成四等份：更贴水 / 偏贴水 / 偏升水 / 更升水。",
          "这是相对本区间，不是绝对「深贴水 10%」。一段长期升水里，「更贴水」只表示相对最不升水。",
        ],
      },
      {
        title: "怎么读",
        bullets: [
          "只在更贴水赚钱、更升水亏 = 在吃 roll yield / 多头展期。",
          "升水也赚、贴水也赚，要再看趋势交叉图，可能只是碰巧赶上单边。",
        ],
      },
      STATS,
    ],
  },
  trend: {
    heading: "多周期趋势 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: ["南华商品指数在短、中、长三个窗口上是否同向，用来区分真趋势和逆大趋势的反弹。"],
      },
      {
        title: "计算",
        formula: "r5  = NHCI_t / NHCI_{t-5}  − 1\nr20 = NHCI_t / NHCI_{t-20} − 1\nr60 = NHCI_t / NHCI_{t-60} − 1",
        bullets: [
          "三周期同向多：r5、r20、r60 都 ≥ 0",
          "三周期同向空：三个都 < 0",
          "短多长空：r5 ≥ 0 且 r60 < 0（下跌趋势里的反弹）",
          "短空长多：其余混号（上涨趋势里的回调等）",
        ],
      },
      {
        title: "怎么读",
        bullets: [
          "同向多和同向空都赚 = 双边趋势跟踪。",
          "只赚同向多、同向空亏 = 多头趋势 / 商品 beta。",
          "短多长空赚钱 = 逆势抄反弹，不是跟趋势。",
        ],
      },
      STATS,
    ],
  },
  path: {
    heading: "路径质量 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: ["Kaufman 效率比（ER）衡量 20 日价格走得干不干净：净位移相对路径长度。"],
      },
      {
        title: "计算",
        formula: "ER = |NHCI_t − NHCI_{t-20}| / Σ_{j=t-19..t} |NHCI_j − NHCI_{j-1}|",
        bullets: [
          "干净单边：ER ≥ 0.35",
          "来回摩擦：ER < 0.35",
        ],
      },
      {
        title: "怎么读",
        paragraphs: [
          "和「多周期趋势」不同：趋势看的是窗口净涨跌符号，ER 看路径是否来回磨。20 日仍上涨但天天震荡，会落在来回摩擦。",
        ],
        bullets: [
          "只在干净单边赚钱 = 吃顺畅趋势，怕震荡市。",
          "来回摩擦也赚 = 更像高频 / 均值回归。",
        ],
      },
      STATS,
    ],
  },
  common: {
    heading: "共同因子 vs 分化 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: [
          "商品是齐涨齐跌，还是各板块各走各的。用南华分项：黑色、能化、有色、农产品、贵金属、新能源。",
        ],
      },
      {
        title: "计算",
        bullets: [
          "齐涨齐跌：过去 20 日分项收益的第一主成分解释度 ≥ 55%，或平均配对相关 ≥ 0.45。",
          "板块分化：PC1 < 40%，或平均相关 < 0.30。",
          "高/低离散：当日 6 个分项日收益的标准差，相对区间中位数对切。",
          "广度多头 / 空头：20 日收益 > 0 的分项占比 ≥ 60% / ≤ 40%。中间不上图。",
        ],
        formula: "PC1 解释度 = 最大特征值 / 协方差矩阵迹\n离散度 = stdev(各分项当日收益)",
      },
      {
        title: "怎么读",
        bullets: [
          "这 6 根柱不是互斥分档，同一天可以同时是齐涨齐跌 + 高离散 + 广度多头。",
          "齐涨齐跌赚钱、分化亏 = 方向 / beta CTA。",
          "分化和高离散赚钱 = 选品种、相对价值、对锁。",
        ],
      },
      STATS,
    ],
  },
  oi: {
    heading: "价仓四象限 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: ["国内期货桌常用的价与持仓量四象限，判断行情是新开仓推动还是旧仓回补 / 止损推动。"],
      },
      {
        title: "计算",
        paragraphs: ["每天每个商品取持仓量最大的主力合约，用当日涨跌幅和持仓量变化分类，再按成交量（缺省用持仓量）加权，取权重最大的象限作为当日市场标签。涨跌或仓差为 0 的品种跳过。"],
        bullets: [
          "价涨仓增：新多开仓",
          "价涨仓减：空头回补",
          "价跌仓增：新空开仓",
          "价跌仓减：多头止损 / 减仓",
        ],
      },
      {
        title: "怎么读",
        bullets: [
          "价仓同向（涨仓增、跌仓增）赚钱 = 吃新开仓推动的趋势。",
          "价跌仓减大亏 = 多头止损日受伤，常和商品 beta 叠加。",
        ],
      },
      STATS,
    ],
  },
  volLvl: {
    heading: "波动分位 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: ["南华 20 日实现波动在本区间样本里的高低，不用中位数对切成「高/低」两档。"],
      },
      {
        title: "计算",
        formula: "σ20,t = 过去 20 个南华日收益的样本标准差\n百分位 = 有多少个历史 σ20 ≤ 当日 σ20",
        bullets: [
          "波动低位：百分位 < 33%",
          "波动中位：33%–67%",
          "波动高位：≥ 67%",
        ],
      },
      {
        title: "怎么读",
        bullets: [
          "高波动亏、中低波动赚 = 怕冲击，不像波动突破策略。",
          "百分位相对本区间，换时间窗口阈值会变。",
        ],
      },
      STATS,
    ],
  },
  volExp: {
    heading: "波动扩张 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: ["短窗波动相对长窗是刚放大还是已经收敛。很多 CTA 亏在扩张日，而不是波动绝对值高。"],
      },
      {
        title: "计算",
        formula: "ratio = σ20 / σ60\n扩张：ratio > 1.1　　收敛：ratio < 0.9",
        paragraphs: ["介于 0.9 和 1.1 之间不上图。σ60 用过去 60 个南华日收益的样本标准差。"],
      },
      {
        title: "怎么读",
        bullets: [
          "扩张亏、收敛赚 = 不擅长刚发生的波动冲击。",
          "扩张也赚 = 更像突破 / 趋势在波动起来时加仓。",
        ],
      },
      STATS,
    ],
  },
  volSkew: {
    heading: "上下行波动 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: ["南华近 20 日跌的时候晃得大，还是涨的时候晃得大。"],
      },
      {
        title: "计算",
        formula: "下行半波动 = stdev(过去 20 日里 r < 0 的收益)\n上行半波动 = stdev(过去 20 日里 r > 0 的收益)\n比 = 下行 / 上行",
        bullets: [
          "下行波动主导：比 > 1.2",
          "上行波动主导：比 < 0.8",
        ],
      },
      {
        title: "怎么读",
        paragraphs: ["下行波动主导且账户亏，说明跌势比涨势更猛时受伤，常和多头 beta 一起出现。"],
      },
      STATS,
    ],
  },
  cluster: {
    heading: "宏观状态 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: [
          "与宏观页同一套：沪深300ETF、中证500ETF、国债ETF、公司债ETF、货币ETF、黄金ETF、南华商品的日收益，先标准化再 PCA，再用 4 簇 GMM。结果在 current_market_prediction。",
        ],
      },
      {
        title: "四簇含义",
        bullets: [
          "滞涨 / 中性（簇 0）：增长↓ 避险↑，黄金国债偏强",
          "衰退（簇 1）：增长↓ 避险↓，政策宽松预期",
          "过热（簇 2）：增长↑ 避险↑，股金可能齐升",
          "复苏（簇 3）：增长↑ 避险↓，股票与商品走强",
        ],
      },
      {
        title: "怎么读",
        paragraphs: ["看账户日盈亏落在哪一簇，不是看南华自己涨跌。复苏赚钱、滞涨也赚钱，和「商品上涨日赚钱」不是同一件事。"],
      },
      STATS,
    ],
  },
  sleeve: {
    heading: "板块相对强弱 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: ["工业品、农产品、贵金属谁在过去 20 日更强。南华综合上涨时，驱动可能完全不同。"],
      },
      {
        title: "计算",
        formula: "工业品 = 平均(黑色 NHFI、能化 NHECI、有色 NHNFI) 的 20 日收益\n农产品 = NHAI 20 日收益\n贵金属 = NHPMI 20 日收益",
        bullets: [
          "领先档必须比第二名高出至少 0.5 个百分点，否则记为「相对均衡」。",
        ],
      },
      {
        title: "怎么读",
        bullets: [
          "工业品强赚钱 = 更吃需求 / 黑色能化。",
          "贵金属强赚钱 = 更吃实际利率 / 避险。",
          "和右侧「板块盈亏」不同：这里是市场状态，那里是账户持仓贡献。",
        ],
      },
      STATS,
    ],
  },
}

export const CHART_HELP: Record<string, ChartHelpSpec> = {
  overview: {
    heading: "哪种市场赚得多 · 计算说明",
    blocks: [
      {
        title: "在算什么",
        paragraphs: [
          "把每个交易日的账户净盈亏，按市场因子打标签后求该档日均。用来回答策略在哪种环境下赚钱，而不是再画一根南华涨跌。",
        ],
      },
      {
        title: "日盈亏",
        formula: "日盈亏 = 当日盈亏 − 当日手续费 + 权利金收入 − 权利金支出",
        paragraphs: ["来自核算日报。因子标签来自南华指数、主力次主力曲线、价仓和宏观 GMM。"],
      },
      STATS,
    ],
  },
  equity: {
    heading: "累计盈亏与回撤 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: ["左轴是区间内日盈亏累加，右轴是相对权益峰值的回撤。"],
      },
      {
        title: "计算",
        formula: "累计盈亏_t = Σ_{i≤t} 日盈亏_i\n回撤% = (当日权益 − 区间峰值权益) / 峰值权益 × 100",
        paragraphs: ["权益取核算日报「客户权益」。若权益缺失则用累计盈亏代替净值。"],
      },
      {
        title: "怎么读",
        bullets: [
          "趋势跟踪常见：回撤深、恢复慢、台阶式创新高。",
          "短线常见：曲线碎、回撤浅、来回磨。",
        ],
      },
    ],
  },
  hist: {
    heading: "日盈亏分布 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: ["把区间内每个交易日的净盈亏打进等宽箱子，看赚亏的分布形状。"],
      },
      {
        title: "怎么读",
        bullets: [
          "柱子堆在 0 左侧、右尾很长 = 经常小亏、偶尔大赢，像趋势。",
          "两边对称且靠近 0 = 高频刮头皮。",
          "和日胜率、盈亏比一起看，不要单独读。",
        ],
      },
    ],
  },
  heatmap: {
    heading: "Carry × 趋势一致性 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: ["同一天同时看期限结构四分位和 5/20/60 日趋势符号，格子是该交叉档的日均盈亏。"],
      },
      {
        title: "计算",
        paragraphs: ["Carry 分档、趋势分档与左边两张图完全相同。格子颜色按日均盈亏，红赚绿亏。"],
        formula: "格子 = 平均( 日盈亏 | Carry档 ∩ 趋势档 )",
      },
      {
        title: "怎么读",
        bullets: [
          "只在「更贴水 × 同向多」赚钱 = 展期 + 商品多头，不是双边趋势。",
          "同向多和同向空在升水、贴水里都赚 = 真趋势跟踪。",
          "天数很少的格子（<8 日）不要过度解释。",
        ],
      },
    ],
  },
  sector: {
    heading: "板块盈亏 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: ["账户持仓贡献按品种板块加总，不是「该板块指数涨的那天账户赚不赚」。"],
      },
      {
        title: "计算",
        formula: "板块盈亏 = Σ 平仓盈亏 + Σ 持仓盯市\n（未扣手续费）",
        paragraphs: ["合约前缀映射到农产 / 黑色 / 能化 / 有色 / 贵金属等。区间净盈亏来自日报，会再扣手续费，所以两边对不上是正常的。"],
      },
      {
        title: "怎么读",
        bullets: [
          "只看平仓会把「拿着赚、换仓亏」画成全板块亏损。",
          "和「板块相对强弱」对照：那边是市场谁强，这边是你账上谁贡献。",
        ],
      },
    ],
  },
  risk: {
    heading: "风险度 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: ["核算日报里的「风险度」，即保证金占用相对客户权益的杠杆水平。"],
      },
      {
        title: "怎么读",
        bullets: [
          "突然抬升 = 加仓或保证金率上升。",
          "长期顶在高位 = 杠杆用满，回撤时缓冲薄。",
        ],
      },
    ],
  },
  after: {
    heading: "赚了 / 亏了之后第二天 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: ["看盈利日、亏损日之后的下一个交易日，风险度和开平仓行为怎么变。"],
      },
      {
        title: "计算",
        formula: "Δ风险度 = 次日风险度 − 当日风险度\n开仓占比 = 次日开仓手数 / (开仓手数 + 平仓手数)",
        paragraphs: ["图中两根柱分别是盈利日后、亏损日后的平均 Δ风险度（或开仓占比，以图例为准）。"],
      },
      {
        title: "怎么读",
        bullets: [
          "亏完次日风险度下降、开仓占比低 = 止损 / 降杠杆。",
          "亏完次日风险度上升 = 摊平或加仓。",
        ],
      },
    ],
  },
  payoff: {
    heading: "盈亏偏好 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: ["按平仓记录算胜率、平均盈利、平均亏损，看是刮头皮还是趋势结构。"],
      },
      {
        title: "计算",
        formula: "平仓胜率 = 盈利平仓手数 / 有盈亏的平仓手数\n盈亏比 = 平均盈利 / |平均亏损|",
      },
      {
        title: "怎么读",
        bullets: [
          "高胜率、盈亏比接近 1 = 高频 / 刮头皮。",
          "低胜率、盈利柱远高于亏损柱 = 趋势跟踪。",
        ],
      },
    ],
  },
  hold: {
    heading: "持仓多久才走 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: ["平仓记录的持仓天数（平仓日 − 开仓日），按日内 / 1 日 / 2–5 日 / 6–20 日 / 21 日+ 分箱，再拆盈利单和亏损单。"],
      },
      {
        title: "怎么读",
        bullets: [
          "亏损单平均持仓明显长于盈利单 = 扛单（处置效应）。",
          "盈利单拿得更久 = 让利润奔跑。",
        ],
      },
    ],
  },
  session: {
    heading: "日盘 vs 夜盘 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: ["按成交时间把成交手数和平仓盈亏拆成日盘、夜盘。"],
      },
      {
        title: "计算",
        formula: "夜盘：成交时间 21:00–08:00\n日盘：其余",
        paragraphs: ["看的是平仓盈亏发生在哪一盘，不是持仓盯市。"],
      },
    ],
  },
  ls: {
    heading: "多头 vs 空头 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: ["卖平记为平多头，买平记为平空头，再加上持仓盯市按买卖持仓拆开。"],
      },
      {
        title: "计算",
        formula: "多头 = 卖平平仓盈亏 + 买持仓盯市\n空头 = 买平平仓盈亏 + 卖持仓盯市",
      },
      {
        title: "怎么读",
        paragraphs: ["钱经常是拿着赚的，平仓只是换仓成本。多头柱高不代表一直做多，只代表多头侧贡献更大。"],
      },
    ],
  },
  hedge: {
    heading: "持仓是否对冲 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: ["每天用持仓市值看账户有多「多空对锁」。"],
      },
      {
        title: "计算",
        formula: "对冲度 = 2 × min(多市值, 空市值) / (多市值 + 空市值)\n双开 = 同一合约既有买持仓又有卖持仓的市值 / 总市值",
      },
      {
        title: "怎么读",
        bullets: [
          "对冲度接近 100% = 账面几乎锁住。",
          "对冲度高但双开接近 0 = 跨品种对冲，挡不住商品指数同向波动。",
        ],
      },
    ],
  },
  products: {
    heading: "品种明细 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: ["每个品种在区间内的合计盈亏、手数和持仓习惯。按合计盈亏排序。"],
      },
      {
        title: "计算",
        bullets: [
          "合计 = 平仓盈亏 + 持仓盯市（未扣手续费）。",
          "胜率、盈亏比、盈/亏持仓天数按平仓手数加权。",
          "品种代码取合约字母前缀，再映射板块。",
        ],
      },
    ],
  },
  capture: {
    heading: "南华涨 / 跌捕获 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: ["账户日收益率相对南华商品指数日收益，在上涨日和下跌日分别求和再相除。"],
      },
      {
        title: "计算",
        formula: "账户日收益_t = 日盈亏_t / 前一日客户权益\n上涨捕获 = Σ 账户日收益 / Σ 南华日收益　　（仅 r_南华 > 0）\n下跌捕获同理，仅 r_南华 < 0",
        paragraphs: ["至少 8 个对应交易日才出数。"],
      },
      {
        title: "怎么读",
        bullets: [
          "上涨 0.18 / 下跌 0.10 = 涨时跟上一部分，跌时没有按同样比例亏完。",
          "两边都接近 1 = 几乎是商品多头。",
          "上涨正、下跌负且绝对值大 = 涨也跟、跌亏得更多。",
        ],
      },
    ],
  },
  overlay: {
    heading: "累计盈亏对照 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: ["同一时间轴上各量化账户的累计日盈亏。缺失日期不连成 0，只在有核算的日子画点。"],
      },
      {
        title: "怎么读",
        paragraphs: ["曲线缠在一起 = 风格同质。点击上方账户卡片进入单账户详情。"],
      },
    ],
  },
  compareFactor: {
    heading: "因子对照 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: ["各账户在同一因子分档上的日均盈亏并排。分档规则与单账户页完全相同。"],
      },
      STATS,
    ],
  },
  compareKpi: {
    heading: "绩效对照 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: ["同一区间下各账户的核心指标。红底高亮为该行最优值（回撤取最大，即回撤最浅）。"],
      },
      {
        title: "涨/跌捕获",
        formula: "上涨捕获 = Σ 账户日收益率 / Σ 南华日收益　　（仅南华上涨日）\n下跌捕获同理，仅南华下跌日",
      },
    ],
  },
  comparePortrait: {
    heading: "画像对照 · 计算说明",
    blocks: [
      {
        title: "定义",
        paragraphs: ["由成交、平仓与日核算倒推的文字画像，不是投顾自述。「适合/不适合的市场」取各因子族里日均最好 / 最差的档（至少 8 个交易日）。"],
      },
    ],
  },
  bookVol: {
    heading: "组合层：市场波动 vs 总敞口 · 计算说明",
    blocks: [
      {
        title: "在算什么",
        paragraphs: [
          "每个交易日看整本账户的总敞口，对照当天的市场波动。这是组合层风险预算，不是品种之间谁多谁少。",
        ],
      },
      {
        title: "计算",
        formula: "总敞口 = Σ|持仓市值| / 客户权益\n市场波动 = 南华商品指数近 20 日收益标准差 × √252 × 100\n（南华不够时用该账户品种池中位 20 日波动）",
        paragraphs: ["散点是每个交易日。折线是把市场波动分成五档后的平均总敞口。ρ 是 Spearman（总敞口 vs 市场波动）。"],
      },
      {
        title: "怎么读",
        bullets: [
          "点/折线往右下：市场更吵时减仓，组合在做波动预算。",
          "往右上：市场更吵时仓位更大，组合风险被放大。",
          "几乎走平：仓位扛着不动，波动来了风险就上去。",
          "和右边「截面 1/σ」不是一回事：那边是同一天里吵的品种少配钱。",
        ],
      },
    ],
  },
  crossVol: {
    heading: "截面：品种波动 vs 市值权重 · 计算说明",
    blocks: [
      {
        title: "在算什么",
        paragraphs: [
          "同一天里，每个持仓品种的 20 日波动和它占当天总市值的权重。看高波动合约是不是被压仓。",
        ],
      },
      {
        title: "计算",
        formula: "权重 = |该品种市值| / Σ|市值|\nσ20 = 连续合约近 20 日收益标准差 × √252 × 100\nρ = Spearman(权重, 1/σ20)",
        paragraphs: ["点是品种日（过多时抽样）。折线是把品种波动分成五档后的平均权重。"],
      },
      {
        title: "怎么读",
        bullets: [
          "折线往右下、ρ(权重, 1/σ)>0：高波动品种少配，像品种层风险平价。",
          "折线往右上：高波动品种反而占更多钱。",
          "这不决定整本账户杠杆开多大。左边那张才是组合层。",
        ],
      },
    ],
  },
}

export function helpForFactor(familyKey: string, familyTitle: string): ChartHelpSpec {
  return FACTOR_HELP[familyKey] ?? {
    heading: `${familyTitle} · 计算说明`,
    blocks: [STATS],
  }
}
