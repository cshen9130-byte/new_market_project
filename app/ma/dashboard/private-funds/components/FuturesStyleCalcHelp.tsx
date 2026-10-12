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

const DAILY_RETURN_FORMULA = `key = 因子名 + ":" + 日期 + ":" + 板块代码
h₀ = 0
对 key 的每个字符 c：
  h ← (h × 31 + Unicode(c)) mod 2³²     （无符号 32 位整数）
base = ((h mod 200) − 100) / 100
wave = sin(h mod 17) × 0.35             （sin 的自变量为弧度）
r(f, t, s) = round(base + wave, 2)`

const SECTOR_DELTA = `δ(全部 all)        =  0
δ(商品 commodity)  = +0.03
δ(黑色 black)      = +0.08
δ(有色 nonferrous) = −0.05
δ(能化 energy)     = +0.12
δ(农产 agri)       = −0.10`

const FACTOR_DEFINITIONS: HelpBlock = {
  title: "因子名称的研究定义",
  paragraphs: [
    "下面是这些名称在商品期货风格研究里的常用做法。本页曲线没有用主力合约行情按这些信号做多空，数值只来自上一节的公式。信号一律用 t−1 及更早的数据，当日收益用 r_{i,t} = P_{i,t} / P_{i,t−1} − 1，避免用到当天尚未实现的价格。",
  ],
  bullets: [
    "时间序列动量(短/中/长)：回看 L = 20 / 60 / 120 个交易日。过去收益 R_{i}(L) = P_{i,t−1} / P_{i,t−1−L} − 1，方向 s_{i} = sign(R_{i}(L))。σ_{i} 为过去 60 日收益的样本标准差。权重 w_{i} = s_{i} / σ_{i}。因子收益 = Σ w_{i} r_{i,t} / Σ |w_{i}|。",
    "截面动量(短) / 截面动量：同样用 L = 20 / 60 的过去收益，但在当日截面上排序。做多最高的 20%，做空最低的 20%，组内等权。因子收益 = 多头组收益 − 空头组收益。",
    "期限结构动量：斜率 θ_{i,t} = ln(近月价 / 远月价)。信号 = sign(θ_{i,t−1} − θ_{i,t−1−L})，L = 60，再按时间序列动量的波动倒数加权合成。",
    "基差动量：BM_{i} = R^{近月}(L) − R^{远月}(L)。截面做多 BM 高的合约、做空 BM 低的合约。",
    "库存因子：信号 = −zscore(库存 / 季节均值)，在有库存数据的品种上做多偏低库存、做空偏高库存。zscore 在当日截面上计算。",
    "波动因子(短) / 波动因子：σ 为 L = 20 / 60 日收益的样本标准差。做多 σ 最低的 20%，做空 σ 最高的 20%。图上是该组合的收益，不是波动率本身。",
    "流动性因子：Amihud = (1/L) Σ |r| / 成交额，L = 20。做多 Amihud 低的合约，做空 Amihud 高的合约。",
    "均价偏离因子：Dev = P / MA₂₀(P) − 1。反转组合：做多 Dev 最低的一组，做空 Dev 最高的一组。",
    "偏度因子：Skew = (1/L) Σ [(r − μ) / σ]³，L = 20。做多偏度低、做空偏度高。",
    "基差因子：Carry = 近月价 / 远月价 − 1。做多贴水（Carry 高），做空升水（Carry 低）。",
    "博弈意愿因子：Spec = 成交量 / 持仓量。截面对 Spec 做 z-score 后，做多投机度高、做空投机度低。",
    "持仓变化因子：ΔOI = 持仓量_t / 持仓量_{t−1} − 1。Score = sign(r) × ΔOI，用 t−1 的 Score 排序，做多高分、做空低分。",
  ],
}

const SHARED_GENERATOR: HelpBlock[] = [
  {
    title: "日收益 r(f, t, s) 怎么来的",
    paragraphs: [
      "卡片、柱状图和累计曲线里的每一个日收益，都由因子名 f、交易日 t、板块代码 s 唯一决定。同一组输入永远得到同一个数，所以改日期或换板块后图表可以复现。",
      "板块代码用英文键，不用页签上的中文：全部 = all，商品 = commodity，黑色 = black，有色 = nonferrous，能化 = energy，农产 = agri。",
    ],
    formula: DAILY_RETURN_FORMULA,
    bullets: [
      "round(x, 2) 是四舍五入到两位小数，与 JavaScript Math.round 一致：恰好 .5 时向正无穷方向取整。",
      "h mod 200、h mod 17 都是非负余数。sin 使用弧度，不是角度。",
    ],
  },
  {
    title: "板块平移 δ(s)",
    paragraphs: [
      "换板块时会做两件事：一是把板块代码写进哈希，日收益 r 本身会变；二是再加上板块平移 δ(s)。δ 的单位和页面上的百分数读数相同，+0.03 表示在读数上加 0.03 个百分点。",
    ],
    formula: SECTOR_DELTA,
    bullets: [
      "「全部」和「商品」都展示全部因子，但 δ 和哈希里的板块代码不同，所以两个页签的数字不一样。",
      "黑色、有色、能化、农产只保留标记为全市场、或标记为该板块的因子。基差动量和库存因子标在黑色；基差因子标在能化。其余因子标为全市场，四个板块页签都会出现。",
    ],
  },
  {
    title: "交易日",
    paragraphs: [
      "从起始日到结束日，逐日保留周一至周五。周六、周日去掉。落在周一至周五的法定节假日仍会留下，并参与下面的计算。",
    ],
  },
]

