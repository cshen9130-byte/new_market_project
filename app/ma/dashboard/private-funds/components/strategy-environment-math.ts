/** Step-by-step score writeups. Equations match lib/server/strategy-environment.ts. */

export type MathStep = { lead: string; latex: string }

export type FactorWriteup = {
  why: string
  steps: MathStep[]
}

/** Official 运维团队策略 path, plus the level-3 tags this environment score is written for. */
export type StrategyTagLine = { where: string; names: string }

export type StrategyAbout = {
  /** What the strategy does, before any talk of how the score is built. */
  meaning: string
  tags: StrategyTagLine[]
  /** Tags that look related but are not this score, and how the peer sample is chosen. */
  note: string
}

export type StrategyWriteup = {
  about: StrategyAbout
  why: string[]
  shared: MathStep[]
  factors: Record<string, FactorWriteup>
  /** Used when a factor key is not listed, for example each option underlying. */
  fallback?: FactorWriteup
  combine: MathStep[]
  rating: MathStep[]
  symbols: { symbol: string; meaning: string }[]
}

const Q = String.raw`q(x;x_1,\ldots,x_n)=\begin{cases}50 & n=0\\[6pt] \dfrac{\#\{i:x_i\le x\}}{n}\times 100 & n\ge 1\end{cases}`
const CLAMP = String.raw`\operatorname{clamp}(z)=\min(100,\max(0,z))`
const WEIGHT = String.raw`S=\operatorname{round}_{1}\!\left(\dfrac{\sum_{j\in J}s_j w_j}{\sum_{j\in J}w_j}\right)`
const VAR = String.raw`\operatorname{Var}(r_1,\ldots,r_n)=\dfrac{1}{n-1}\sum_{i=1}^{n}(r_i-\bar r)^2,\qquad \bar r=\dfrac{1}{n}\sum_{i=1}^{n}r_i`

const SHARED_Q: MathStep = {
  lead: "分位把今天的数放回它自己的近期历史里。窗口含今天，最多 60 个交易日。数一数窗口里有多少个小于等于今天，再换成 0 到 100。窗口是空的时候记 50，避免没有样本时假装极端。",
  latex: Q,
}
const SHARED_CLAMP: MathStep = {
  lead: "分数一律限制在 0 到 100。低于 0 的记 0，高于 100 的记 100。",
  latex: CLAMP,
}
const SHARED_WEIGHT: MathStep = {
  lead: "环境分是有数据的那些项的加权平均，再四舍五入到一位小数。某一项没有数据时，它不进入分子，也不进入分母，其余项的相对轻重保持原设计。页面上看到的权重，是这个归一结果再保留三位小数；手算时若先把权重舍入，可能和公布的环境分差 0.1。",
  latex: WEIGHT,
}

const PCT_SYMBOLS = [
  { symbol: "q(x;x_1,\\ldots,x_n)", meaning: "x 在样本 x_1 到 x_n 里的分位，范围 0 到 100。等于 x 的样本也算进去。" },
  { symbol: "n", meaning: "样本个数。分位窗口里是实际拿得到的天数，上限 60，并且包含今天。" },
  { symbol: "\\#\\{\\,\\cdot\\,\\}", meaning: "集合里元素的个数。" },
  { symbol: "\\operatorname{clamp}(z)", meaning: "把 z 截断到 0 与 100 之间。" },
  { symbol: "s_j", meaning: "第 j 项因子的分数，范围 0 到 100。分数高表示这一项当前对这个策略更有利。" },
  { symbol: "w_j", meaning: "第 j 项的设计权重。各项权重之和在设计时为 1；缺数据时按剩余项重新归一。" },
  { symbol: "J", meaning: "当天真正有分数、且权重大于 0 的因子集合。" },
  { symbol: "S", meaning: "环境分。先按权重归一求加权平均，再四舍五入到一位小数。" },
  { symbol: "\\operatorname{round}_{1}", meaning: "四舍五入，保留一位小数。" },
]