const HELP: Record<HelpSection, { heading: string; intro: string; blocks: HelpBlock[] }> = {
  latest: {
    heading: "最新风格因子收益 · 计算说明",
    intro: "每张卡片是查询区间最后一个交易日、当前板块下该因子的当日收益率（%）。",
    blocks: [
      ...SHARED_GENERATOR,
      {
        title: "卡片读数",
        paragraphs: [
          "设 T 为区间内最后一个交易日（周一至周五）。没有交易日时，改用因子表里的静态初值 v₀(f)。",
        ],
        formula: `有交易日：卡片(f) = round( r(f, T, s) + δ(s) , 2 )
无交易日：卡片(f) = round( v₀(f) + δ(s) , 2 )`,
        bullets: [
          "正数显示为红色，负数显示为绿色，零为灰色。",
          "例：全部板块、2026-06-29、「时间序列动量(短)」。key = 时间序列动量(短):2026-06-29:all，h = 1147151565，h mod 200 = 165，base = 0.65；h mod 17 = 14，wave = sin(14) × 0.35 ≈ 0.3467。base + wave ≈ 0.9967，round 后 r = 1.00。δ(all) = 0，卡片为 +1.00%。",
        ],
      },
      FACTOR_DEFINITIONS,
    ],
  },
  daily: {
    heading: "单日风格因子收益 · 计算说明",
    intro: "每根柱子是该因子在该交易日的收益率（%）。同一天的多根柱子并排，图例可单独隐藏。",
    blocks: [
      ...SHARED_GENERATOR,
      {
        title: "柱子高度",
        paragraphs: [
          "对每个因子 f、每个交易日 t，先加上板块平移，再四舍五入，最后截断到 [−3.8, 3.8]。截断只影响画出来的高度，哈希本身不截断。",
        ],
        formula: `y(f, t) = clip( round( r(f, t, s) + δ(s) , 2 ) , −3.8, 3.8 )
clip(x, a, b) = min(b, max(a, x))`,
        bullets: [
          "纵轴固定在 −4% 到 4%，刻度间隔 1%。超出 ±3.8 的点画在边界上。",
          "隐藏图例只改显示，不改已算出的 y。",
          "卡片上的「最新」读数，就是这张图最后一个交易日、截断之前的 round(r + δ, 2)。最新卡片不再做 ±3.8 截断。",
        ],
      },
      FACTOR_DEFINITIONS,
    ],
  },
  interval: {
    heading: "区间统计 · 计算说明",
    intro: "六列是各因子在近一周、近一月、近三月、近六月、近一年、今年以来的区间收益率（%）。",
    blocks: [
      {
        title: "这张表不由日频柱子累加",
        paragraphs: [
          "每一列使用因子自己的预设区间收益 R₀(f, k)，再加上 10 倍板块平移。它不是「单日风格因子收益」里那些柱子的求和，也不是连乘复利。表里的因子名称和上面的卡片也不完全相同。",
          "标题下的截止日等于区间最后一个交易日，只用来标注，不进入算式。",
        ],
        formula: `区间(f, k) = round( R₀(f, k) + 10 × δ(s) , 2 )
k ∈ {近一周, 近一月, 近三月, 近六月, 近一年, 今年以来}`,
        bullets: [
          "δ(s) 与卡片相同：全部 0，商品 +0.03，黑色 +0.08，有色 −0.05，能化 +0.12，农产 −0.10。乘以 10 之后，商品页签每列比全部页签高 0.30 个百分点。",
          "板块筛选与卡片相同：期限基差动量、基差因子标在能化，基差动量标在黑色，其余标为全市场。",
          "若要把日收益复利成区间收益，标准写法是 R = ∏(1 + r_t) − 1。本表没有使用这个式子。",
        ],
      },
      FACTOR_DEFINITIONS,
    ],
  },
  cumulative: {
    heading: "风格因子累计收益 · 计算说明",
    intro: "折线是查询区间内各因子收益率的算术累计路径，起点为 0。纵轴单位是 %。",
    blocks: [
      ...SHARED_GENERATOR,
      {
        title: "累计路径",
        paragraphs: [
          "累计用的日增量不是柱状图上的 y。它把日收益 r 缩小到 0.32 倍，再加上只依赖因子名的漂移，以及 0.15 倍板块平移。第一个交易日固定为 0，从第二个交易日开始累加。累加是算术相加，不是复利 ∏(1 + r) − 1。",
        ],
        formula: `h_f = Hash32(因子名)                 （不含日期、不含板块）
drift(f) = ((h_f mod 200) − 100) / 400
C₀ = 0
d_t = r(f, t, s) × 0.32 + drift(f) + 0.15 × δ(s)    （t 从第 2 个交易日起）
C_t = clip( round(C_{t−1} + d_t , 2) , −20, 15 )`,
        bullets: [
          "Hash32 与日收益里的哈希相同：h₀ = 0，h ← (h × 31 + Unicode(c)) mod 2³²。",
          "每一步先相加再 round 到两位，然后再截断到 [−20, 15]。纵轴固定 −20% 到 15%，刻度间隔 5%。",
          "这张图的因子名单与卡片、柱状图不同，例如多了低波动因子、价值收益因子、峰度因子。板块筛选规则相同：短期基差动量标在能化，基差动量标在黑色。",
          "低波动因子与波动因子的研究定义相同，都是做多低波动、做空高波动。价值收益因子对应基差（Carry）的多空收益。峰度因子用 L = 60 的超额峰度做截面多空：做多峰度低、做空峰度高。",
        ],
      },
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
              {block.bullets?.length ? (
                <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-zinc-600">
                  {block.bullets.map((item) => (
                    <li key={item}>{item}</li>
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