export const STRATEGY_MATH: Record<string, StrategyWriteup> = {
  quant: {
    about: {
      meaning: "宽基量化在沪深300、中证500、中证1000、中证A500 上做增强，或者做不押指数方向的量化选股。仓位跟着宽基走，赚的是股票之间的相对收益。",
      tags: [
        { where: "股票多头 / 指数增强", names: "300指增、500指增、1000指增、A500指增" },
      ],
      note: "2000指增、红利指增、小市值指增、北证50指增、空气指增、转债指增、主观多头、股票市场中性不归这一档。超额对比还多收观察分类「量化选股」：二级是量化选股、量化多头、量化精选，或产品名里带这些字。现行团队树上没有「量化选股」这个节点。",
    },
    why: [
      "分数同时看两件事：和近 20 日超额合不合拍，以及随后 20 日超额会不会更好。只追领先的话，分数会变成来回跳的变化，图上就看不出和超额的关系。",
      "振幅先取近 5 日平均，再看 40 日分位，权重 0.40。截面波动用当天的 40 日分位，权重 0.25。两融和成交仍用 60 日分位，权重 0.25 和 0.10。图上的 10 日均线和近 20 日超额的相关大约 0.53，和随后 20 日超额大约 0.32。前半段这两边大约是 0.83 和 0.49，后半段大约是 0.46 和 0.29。",
      "这四项都是分位越低，这一项越高。截面波动高、振幅高的日子，超额往往已经走弱。两融厚、成交热的日子，随后的超额更差。风格 HHI 和已经发生的超额有一点同向，但预测不了随后 20 日，所以不占权重。成交额周环比只写在读数里。",
    ],
    shared: [SHARED_Q, SHARED_CLAMP, SHARED_WEIGHT],
    factors: {
      breadth: {
        why: "量化选股和宽基指增是多头。近 20 个交易日里上涨的股票越多，这些产品越容易做出收益，随后一段时间的超额也更好。所以上涨占比的分位越高，这一项越高。",
        steps: [
          {
            lead: "每只股票用今天的收盘除以 20 个交易日前的收盘，再减 1。涨跌绝对值达到或超过 120% 的不进入，复牌和异常价不代表可交易的广度。",
            latex: String.raw`R_{i,t}^{(20)}=\dfrac{C_{i,t}}{C_{i,t-20}}-1`,
          },
          {
            lead: "上涨占比是这些股票里收益为正的比例。当天至少要有 1000 只有行情的股票。",
            latex: String.raw`B_t=\dfrac{\#\{\,i:\lvert R_{i,t}^{(20)}\rvert<1.2,\; R_{i,t}^{(20)}>0\,\}}{\#\{\,i:\lvert R_{i,t}^{(20)}\rvert<1.2\,\}}`,
          },
          {
            lead: "分数是 B 的 60 日分位。设计权重 0.30，和其他项一起归一。",
            latex: String.raw`s_{\text{广度}}=q\bigl(B_t;\,B_{t-n+1},\ldots,B_t\bigr)`,
          },
        ],
      },
      amp: {
        why: "日内高低差很大时，宽基调仓的冲击更大，近 20 日超额也更差。单日振幅太跳，所以先取近 5 日平均，再看它在近 40 日里的分位。分位低的时候这一项高。",
        steps: [
          {
            lead: "每只股票的振幅是最高价减去最低价，再除以前收盘。只保留 0 到 25% 之间的振幅，避免异常价把平均数拉飞。",
            latex: String.raw`u_{i,t}=\dfrac{H_{i,t}-L_{i,t}}{C_{i,t-1}}`,
          },
          {
            lead: "当天的振幅是这些股票的算术平均。",
            latex: String.raw`U_t=\operatorname{mean}\{\,u_{i,t}:0<u_{i,t}<0.25\,\}`,
          },
          {
            lead: "先取含今天的 5 个交易日振幅平均。不满 5 天时这一项不进入。",
            latex: String.raw`\bar U_t=\operatorname{mean}(U_{t-4},\ldots,U_t)`,
          },
          {
            lead: "分数是 100 减去这个平均振幅的 40 日分位。设计权重 0.40。",
            latex: String.raw`s_{\text{振幅}}=100-q\bigl(\bar U_t\bigr)`,
          },
        ],
      },
      xs: {
        why: "截面波动是当天个股日收益的离散程度。波动散开的时候，近 20 日超额通常更差，所以分位越低这一项越高。它和振幅一起，让红线跟得上黄线的起伏。",
        steps: [
          {
            lead: "每只股票用今天的收盘除以前收盘，再减 1。涨跌绝对值达到或超过 35% 的不进入。",
            latex: String.raw`r_{i,t}=\dfrac{C_{i,t}}{C_{i,t-1}}-1`,
          },
          {
            lead: "截面波动是这些收益率的样本标准差。",
            latex: String.raw`\sigma_t=\operatorname{stdev}\{\,r_{i,t}:\lvert r_{i,t}\rvert<0.35\,\}`,
          },
          {
            lead: "分数是 100 减去 σ 的 40 日分位。设计权重 0.25。窗口比两融短，是为了跟上近 20 日超额的转折。",
            latex: String.raw`s_{\text{截面}}=100-q\bigl(\sigma_t\bigr)`,
          },
        ],
      },
      amt: {
        why: "成交放得很大的时候，这些产品的收益更像指数，随后的超额更差。成交处在自己近 60 日低分位时，这一项高。周环比只是读数。",
        steps: [
          {
            lead: "当天全市场成交额是所有股票成交额之和。分位用这个原始合计，单位在比大小时会约掉。",
            latex: String.raw`A_t=\sum_i a_{i,t}`,
          },
          {
            lead: "分数是 100 减去 A 的 60 日分位。设计权重 0.10。周环比不进入这个分数。",
            latex: String.raw`s_{\text{成交}}=100-q\bigl(A_t;\,A_{t-n+1},\ldots,A_t\bigr)`,
          },
          {
            lead: "周环比用含今天的 5 个交易日成交额均值，除以再往前 5 个交易日的均值，再减 1。绝对值小于 5% 写成「基本平稳」，高于 5% 写成「较上周放量」，低于 −5% 写成「较上周缩量」。它不进入分数。",
            latex: String.raw`W_t=\dfrac{\operatorname{mean}(A_{t-4},\ldots,A_t)}{\operatorname{mean}(A_{t-9},\ldots,A_{t-5})}-1`,
          },
          {
            lead: "页面上写成「亿」只是读数。原始数不小于 10^10 时除以 10^8，不小于 10^6 时除以 10^4。这个换算不进入分数。",
            latex: String.raw`A_t^{\text{展示}}=\begin{cases}A_t/10^{8}&A_t\ge 10^{10}\\ A_t/10^{4}&A_t\ge 10^{6}\\ A_t&\text{其余}\end{cases}`,
          },
        ],
      },
      style: {
        why: "成交若堆在少数风格上，宽基选股能用的相对收益变窄。风格 HHI 低表示成交散在大中小盘、强弱两边，所以用 100 减分位。",
        steps: [
          {
            lead: "流通市值用成交额除以换手率。换手率按百分数理解，只保留 0.05% 到 40% 之间的股票。按流通市值从小到大累加，切成各占约三分之一市值的小、中、大三档。",
            latex: String.raw`\text{市值}_i=\dfrac{a_i}{\tau_i/100}`,
          },
          {
            lead: "每一档再按近 20 日涨跌分成强弱两半。没有市净率日频，所以这一刀用的是涨跌，不是成长和价值的基本面划分。六格成交额占比的平方和就是风格 HHI。六格完全平均时等于 1/6，约 0.167。",
            latex: String.raw`H^{\text{风格}}_t=\sum_{k=1}^{6}\left(\dfrac{A_{k,t}}{A_t}\right)^2`,
          },
          {
            lead: "分数是 100 减去这个 H 的 60 日分位。设计权重 0.17。风格 HHI 算不出的日子，用个股成交额 HHI 顶上，权重不变。",
            latex: String.raw`s_{\text{风格}}=100-q\bigl(H^{\text{风格}}_t\bigr)`,
          },
        ],
      },
      margin: {
        why: "两融余额堆在高位时，杠杆资金和指数涨跌绑在一起，随后的超额更差。余额用的是水平，不是变化：余额偏低的时候，分数已经在超额起来之前抬高，相关峰大约在分数之后 5 个交易日。",
        steps: [
          {
            lead: "余额是上交所和深交所融资融券余额之和，单位元。这个公布比行情慢，最新一笔若不超过 15 个自然日，就沿用到今天。",
            latex: String.raw`M_t=M_t^{\text{沪}}+M_t^{\text{深}}`,
          },
          {
            lead: "分数是 100 减去 M 的 60 日分位。设计权重 0.25。没有余额时这一项不进入，其余权重按比例放大。",
            latex: String.raw`s_{\text{两融}}=100-q\bigl(M_t;\,M_{t-n+1},\ldots,M_t\bigr)`,
          },
        ],
      },
      hhi: {
        why: "成交如果堆在少数股票上，名义上的全市场成交对宽基组合是虚的。赫芬达尔指数高表示集中，所以用 100 减分位，越分散这一项越高。",
        steps: [
          {
            lead: "HHI 读自成交拥挤的日频派生表，本页不再重算。它的定义是各股成交占比的平方和。占比越平均，H 越接近 0；成交全在一只股票上时，H 等于 1。",
            latex: String.raw`H_t=\sum_i\left(\dfrac{a_{i,t}}{A_t}\right)^2`,
          },
          {
            lead: "先取 H 的 60 日分位。历史里有效 H 少于 15 天时，这一项整天不进入环境分。",
            latex: String.raw`h_t=q\bigl(H_t;\,H_{t-n+1},\ldots,H_t\bigr)`,
          },
          {
            lead: "分数是 100 减去集中度分位。只在风格 HHI 缺失时使用，权重仍是 0.17。",
            latex: String.raw`s_{\text{分散}}=100-h_t`,
          },
        ],
      },
      size: {
        why: "这一档产品里 500、1000、A500 和量化选股对小盘更敏感。中证1000近 20 日强于沪深300时，同类净值通常也更好。它只占一小块权重：单独看，它几乎不预测之后 20 日。",
        steps: [
          {
            lead: "两边都是指数收盘价相对 20 个交易日前收盘的收益率。差是中证1000减去沪深300。",
            latex: String.raw`D_t=\left(\dfrac{P_t^{1000}}{P_{t-20}^{1000}}-1\right)-\left(\dfrac{P_t^{300}}{P_{t-20}^{300}}-1\right)`,
          },
          {
            lead: "分数是这个差的 60 日分位。设计权重 0.08。任一指数当天没有收盘价时，这一项不进入。",
            latex: String.raw`s_{\text{小盘}}=q\bigl(D_t;\,D_{t-n+1},\ldots,D_t\bigr)`,
          },
        ],
      },
    },
    combine: [
      {
        lead: "设计权重是日内振幅 0.40、截面波动 0.25、两融余额 0.25、成交热度 0.10。缺哪一项，就把剩下的权重除以它们的和。",
        latex: String.raw`w_{\text{振幅}}=0.40,\; w_{\text{截面}}=0.25,\; w_{\text{两融}}=0.25,\; w_{\text{成交}}=0.10`,
      },
      SHARED_WEIGHT,
      {
        lead: "状态只看环境分，从上到下命中第一条就停。成交冷不再单独写成谨慎，因为这档分数里成交冷是随后超额更好的迹象。",
        latex: String.raw`\text{状态}=\begin{cases}\text{环境偏好}& S\ge 72\\ \text{良（可做）}& S\ge 64\\ \text{中性}& S\ge 56\\ \text{谨慎}& S\ge 45\\ \text{偏弱}& S<45\end{cases}`,
      },
    ],
    rating: [],
    symbols: [
      ...PCT_SYMBOLS,
      { symbol: "i", meaning: "股票。下标 t 是交易日。" },
      { symbol: "C_{i,t}", meaning: "股票 i 在 t 日的收盘价。" },
      { symbol: "R_{i,t}^{(20)}", meaning: "股票 i 近 20 个交易日的收益率。" },
      { symbol: "B_t", meaning: "近 20 日上涨股票的占比。涨跌绝对值达到 120% 的股票不进入。" },
      { symbol: "H_{i,t}", meaning: "股票 i 在 t 日的最高价。" },
      { symbol: "L_{i,t}", meaning: "股票 i 在 t 日的最低价。" },
      { symbol: "u_{i,t}", meaning: "股票 i 的日内振幅，最高价减最低价，再除以前收盘。" },
      { symbol: "U_t", meaning: "当天股票振幅的平均数，只保留 0 到 25%。" },
      { symbol: "\\bar U_t", meaning: "含今天的 5 个交易日振幅平均。环境分用的是这个数的 40 日分位。" },
      { symbol: "\\sigma_t", meaning: "当天个股日收益率的截面标准差。涨跌绝对值达到 35% 的股票不进入。" },
      { symbol: "P_t^{1000}", meaning: "中证1000在 t 日的收盘价。" },
      { symbol: "P_t^{300}", meaning: "沪深300在 t 日的收盘价。" },
      { symbol: "D_t", meaning: "中证1000近 20 日收益率减去沪深300近 20 日收益率。" },
      { symbol: "a_{i,t}", meaning: "股票 i 在 t 日的成交额，使用库里的原始单位。" },
      { symbol: "A_t", meaning: "t 日全市场成交额合计。" },
      { symbol: "W_t", meaning: "成交额周环比。含今天的 5 日均值，除以再往前 5 日的均值，再减 1。只展示，不进入环境分。" },
      { symbol: "A_t^{\\text{展示}}", meaning: "把 A_t 换成「亿」之后的读数，只用于显示。" },
      { symbol: "H_t", meaning: "t 日个股成交额的赫芬达尔指数。风格 HHI 缺失时才用来代替。" },
      { symbol: "\\tau_i", meaning: "股票 i 的换手率，按百分数。1.7 表示 1.7%。" },
      { symbol: "H^{\\text{风格}}_t", meaning: "六格风格成交额占比的平方和。六格是市值三档，再各按 20 日涨跌分成强弱。" },
      { symbol: "M_t", meaning: "沪深两市融资融券余额之和，单位元。" },
      { symbol: "s_{\\text{广度}}", meaning: "20 日上涨占比的分位。" },
      { symbol: "s_{\\text{振幅}}", meaning: "100 减近 5 日平均振幅的 40 日分位。" },
      { symbol: "s_{\\text{截面}}", meaning: "100 减截面波动的 40 日分位。" },
      { symbol: "s_{\\text{风格}}", meaning: "100 减风格 HHI 的分位。" },
      { symbol: "s_{\\text{两融}}", meaning: "100 减两融余额的 60 日分位。" },
      { symbol: "s_{\\text{小盘}}", meaning: "中证1000相对沪深300的 20 日收益差的分位。" },
      { symbol: "h_t", meaning: "H_t 的 60 日分位。" },
      { symbol: "s_{\\text{成交}}", meaning: "100 减全 A 成交额的 60 日分位。设计权重 0.10。" },
      { symbol: "s_{\\text{分散}}", meaning: "成交分散因子分，等于 100 减 H 的分位。" },
    ],
  },
  momentum: {
    about: {
      meaning: "强势股做涨停和连板接力。看的是当天的涨停生态，不是指数方向，也不是持有几个月的基本面。",
      tags: [
        { where: "股票对冲 / 打板", names: "强势股、盘前板、盘中板、排板、扫板、量化、主观" },
      ],
      note: "打板下面这 7 个三级都归这一档。同类对比按产品名或策略里出现「强势股」「打板」来收。",
    },
    why: [
      "强势股能不能做，看的是涨停生态还活不活：涨停相对跌停、封得住、昨天的涨停今天还能继续封、连板高度还在、涨停家数不处在自己的低位。",
      "五项都按「差的一天接近 0 分、好的一天接近 100 分」线性拉开，再截断到 0 到 100。这样某一项极端时不会把总分推出 0 到 100。",
    ],
    shared: [SHARED_Q, SHARED_CLAMP, SHARED_WEIGHT],
    factors: {
      ratio: {
        why: "涨停多、跌停少，短线资金还在进攻。比值太低时，强势股的对手盘是下跌而不是接力。",
        steps: [
          {
            lead: "先按代码近似涨跌停幅度。创业板、科创板 19.8%，北交所 29.8%，其余 9.8%。ST 的 5% 板没有单独识别，会混在 9.8% 里。",
            latex: String.raw`L_i=\begin{cases}0.198& \text{代码以 300、301、688、689 开头}\\ 0.298& \text{代码以 8、43、83、87、92 开头}\\ 0.098& \text{其余}\end{cases}`,
          },
          {
            lead: "封住的涨停：相对前收盘的涨幅达到阈值，并且收盘价不低于最高价的 99.8%。最高价触到阈值但收盘没到的，计为炸板。",
            latex: String.raw`\begin{aligned} \text{封住}_{i,t}&=1\iff r_{i,t}\ge L_i\ \text{且}\ C_{i,t}\ge 0.998\,H_{i,t}^{\text{高}}\\ \text{炸板}_{i,t}&=1\iff \dfrac{H_{i,t}^{\text{高}}}{C_{i,t-1}}-1\ge L_i\ \text{且}\ r_{i,t}<L_i \end{aligned}`,
          },
          {
            lead: "跌停家数：跌幅达到阈值，并且收盘价不高于最低价的 1.002 倍。",
            latex: String.raw`\text{跌停}_{i,t}=1\iff r_{i,t}\le -L_i\ \text{且}\ C_{i,t}\le 1.002\,L_{i,t}^{\text{低}}`,
          },
          {
            lead: "把三类家数加总。没有跌停、但有涨停时，比值按 3 计，避免除以 0，也避免「零跌停」把比值变成无穷大。两边都是 0 时按 1 计。",
            latex: String.raw`U_t=\sum_i\text{封住}_{i,t},\quad B_t=\sum_i\text{炸板}_{i,t},\quad D_t=\sum_i\text{跌停}_{i,t}`,
          },
          {
            lead: "比值从 0.3 映射到 0 分，到 2.0 映射到 100 分，中间线性。0.3 是涨停明显少于跌停，2.0 是涨停已经是跌停的两倍。",
            latex: String.raw`R_t=\begin{cases}U_t/D_t& D_t>0\\ 3& D_t=0,\ U_t>0\\ 1& U_t=D_t=0\end{cases}`,
          },
          {
            lead: "这一项的分数。设计权重 0.28。",
            latex: String.raw`s_{\text{涨跌停}}=\operatorname{clamp}\!\left(\dfrac{R_t-0.3}{1.7}\times 100\right)`,
          },
        ],
      },
      seal: {
        why: "只看涨停家数会把炸板也算成强势。封板率高，表示冲到涨停的股票收盘还在板上，接力的摩擦更小。",
        steps: [
          {
            lead: "封板率是收住的涨停，除以「收住的」加「炸开的」。当天没有股票碰到涨停时，没有比率可算，记 50，表示中性而不是零分。",
            latex: String.raw`s_{\text{封板}}=\begin{cases}100\times U_t/(U_t+B_t)& U_t+B_t>0\\ 50& U_t+B_t=0\end{cases}`,
          },
          {
            lead: "设计权重 0.22。炸板率是 100 减封板率，只写在读数里，不再单独加权。",
            latex: String.raw`\text{炸板率}_t=100-s_{\text{封板}}`,
          },
        ],
      },
      promo: {
        why: "昨天封住的股票今天还能封住，连板接力才存在。晋级率低时，涨停更多是一天游，强势股的持有期对不上。",
        steps: [
          {
            lead: "分子是昨天封住、今天继续封住的家数。分母是昨天封住的家数。",
            latex: String.raw`p_t=\dfrac{\#\{i:\text{封住}_{i,t}=1,\ \text{封住}_{i,t-1}=1\}}{\#\{i:\text{封住}_{i,t-1}=1\}}`,
          },
          {
            lead: "昨天没有涨停时，比率没有分母，这一项记 50。有分母时，8% 映射到 0 分，50% 映射到 100 分。",
            latex: String.raw`s_{\text{晋级}}=\begin{cases}50& \#\{i:\text{封住}_{i,t-1}=1\}=0\\[6pt] \operatorname{clamp}\!\left(\dfrac{p_t-0.08}{0.42}\times 100\right)& \text{其余}\end{cases}`,
          },
          { lead: "设计权重 0.18。", latex: String.raw`w_{\text{晋级}}=0.18` },
        ],
      },
      height: {
        why: "最高连板是情绪的高度。高度还在，高位博弈还有标的；高度掉到一两板，强势股往往只剩首板。",
        steps: [
          {
            lead: "一只股票的连板数，是从今天起往前数，连续多少个交易日都封住涨停。中间断一天就停止。市场高度是当天所有封住股票里最大的那个连板数；当天没有封住的股票时高度为 0。",
            latex: String.raw`m_t=\max_i\ \text{（代码 }i\text{ 截至 }t\text{ 的连续封住天数）}`,
          },
          {
            lead: "每多一板加 18 分。4 板是 72 分，6 板达到 108，截断后是 100。再高的高度不再加分。设计权重 0.12。",
            latex: String.raw`s_{\text{高度}}=\operatorname{clamp}(18\,m_t)`,
          },
        ],
      },
      count: {
        why: "绝对家数要和近期自己比。30 家涨停在冷清的一个月里算多，在高潮的一个月里算少。",
        steps: [
          {
            lead: "用封住的涨停家数做 60 日分位。这一项的分数就是分位。设计权重 0.20。",
            latex: String.raw`s_{\text{家数}}=q\bigl(U_t;\,U_{t-n+1},\ldots,U_t\bigr)`,
          },
        ],
      },
    },
    combine: [
      {
        lead: "五项设计权重加总为 1：涨跌停 0.28，封板 0.22，晋级 0.18，连板高度 0.12，涨停家数 0.20。这个加权分越高，涨停生态越热。",
        latex: String.raw`S=\operatorname{round}_{1}\!\left(0.28\,s_{\text{涨跌停}}+0.22\,s_{\text{封板}}+0.18\,s_{\text{晋级}}+0.12\,s_{\text{高度}}+0.20\,s_{\text{家数}}\right)`,
      },
      {
        lead: "热度分和近 20 日超额反着走，公布的环境分用 100 减热度分。状态按公布分，从上到下命中第一条。",
        latex: String.raw`S_{\text{公布}}=\operatorname{round}_{1}(100-S),\qquad \text{状态}=\begin{cases}\text{环境偏好}& S_{\text{公布}}\ge 72\\ \text{良（可做）}& S_{\text{公布}}\ge 64\\ \text{中性}& S_{\text{公布}}\ge 56\\ \text{谨慎}& S_{\text{公布}}\ge 45\\ \text{偏弱}& S_{\text{公布}}<45\end{cases}`,
      },
    ],
    rating: [],
    symbols: [
      ...PCT_SYMBOLS,
      { symbol: "L_i", meaning: "股票 i 的涨跌停幅度近似值：0.098、0.198 或 0.298。" },
      { symbol: "r_{i,t}", meaning: "股票 i 在 t 日的收益率。" },
      { symbol: "C_{i,t}", meaning: "收盘价。C_{i,t-1} 是前一交易日收盘价。" },
      { symbol: "H_{i,t}^{\\text{高}}", meaning: "t 日最高价。" },
      { symbol: "L_{i,t}^{\\text{低}}", meaning: "t 日最低价。字母 L 在涨跌停幅度里也用过，这里加上标「低」区分。" },
      { symbol: "U_t", meaning: "t 日收盘封住涨停的家数。" },
      { symbol: "B_t", meaning: "t 日触及涨停但收盘没有封住的家数。" },
      { symbol: "D_t", meaning: "t 日收盘封住跌停的家数。" },
      { symbol: "R_t", meaning: "涨停家数除以跌停家数。没有跌停时按 3 或 1 处理。" },
      { symbol: "p_t", meaning: "晋级率，昨天封住的股票里今天继续封住的比例。" },
      { symbol: "m_t", meaning: "t 日全市场最高连板数。" },
      { symbol: "s_{\\text{涨跌停}}", meaning: "由 R_t 线性映射并截断后的分数。" },
      { symbol: "s_{\\text{封板}}", meaning: "封板率乘以 100。没有人碰涨停时为 50。" },
      { symbol: "s_{\\text{晋级}}", meaning: "由晋级率线性映射后的分数。昨天没有涨停时为 50。" },
      { symbol: "s_{\\text{高度}}", meaning: "最高连板数乘以 18，再截断到 100。" },
      { symbol: "s_{\\text{家数}}", meaning: "封住涨停家数的 60 日分位。" },
    ],
  },
  cta: {
    about: {
      meaning: "商品 CTA 在商品期货上做趋势。要有一批品种走出方向，波动处在拿得住的区间，成交也没有枯掉。",
      tags: [
        { where: "期货策略 / 量化期货", names: "时序、截面、混合、中高频、低频、基本面、机器学习、量价、商品、大厂" },
      ],
      note: "主观期货不归这一档。量化期货下面的「股指」做的是股指期货，这一页的行情不含股指和国债。同类对比仍按整个「量化期货」二级来取，所以标了「股指」的产品也会进样本。",
    },
    why: [
      "商品 CTA 需要一批合约真的走出方向，同时波动处在能持有的区间，成交也没有枯掉。三项里趋势覆盖占 70%，因为没有方向时，波动和放量都帮不上趋势策略。",
      "换月跳空会把连续合约的一天涨跌变成假趋势，所以单日涨跌超过 8% 的日子从路径里拿掉，不记成 0，而是整日不参与求和。",
    ],
    shared: [SHARED_Q, SHARED_CLAMP, SHARED_WEIGHT, {
      lead: "下面的波动都用样本方差，分母是样本数减 1。波动率是这个方差的平方根。",
      latex: VAR,
    }],
    factors: {
      trend: {
        why: "趋势策略要的是净涨跌占全程波动的比例高，而且这段净涨跌本身够大。只有效率、累计涨跌接近 0，仍然没有仓位可拿。45% 的品种同时满足，就记满分：商品不需要每个品种都走趋势。",
        steps: [
          {
            lead: "品种使用主力连续合约。单日收益率超过 8% 时记为缺失。",
            latex: String.raw`r_{p,t}=\begin{cases}\text{缺失}& \left\lvert C_{p,t}/C_{p,t-1}-1\right\rvert>0.08\\ C_{p,t}/C_{p,t-1}-1& \text{其余}\end{cases}`,
          },
          {
            lead: "从今天往回数，最多取 20 个非缺失收益。少于 15 个的品种当天不参与。",
            latex: String.raw`\mathbf{r}_p=(r_{p,t_1},\ldots,r_{p,t_m}),\qquad 15\le m\le 20`,
          },
          {
            lead: "方向效率是净涨跌的绝对值，除以每天涨跌绝对值之和。净涨跌是这些收益的和。",
            latex: String.raw`E_p=\dfrac{\lvert\sum_{k=1}^{m} r_{p,t_k}\rvert}{\sum_{k=1}^{m}\lvert r_{p,t_k}\rvert},\qquad N_p=\sum_{k=1}^{m} r_{p,t_k}`,
          },
          {
            lead: "活跃品种还要过成交量。把当天有足够收益的品种按成交量从小到大排，取 15% 位置的那个量当作地板，低于地板或成交量为 0 的去掉。活跃品种少于 15 个，或者一开始不足 20 个品种，这一天不打分。",
            latex: String.raw`V_{(15\%)}=\text{升序成交量的第 }\lfloor 0.15\,N\rfloor\text{ 个},\qquad \text{活跃}=\{p:v_p\ge V_{(15\%)},\ v_p>0\}`,
          },
          {
            lead: "走趋势：效率至少 0.25，并且净涨跌的绝对值至少 3%。覆盖率是走趋势的个数除以活跃个数。",
            latex: String.raw`\kappa=\dfrac{\#\{p\in\text{活跃}:E_p\ge 0.25,\ \lvert N_p\rvert\ge 0.03\}}{\#\text{活跃}}`,
          },
          {
            lead: "覆盖率 0 对应 0 分，0.45 对应 100 分。设计权重 0.70。",
            latex: String.raw`s_{\text{趋势}}=\operatorname{clamp}\!\left(\dfrac{\kappa}{0.45}\times 100\right)`,
          },
        ],
      },
      vol: {
        why: "波动太低，趋势策略没有可吃的波幅。波动太高，同样的信号更容易在持有期内被来回打掉。所以把舒适区放在近期历史的 60 分位，偏离越远分越低，而且扣分比转债温和，避免极端波动把 CTA 直接打到地板。",
        steps: [
          {
            lead: "每个活跃品种先算那段收益的样本标准差，再对活跃品种取平均。",
            latex: String.raw`\bar v_t=\dfrac{1}{\#\text{活跃}}\sum_{p\in\text{活跃}}\sqrt{\operatorname{Var}(\mathbf{r}_p)}`,
          },
          {
            lead: "把平均波动放进最多 60 天的历史取分位。偏离 60 分位每个百分点扣 0.9 分。设计权重 0.15。",
            latex: String.raw`\nu_t=q(\bar v_t),\qquad s_{\text{波动}}=\operatorname{clamp}\!\bigl(100-\lvert\nu_t-60\rvert\times 0.9\bigr)`,
          },
        ],
      },
      volume: {
        why: "趋势要有成交配合。活跃品种的路径已经过滤过一次流动性，这一项再看全市场商品成交相对自己近 20 日是放大还是萎缩。",
        steps: [
          {
            lead: "当天成交量是所有有行情的品种成交量之和。基准是今天之前、最多 20 个成交量为正的交易日的平均。没有基准时倍数按 1。",
            latex: String.raw`\rho_t=\dfrac{\sum_p v_{p,t}}{\operatorname{mean}(v^{\text{合计}}_{t-1},\ldots,v^{\text{合计}}_{t-20})}`,
          },
          {
            lead: "0.5 倍映射到 0 分，1.5 倍映射到 100 分。设计权重 0.15。",
            latex: String.raw`s_{\text{成交}}=\operatorname{clamp}\bigl((\rho_t-0.5)\times 100\bigr)`,
          },
        ],
      },
    },
    combine: [
      {
        lead: "三项权重 0.70、0.15、0.15。状态不另做分档，直接写成「走趋势的品种数 / 活跃品种数」，因为覆盖率本身就是要看的结论。",
        latex: String.raw`S=\operatorname{round}_{1}\!\left(0.70\,s_{\text{趋势}}+0.15\,s_{\text{波动}}+0.15\,s_{\text{成交}}\right)`,
      },
    ],
    rating: [],
    symbols: [
      ...PCT_SYMBOLS,
      { symbol: "p", meaning: "商品品种。股指、国债和股指期权代码不进入这个池子。" },
      { symbol: "C_{p,t}", meaning: "品种 p 主力连续合约在 t 日的收盘价。" },
      { symbol: "r_{p,t}", meaning: "品种 p 的日收益率。绝对值大于 8% 时整日缺失。" },
      { symbol: "\\mathbf{r}_p", meaning: "截至今天、最多 20 个非缺失日收益。" },
      { symbol: "m", meaning: "这串收益的长度，计算要求 15 到 20。" },
      { symbol: "E_p", meaning: "方向效率，净涨跌绝对值除以涨跌绝对值之和。" },
      { symbol: "N_p", meaning: "这段窗口的净涨跌，即收益之和。" },
      { symbol: "v_p", meaning: "品种当天成交量。v^{合计} 是全部品种成交量之和。" },
      { symbol: "V_{(15\\%)}", meaning: "当天成交量从小到大排列后，15% 位置上的那个量。" },
      { symbol: "\\kappa", meaning: "走趋势的品种数除以活跃品种数。" },
      { symbol: "\\bar v_t", meaning: "活跃品种 20 日收益样本标准差的平均值。" },
      { symbol: "\\nu_t", meaning: "平均波动的 60 日分位。" },
      { symbol: "\\rho_t", meaning: "当天商品成交量合计，除以此前最多 20 日的平均合计。" },
      { symbol: "\\operatorname{Var}", meaning: "样本方差，分母是样本数减 1。" },
      { symbol: "\\operatorname{mean}", meaning: "算术平均。" },
      { symbol: "s_{\\text{趋势}}", meaning: "覆盖率除以 0.45 再乘 100，截断到 0–100。" },
      { symbol: "s_{\\text{波动}}", meaning: "波动分位距离 60 越远越低的分数。" },
      { symbol: "s_{\\text{成交}}", meaning: "成交倍数相对 0.5 的线性分数。" },
    ],
  },
  cb: {
    about: {
      meaning: "转债指增做可转债多头里跟着转债指数的那一部分，赚个券相对指数的差。环境用中证转债指数，不看单券的债底、溢价和 Delta。",
      tags: [
        { where: "股票多头 / 可转债多头", names: "量化、主观" },
        { where: "股票多头 / 指数增强", names: "转债指增" },
      ],
      note: "可转债套利（套利策略 / 可转债套利）和债券混合里的可转债不归这一档。同类对比按「可转债多头」来取。",
    },
    why: [
      "转债指增的环境用中证转债指数能稳定看到的四件事：20 日涨跌处于自己的什么位置、点位低不低、波动离舒适区多远、成交有没有缩掉。",
      "个券的债底、转股溢价和 Delta 没有日频数据，所以不编进分数。点位越低分数越高，因为低位时债性保护通常更厚。",
    ],
    shared: [SHARED_Q, SHARED_CLAMP, SHARED_WEIGHT, { lead: "波动用 20 个日收益的样本标准差。", latex: VAR }],
    factors: {
      trend: {
        why: "指增要还有价差可做。20 日收益处在自己近期的高分位，指数动量还在。",
        steps: [
          {
            lead: "20 日收益是今天收盘除以 20 个交易日前的收盘，再减 1。",
            latex: String.raw`R_t=\dfrac{C_t}{C_{t-20}}-1`,
          },
          {
            lead: "和最近最多 60 个同样算法的 20 日收益比分位。分数就是分位。设计权重 0.40。",
            latex: String.raw`s_{\text{动量}}=q(R_t;\,R_{t-n+1},\ldots,R_t)`,
          },
        ],
      },
      level: {
        why: "点位越低，同样的指数下跌里债底更近，转债指增的下行通常更可控。所以用 100 减分位。",
        steps: [
          {
            lead: "位置窗口是含今天在内、最多 250 个交易日的收盘价。",
            latex: String.raw`\ell_t=q\bigl(C_t;\,C_{t-n+1},\ldots,C_t\bigr),\qquad n\le 250`,
          },
          {
            lead: "分数是 100 减位置分位。设计权重 0.25。",
            latex: String.raw`s_{\text{位置}}=100-\ell_t`,
          },
        ],
      },
      vol: {
        why: "转债波动太低，股性弹性不够；太高，往往是股性过热。两边都扣，而且比商品 CTA 扣得更陡。",
        steps: [
          {
            lead: "用今天往前 20 个日收益的样本标准差，再取最多 60 天的分位。",
            latex: String.raw`u_t=\sqrt{\operatorname{Var}(r_{t-19},\ldots,r_t)},\qquad \phi_t=q(u_t)`,
          },
          {
            lead: "偏离 60 分位每个百分点扣 1.3 分。设计权重 0.20。",
            latex: String.raw`s_{\text{波动}}=\operatorname{clamp}\!\bigl(100-\lvert\phi_t-60\rvert\times 1.3\bigr)`,
          },
        ],
      },
      activity: {
        why: "指数成交缩掉时，指增的调仓成本上升。有成交额才计算这一项；指数没有成交额时，这一项不进总分，其余权重放大。",
        steps: [
          {
            lead: "倍数是今天成交额，除以窗口内今天之前那些成交额的平均。窗口是含今天的 20 天，平均时去掉今天。至少要有 5 个正的成交额。",
            latex: String.raw`\alpha_t=\dfrac{A_t}{\operatorname{mean}(A_{t-19},\ldots,A_{t-1})}`,
          },
          {
            lead: "分数是这个倍数自己的 60 日分位。设计权重 0.15。",
            latex: String.raw`s_{\text{活跃}}=q(\alpha_t)`,
          },
        ],
      },
    },
    combine: [
      {
        lead: "四项都在时，权重是动量 0.40、位置 0.25、波动 0.20、活跃 0.15。缺活跃时前三项按 0.40:0.25:0.20 归一。这个加权分和近 20 日超额反着走，公布的环境分用 100 减它，状态按公布分用宽基那一套分档。",
        latex: String.raw`\text{状态}=\begin{cases}\text{环境偏好}& S\ge 72\\ \text{良（可做）}& S\ge 64\\ \text{中性}& S\ge 56\\ \text{谨慎}& S\ge 45\\ \text{偏弱}& S<45\end{cases}`,
      },
    ],
    rating: [],
    symbols: [
      ...PCT_SYMBOLS,
      { symbol: "C_t", meaning: "中证转债指数 000832.SH 在 t 日的收盘点位。" },
      { symbol: "R_t", meaning: "指数 20 个交易日的收益率。" },
      { symbol: "r_t", meaning: "指数的单日收益率，收盘除以前收盘再减 1。" },
      { symbol: "\\ell_t", meaning: "收盘点位在最多 250 个交易日里的分位。" },
      { symbol: "u_t", meaning: "最近 20 个日收益的样本标准差。" },
      { symbol: "\\phi_t", meaning: "u_t 的 60 日分位。" },
      { symbol: "A_t", meaning: "指数成交额。没有成交额时活跃项不定义。" },
      { symbol: "\\alpha_t", meaning: "今天成交额相对窗口内此前成交额均值的倍数。" },
      { symbol: "s_{\\text{动量}}", meaning: "20 日收益的分位。" },
      { symbol: "s_{\\text{位置}}", meaning: "100 减点位分位。" },
      { symbol: "s_{\\text{波动}}", meaning: "波动分位距离 60 越远越低，每偏离 1 扣 1.3。" },
      { symbol: "s_{\\text{活跃}}", meaning: "成交倍数的分位。" },
    ],
  },
  arb: {
    about: {
      meaning: "套利赚的是价差收回来，不赌单边方向。这一页看股指远近月、股指期现、商品之间谁涨谁跌，以及股指自己的波动。",
      tags: [
        { where: "套利策略 / 期货套利", names: "股指套利、跨期套利、月差、期现套利、商品套利、跨品种套利" },
      ],
      note: "跨市场套利、高频套利、锁仓也挂在期货套利下面，但这几项因子主要回答期限和跨品种还有没有价差。股票套利、可转债套利、债券套利、ETF套利、期权套利不按这张分理解。同类对比目前按整个「套利策略」一级来取。",
    },
    why: [
      "套利环境看四处还有没有价差：股指远近月的年化基差差、股指主力相对现货的年化基差、商品之间 20 日涨跌的分散、以及股指自身的波动。四处都用分位，分位高表示价差或波动相对近期更宽。",
      "到期不足 2 天的合约不参与。年化时要除以剩余天数，分母太小会把基差放大失真。超过 220 天的远月也不进，避免非主力合约的报价噪声。",
    ],
    shared: [SHARED_Q, SHARED_CLAMP, SHARED_WEIGHT, { lead: "商品收益的分散和股指波动都用样本方差。", latex: VAR }],
    factors: {
      calendar: {
        why: "远近月年化基差拉开时，跨期有可做的期限结构。四个股指都看，再取平均，避免单品种换月主导结论。",
        steps: [
          {
            lead: "每个股指当天取持仓量最大的两档，且剩余天数在 2 到 220 之间。年化基差写成百分数。现货优先用品种现货，没有则用对应指数收盘。",
            latex: String.raw`b=\dfrac{F-P}{P}\times\dfrac{365}{d}\times 100`,
          },
          {
            lead: "跨期是同一品种远月与近月年化基差之差的绝对值。至少两个品种同时有远近月，才进入后面的平均。",
            latex: String.raw`\delta_{g,t}=\lvert b_{g,t}^{\text{远}}-b_{g,t}^{\text{近}}\rvert`,
          },
          {
            lead: "四个品种（实际有数的那些）再平均，然后取 60 日分位。分数就是分位。设计权重 0.30。",
            latex: String.raw`\bar\delta_t=\operatorname{mean}_g\delta_{g,t},\qquad s_{\text{跨期}}=q(\bar\delta_t)`,
          },
        ],
      },
      basis: {
        why: "期现年化基差的绝对值大，套保和期现收敛的空间大。正负基差都算宽度，所以取绝对值。",
        steps: [
          {
            lead: "每个股指只用持仓量最大的那一档。至少两个品种有基差才平均。",
            latex: String.raw`\bar\beta_t=\operatorname{mean}_g\lvert b_{g,t}^{\text{近}}\rvert`,
          },
          {
            lead: "分数是这个平均值的 60 日分位。设计权重 0.25。",
            latex: String.raw`s_{\text{期现}}=q(\bar\beta_t)`,
          },
        ],
      },
      cross: {
        why: "商品 20 日涨跌越散，跨品种价差越多。这里用收益的截面标准差，而不是价差的绝对值，因为不同品种的价格单位不能直接相减。",
        steps: [
          {
            lead: "每个商品先取最多 20 个、至少 15 个有效日收益，求收益之和，得到 20 日净涨跌。当天至少 15 个品种才算截面。",
            latex: String.raw`N_{p,t}=\sum r_{p},\qquad \xi_t=100\times\sqrt{\operatorname{Var}_p(N_{p,t})}`,
          },
          {
            lead: "分数是 ξ 的 60 日分位。设计权重 0.30。",
            latex: String.raw`s_{\text{跨品种}}=q(\xi_t)`,
          },
        ],
      },
      vol: {
        why: "波动率高时，价差更容易被打开，也更容易在持有期内走完。这一维用中证1000主力；没有 IM 时用沪深300主力。分位低时，这一项对总分几乎不加分。",
        steps: [
          {
            lead: "取截至今天的 21 根日 K。合约代码变了的那天不计算收益。有效收益少于 12 个则当天没有波动率。",
            latex: String.raw`r_t=\dfrac{C_t}{C_{t-1}}-1\quad\text{仅当合约代码不变}`,
          },
          {
            lead: "样本标准差乘 100，变成百分数，再取 60 日分位。分数就是分位。设计权重 0.15。",
            latex: String.raw`s_{\text{波动}}=q\!\left(100\times\sqrt{\operatorname{Var}(r)}\right)`,
          },
        ],
      },
    },
    combine: [
      {
        lead: "四项权重 0.30、0.25、0.30、0.15。价差分位越高这个加权分越高，但近 20 日超额越差，公布的环境分用 100 减它。状态按公布分切开。",
        latex: String.raw`S_{\text{公布}}=\operatorname{round}_{1}(100-S),\qquad \text{状态}=\begin{cases}\text{环境偏好}& S_{\text{公布}}\ge 58\\ \text{中性}& S_{\text{公布}}\ge 48\\ \text{机会偏少}& S_{\text{公布}}<48\end{cases}`,
      },
    ],
    rating: [],
    symbols: [
      ...PCT_SYMBOLS,
      { symbol: "F", meaning: "期货合约收盘价。" },
      { symbol: "P", meaning: "对应现货或指数的价格。" },
      { symbol: "d", meaning: "合约距离到期的日历天数，只保留 2 到 220 天。" },
      { symbol: "b", meaning: "年化基差，单位是百分数。" },
      { symbol: "g", meaning: "股指品种，IH、IF、IC、IM 之一。" },
      { symbol: "b_{g,t}^{\\text{近}}", meaning: "持仓量最大的那一档的年化基差。" },
      { symbol: "b_{g,t}^{\\text{远}}", meaning: "持仓量第二大的那一档的年化基差。" },
      { symbol: "\\delta_{g,t}", meaning: "远月与近月年化基差之差的绝对值。" },
      { symbol: "\\bar\\delta_t", meaning: "有远近月的股指上，δ 的平均。" },
      { symbol: "\\bar\\beta_t", meaning: "各股指主力年化基差绝对值的平均。" },
      { symbol: "N_{p,t}", meaning: "商品 p 近 20 个有效日收益之和。" },
      { symbol: "\\xi_t", meaning: "这些 20 日净涨跌的样本标准差，再乘 100。" },
      { symbol: "r_t", meaning: "股指主力的日收益率。换月当天不计算。" },
      { symbol: "s_{\\text{跨期}}", meaning: "远近月年化基差差的分位。" },
      { symbol: "s_{\\text{期现}}", meaning: "年化基差绝对值平均的分位。" },
      { symbol: "s_{\\text{跨品种}}", meaning: "商品 20 日收益截面标准差的分位。" },
      { symbol: "s_{\\text{波动}}", meaning: "股指主力 20 日波动的分位。" },
    ],
  },
  "option-sell": {
    about: {
      meaning: "期权卖权收的是权利金。一个品种的隐含波动率相对自己的历史越贵，同样的卖方仓位权利金越厚。股指和商品放在同一张表里。",
      tags: [
        { where: "期权策略 / 场内期权", names: "金融卖波、商品波动率" },
      ],
      note: "场内期权里的「期权套利」，以及场外的雪球、其他场外期权，不按这张分理解。这一页用的是场内平值隐波。同类对比按整个「期权策略」一级来取。",
    },
    why: [
      "卖权收到的是隐含波动率。一个品种相对自己的历史越贵，同样的卖方仓位权利金越厚。环境分是全部有序列的品种等权平均，股指和商品放在同一张表里，不让四个股指期权代表整个市场。",
      "股指用 50ETF、300ETF、500ETF、中证1000、创业板、科创50。商品用库里每个有平值隐波、且样本不少于 60 天的品种。商品这段历史从 2026 年中才有，分位是这段样本里的位置，窗口最多仍写到 252 天。",
      "权利金厚如果只集中在两三个品种上，不能把它写成全市场都能卖。所以另外数可卖品种覆盖了几个板块，并用商品收益的第一主成分看它们是不是在同一个方向上走。",
    ],
    shared: [{
      lead: "分位把今天的数放回它自己的历史窗口，窗口含今天。数一数有多少个小于等于今天，再换成 0 到 100。窗口是空的时候记 50。隐波窗口最多 252 天，成交窗口是 60 天。",
      latex: Q,
    }, SHARED_CLAMP],
    factors: {
      book: {
        why: "全市场隐波分是每个品种分位的算术平均。品种多的板块不会因为板块名字多而占更大权重，每个品种一票。平均超过 82 时，超出的部分只记一半，因为最贵的那一截更多是尾部风险。",
        steps: [
          {
            lead: "第 k 个品种的分数是它自己的隐波分位。股指窗口最多 252 天；商品有多少天用多少天，但少于 60 天的品种不进表。",
            latex: String.raw`s_k=q\bigl(IV_{k,t};\,IV_{k,t-n_k+1},\ldots,IV_{k,t}\bigr),\qquad 60\le n_k\le 252`,
          },
          {
            lead: "环境分是这些分位的平均。m 是当天有分位的品种数。超过 82 再压一压。",
            latex: String.raw`\bar s=\dfrac{1}{m}\sum_{k=1}^{m}s_k,\qquad S=\operatorname{round}_{1}\!\left(\begin{cases}\bar s&\bar s\le 82\\ 82+(\bar s-82)\times 0.5&\bar s>82\end{cases}\right)`,
          },
        ],
      },
      liq: {
        why: "隐波贵还要卖得出去。流动性用每个品种自己近 60 日成交的分位，再对有成交的品种取平均。商品用主力合约成交量，股指用对应指数的成交额。",
        steps: [
          {
            lead: "先给每个品种算成交分位，再平均。少于 8 个品种有成交时，这一项不报。",
            latex: String.raw`L=\dfrac{1}{m_L}\sum_k q(V_{k,t}),\qquad C=\operatorname{round}_{1}(0.7S+0.3L)`,
          },
          {
            lead: "综合分不替换环境分。环境分仍然只回答权利金厚不厚，综合分再看成交配不配合。",
            latex: String.raw`S\text{ 是隐波平均},\qquad C\text{ 是隐波与流动性的合成}`,
          },
        ],
      },
    },
    fallback: {
      why: "点名的品种只是为了看见权利金厚在哪里。它的分位已经进了全市场平均，这里不再加一次权重。",
      steps: [
        {
          lead: "这个品种的分数就是自己的隐波分位。",
          latex: String.raw`s_k=q(IV_{k,t})`,
        },
      ],
    },
    combine: [
      {
        lead: "环境分就是全市场隐波平均，四舍五入到一位小数。流动性只进入综合分，不改环境分。",
        latex: String.raw`S=\operatorname{round}_{1}(\bar s\text{ 或压过之后的值}),\qquad C=\operatorname{round}_{1}(0.7S+0.3L)`,
      },
      {
        lead: "可卖品种是分位不低于 65 的品种。它们占全部品种不到四分之一时，记成溢价只在局部。商品第一主成分解释比达到 35%，说明品种在同一方向上走。",
        latex: String.raw`\text{局部}=0<\dfrac{m_{65}}{m}<0.25,\qquad \lambda_1/\operatorname{tr}(\Sigma)\ge 0.35`,
      },
      {
        lead: "状态按从上到下命中第一条。局部偏厚时不写成全市场可卖。",
        latex: String.raw`\text{状态}=\begin{cases}\text{可卖}& S\ge 70\text{ 且非局部}\\ \text{中性，观望}& \text{局部}\\ \text{局部可做，谨慎参与}& S\ge 55\\ \text{中性}& S\ge 45\\ \text{权利金偏薄}& S<45\end{cases}`,
      },
    ],
    rating: [],
    symbols: [
      ...PCT_SYMBOLS.filter((item) => item.symbol !== "S" && item.symbol !== "n"),
      { symbol: "n_k", meaning: "品种 k 用来算隐波分位的样本长度，最少 60 天，最多 252 天。成交分位的窗口另计，是 60 天。" },
      { symbol: "IV_{k,t}", meaning: "品种 k 在 t 日的隐含波动率。" },
      { symbol: "s_k", meaning: "品种 k 的隐波分位。" },
      { symbol: "m", meaning: "当天参与平均的品种个数，至少为 6。" },
      { symbol: "\\bar s", meaning: "各品种分位的算术平均。" },
      { symbol: "S", meaning: "环境分。平均超过 82 时，超出部分只保留一半。" },
      { symbol: "V_{k,t}", meaning: "品种 k 当天的成交。商品是主力成交量，股指是对应指数成交额。" },
      { symbol: "L", meaning: "有成交的品种，其近 60 日成交分位的平均。" },
      { symbol: "C", meaning: "综合分，隐波 70%，流动性 30%。不替换环境分。" },
      { symbol: "m_{65}", meaning: "分位不低于 65 的品种个数。" },
      { symbol: "\\Sigma", meaning: "商品近 40 日收益的样本协方差。单日涨跌超过 8% 的日子先去掉。" },
      { symbol: "\\lambda_1", meaning: "协方差矩阵最大的特征值，也就是第一主成分解释的方差。" },
    ],
  },
  intraday: {
    about: {
      meaning: "股指多空日内是当天开、当天平的股指期货方向单。要白天有波幅，而且价格从开盘走到收盘，不是冲高回落。",
      tags: [
        { where: "股票对冲 / 股票多空", names: "场内券、场外券、量化" },
      ],
      note: "团队标签里没有单独的「日内」。量化期货的「股指」、主观期货的「股指期货」分不出日内还是日间，不归到这一档。同类对比按股票多空来取，并排除名称或策略里带指增、FOF、中性的产品。",
    },
    why: [
      "日内多空要的是白天有波幅，而且这段波幅里价格真的从开盘走到了收盘，而不是在最高最低之间来回锯。",
      "数据是 IH、IF、IC、IM 主力的日 K。没有 5 分钟路径，所以不做分钟级别的方差比。四个品种先各自看近 5 日，再平均，避免只被一个品种带着走。",
    ],
    shared: [SHARED_Q, SHARED_CLAMP, SHARED_WEIGHT],
    factors: {
      amp: {
        why: "振幅太小，日内单没有空间。用分位是因为股指振幅的绝对水平会换档，要和自己的近期比。",
        steps: [
          {
            lead: "单日振幅是最高价减最低价，再除以开盘价，写成百分数。开盘价不大于 0 时这天振幅记 0。",
            latex: String.raw`a_{g,t}=\begin{cases}100\times(H_{g,t}-L_{g,t})/O_{g,t}& O_{g,t}>0\\ 0& \text{其余}\end{cases}`,
          },
          {
            lead: "每个品种先取含今天的 5 日平均。至少要有两个品种算得出这 5 日，才进入下一步。",
            latex: String.raw`\bar a_{g,t}=\operatorname{mean}(a_{g,t-4},\ldots,a_{g,t})`,
          },
          {
            lead: "再对有数据的股指取平均。这个序列自己积累满 20 天之后才取分位。分数就是分位。设计权重 0.70。",
            latex: String.raw`\bar a_t=\operatorname{mean}_g\bar a_{g,t},\qquad s_{\text{振幅}}=q(\bar a_t)`,
          },
        ],
      },
      er: {
        why: "振幅大但实体很小，表示白天冲高回落或探底回升，方向单容易被扫。实体占振幅越高，这段波动越像单边。",
        steps: [
          {
            lead: "实体效率是收盘与开盘之差的绝对值，除以最高与最低之差，再乘 100。最高等于最低时记 0。",
            latex: String.raw`e_{g,t}=\begin{cases}100\times\lvert C_{g,t}-O_{g,t}\rvert/(H_{g,t}-L_{g,t})& H_{g,t}>L_{g,t}\\ 0& H_{g,t}=L_{g,t}\end{cases}`,
          },
          {
            lead: "同样先做 5 日平均，再对品种平均。",
            latex: String.raw`\bar e_t=\operatorname{mean}_g\operatorname{mean}(e_{g,t-4},\ldots,e_{g,t})`,
          },
          {
            lead: "8 映射到 0 分，40 映射到 100 分。8 以下几乎没有净位移，40 表示实体已经占了振幅的四成。设计权重 0.30。",
            latex: String.raw`s_{\text{实体}}=\operatorname{clamp}\!\left(\dfrac{\bar e_t-8}{32}\times 100\right)`,
          },
        ],
      },
    },
    combine: [
      {
        lead: "振幅分位占 70%，实体效率占 30%。振幅越大这个加权分越高，但近 20 日超额越差，公布的环境分用 100 减它。状态按公布分用宽基那一套分档。",
        latex: String.raw`S=\operatorname{round}_{1}(0.70\,s_{\text{振幅}}+0.30\,s_{\text{实体}}),\qquad S_{\text{公布}}=\operatorname{round}_{1}(100-S)`,
      },
    ],
    rating: [],
    symbols: [
      ...PCT_SYMBOLS,
      { symbol: "g", meaning: "股指品种，IH、IF、IC、IM 的持仓量最大合约。" },
      { symbol: "O,H,L,C", meaning: "该合约当天的开盘、最高、最低、收盘。" },
      { symbol: "a_{g,t}", meaning: "品种 g 在 t 日的振幅百分数。" },
      { symbol: "\\bar a_{g,t}", meaning: "品种 g 含今天的 5 日平均振幅。" },
      { symbol: "\\bar a_t", meaning: "有数据的股指上，5 日平均振幅再平均。" },
      { symbol: "e_{g,t}", meaning: "品种 g 当天实体占振幅的百分数。" },
      { symbol: "\\bar e_t", meaning: "5 日实体效率在品种之间的平均。" },
      { symbol: "s_{\\text{振幅}}", meaning: "平均振幅的 60 日分位。" },
      { symbol: "s_{\\text{实体}}", meaning: "由平均实体效率线性映射到 0–100 的分数。" },
    ],
  },
  swing: {
    about: {
      meaning: "股指多空日间持有超过一个交易日。一段顺势，或者一段清楚的来回，都可以做；缠在中间时两边都难拿。",
      tags: [
        { where: "股票对冲 / 股票多空", names: "场内券、场外券、量化" },
      ],
      note: "团队标签里没有单独的「日间」，和日内共用上面这一组。两张环境分看的结构不同，标签目前分不开。同类对比的收法与日内相同。",
    },
    why: [
      "日间多空在两种结构里都能做：一段顺势，或者一段清楚的来回。缠在中间、效率不高也不反转时，两边都难拿。所以路径效率分和反转结构分先取较高的一个，这个结构分再占环境分的一半。",
      "计算用中证1000主力。换月当天的收益率整日剔除，不记成 0，否则跳空会变成假趋势或假反转。",
    ],
    shared: [SHARED_Q, SHARED_CLAMP, {
      lead: "方差和相关系数都用样本统计。相关系数至少要有 8 对，否则当天不使用。",
      latex: String.raw`\rho(x,y)=\dfrac{\sum_{i=1}^{n}(x_i-\bar x)(y_i-\bar y)}{\sqrt{\sum_{i=1}^{n}(x_i-\bar x)^2\sum_{i=1}^{n}(y_i-\bar y)^2}}`,
    }, { lead: "样本方差的分母是样本数减 1。", latex: VAR }],
    factors: {
      path: {
        why: "路径效率高，表示这 20 天的净涨跌占折腾路程的比例高，日线是一段方向而不是来回。30% 在读数里当作「像一段顺势」的观察线；满分放在 40%，因为再高的效率在股指日线上已经很少见。",
        steps: [
          {
            lead: "从今天往前取最多 20 个有效日收益。合约切换当天没有收益。少于 15 个则当天不打分。",
            latex: String.raw`\eta=\dfrac{\bigl\lvert\sum_{k=1}^{m} r_k\bigr\rvert}{\sum_{k=1}^{m}\lvert r_k\rvert}\times 100,\qquad 15\le m\le 20`,
          },
          {
            lead: "这一项的分数把 0% 映射到 0，40% 映射到 100。它不单独占权重，而是和反转分比大小。",
            latex: String.raw`s_{\text{路径}}=\operatorname{clamp}\!\left(\dfrac{\eta}{40}\times 100\right)`,
          },
          {
            lead: "最长连续同向天数只写在说明里：收益符号相同则连加，符号变了或收益为 0 就重计。它不进入环境分。",
            latex: String.raw`\text{同向天数}=\text{窗口内最长的连续同号收益个数}`,
          },
        ],
      },
      revert: {
        why: "反转看两件互相印证的事：相邻两日收益是不是负相关，以及 4 日方差比是不是小于 1。负相关表示涨了容易跌回来；方差比小于 1 表示多日收益比单日随机游走更收得拢。",
        steps: [
          {
            lead: "取最多 120 个有效日收益，少于 40 个则当天不打分。自相关是前一天收益和后一天收益的相关系数。",
            latex: String.raw`\rho_1=\rho(r_1,\ldots,r_{n-1};\,r_2,\ldots,r_n)`,
          },
          {
            lead: "4 日收益是连续 4 个日收益的重叠求和。方差比用这些 4 日收益的样本方差，除以 4 倍单日样本方差。有效日收益少于 16 个时不算方差比。",
            latex: String.raw`VR_4=\dfrac{\operatorname{Var}(r_t+r_{t-1}+r_{t-2}+r_{t-3})}{4\,\operatorname{Var}(r_t)}`,
          },
          {
            lead: "自相关每低 0.1，第一项加 25 分。方差比每低于 1 一个 0.1，第二项加 7 分。两项相加后截断。这一项也不单独占权重。",
            latex: String.raw`s_{\text{反转}}=\operatorname{clamp}\!\bigl(-\rho_1\times 250+(1-VR_4)\times 70\bigr)`,
          },
        ],
      },
      amp: {
        why: "无论做趋势还是做反转，日线振幅太小都没有空间。这一项直接用近 5 日振幅的分位，权重 0.35。",
        steps: [
          {
            lead: "振幅定义与日内相同：(最高−最低)/开盘。这里只取中证1000主力，先做含今天的 5 日平均，再取最多 60 天的分位。",
            latex: String.raw`s_{\text{振幅}}=q(\bar a_t)`,
          },
        ],
      },
      overnight: {
        why: "隔夜缺口和前一白天的涨跌若有稳定关系，日间单可以决定隔夜留不留。分数只用相关的绝对值：同向或反向都是可利用的结构，缠在零附近才没有信息。权重 0.15，因为它是结构之上的附加项。",
        steps: [
          {
            lead: "只保留合约代码不变的相邻两天。白天涨跌用前一天的收盘减开盘，隔夜缺口用今天开盘减昨天收盘。两边符号都不是 0 才配成一对。从今天往前最多看 120 根 K 线，配成的对数少于 20 则当天不打分。",
            latex: String.raw`x=C_{t-1}-O_{t-1},\qquad y=O_t-C_{t-1}`,
          },
          {
            lead: "分数是相关系数绝对值乘 180。绝对值 0.556 大约对应 100 分。设计权重 0.15。",
            latex: String.raw`s_{\text{隔夜}}=\operatorname{clamp}\bigl(\lvert\rho(x,y)\rvert\times 180\bigr)`,
          },
          {
            lead: "下面三个数写在读数里，不进入环境分。隔夜占比是缺口绝对值之和，除以缺口绝对值与当天实体绝对值之和。同向比例是 x 与 y 同号的对数，除以配成的对数。t 统计量用来看这组相关离 0 有多远。",
            latex: String.raw`\begin{aligned} \text{隔夜占比}&=\dfrac{\sum\lvert y\rvert}{\sum\lvert y\rvert+\sum\lvert C-O\rvert}\\ \text{同向比例}&=\dfrac{\#\{\operatorname{sign}(x)=\operatorname{sign}(y)\}}{\#\text{配对}}\\ t&=\rho\sqrt{\dfrac{n_{\rho}-2}{1-\rho^2}} \end{aligned}`,
          },
        ],
      },
    },
    combine: [
      {
        lead: "结构分取路径分和反转分里较高的一个。趋势清楚或反转清楚，都比两个都低更好做。",
        latex: String.raw`s_{\text{结构}}=\max(s_{\text{路径}},s_{\text{反转}})`,
      },
      {
        lead: "三项的设计权重是振幅 0.35、结构 0.50、隔夜 0.15。结构越清楚这个加权分越高，但近 20 日超额越差，公布的环境分用 100 减它。",
        latex: String.raw`S=\operatorname{round}_{1}\!\left(0.35\,s_{\text{振幅}}+0.50\,s_{\text{结构}}+0.15\,s_{\text{隔夜}}\right),\qquad S_{\text{公布}}=\operatorname{round}_{1}(100-S)`,
      },
      {
        lead: "状态先看结构，再看公布分。路径效率的单位是百分数。偏反转还要求自相关小于 −0.1，或方差比小于 0.85；只有效率低、相关和方差比都普通时，写成来回磨。",
        latex: String.raw`\text{状态}=\begin{cases}\text{趋势段}& \eta\ge 30\text{ 且 }s_{\text{路径}}\ge s_{\text{反转}}\\ \text{来回磨，偏反转}& \eta<28\text{ 且 }(\rho_1<-0.1\text{ 或 }VR_4<0.85)\\ \text{来回磨}& \eta<28\\ \text{良（可做）}& S_{\text{公布}}\ge 64\\ \text{中性}& S_{\text{公布}}\ge 50\\ \text{谨慎}& S_{\text{公布}}<50\end{cases}`,
      },
    ],
    rating: [],
    symbols: [
      ...PCT_SYMBOLS,
      { symbol: "r_k", meaning: "中证1000主力的一个有效日收益。换月当天剔除。" },
      { symbol: "m", meaning: "路径效率使用的有效收益个数，15 到 20。" },
      { symbol: "\\eta", meaning: "近 20 个有效日的路径效率，单位是百分数。" },
      { symbol: "\\rho_1", meaning: "相邻两个有效日收益的相关系数。" },
      { symbol: "\\rho(x,y)", meaning: "两组等长样本的皮尔逊相关系数。样本少于 8 对时不计算。" },
      { symbol: "VR_4", meaning: "4 日重叠收益的样本方差，除以 4 倍单日样本方差。" },
      { symbol: "n_{\\rho}", meaning: "计算 t 统计量时的样本对数。" },
      { symbol: "t", meaning: "相关系数的 t 统计量。只展示，不进入环境分。" },
      { symbol: "x", meaning: "前一交易日的实体，收盘减开盘。" },
      { symbol: "y", meaning: "隔夜缺口，今天开盘减昨天收盘。" },
      { symbol: "O,C", meaning: "开盘价与收盘价。" },
      { symbol: "\\bar a_t", meaning: "中证1000主力近 5 日振幅的平均，振幅=(最高−最低)/开盘。" },
      { symbol: "s_{\\text{路径}}", meaning: "路径效率除以 40 再乘 100。" },
      { symbol: "s_{\\text{反转}}", meaning: "由自相关和方差比合成、再截断的分数。" },
      { symbol: "s_{\\text{结构}}", meaning: "路径分与反转分的较大值。" },
      { symbol: "s_{\\text{振幅}}", meaning: "5 日平均振幅的分位。" },
      { symbol: "s_{\\text{隔夜}}", meaning: "隔夜相关系数绝对值乘 180。" },
    ],
  },
}
