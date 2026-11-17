/** Step-by-step score writeups. Equations match lib/server/strategy-environment.ts. */

export type MathStep = { lead: string; latex: string }

export type FactorWriteup = {
  why: string
  steps: MathStep[]
}

export type StrategyWriteup = {
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
    why: [
      "宽基量化赚的是股票之间的差，不是指数本身的方向。所以环境分看三件事：同一天个股涨跌有没有拉开，全市场成交够不够做，成交有没有挤在少数股票或沪深300上。",
      "绝对值会随行情换档，所以每一项都先放到近 60 个交易日里看分位。分位高才算「相对自己的近期历史偏高」。",
    ],
    shared: [SHARED_Q, SHARED_CLAMP, SHARED_WEIGHT],
    factors: {
      xs: {
        why: "个股同一天的涨跌差得开，多头和空头才有可交易的相对收益。差被压扁时，选股空间一起变薄。",
        steps: [
          {
            lead: "先算每只股票相对前一交易日收盘的收益率。",
            latex: String.raw`r_{i,t}=\dfrac{C_{i,t}}{C_{i,t-1}}-1`,
          },
          {
            lead: "单日涨跌达到或超过 35% 的股票不进入这一天的标准差。复牌、异常价会把截面标准差拉飞，那些票不代表可交易的横截面。",
            latex: String.raw`\mathcal{U}_t=\{\,i:\lvert r_{i,t}\rvert<0.35\,\}`,
          },
          {
            lead: "截面波动用样本标准差，分母是家数减 1，与数据库的 STDDEV_SAMP 一致。当天至少要有 1000 只有前收盘的股票，这一天才进入计算。",
            latex: String.raw`\sigma_t=\sqrt{\dfrac{1}{\lvert\mathcal{U}_t\rvert-1}\sum_{i\in\mathcal{U}_t}\bigl(r_{i,t}-\bar r_t\bigr)^2},\qquad \bar r_t=\dfrac{1}{\lvert\mathcal{U}_t\rvert}\sum_{i\in\mathcal{U}_t}r_{i,t}`,
          },
          {
            lead: "把今天的 σ 放进含今天在内、最多 60 天的窗口，取分位。这一项的分数就是这个分位，权重 0.40。",
            latex: String.raw`s_{\text{截面}}=q\bigl(\sigma_t;\,\sigma_{t-n+1},\ldots,\sigma_t\bigr)`,
          },
        ],
      },
      amt: {
        why: "成交变薄时，同样的调仓冲击更大，策略容量下降。所以成交额分位单独占一块权重，低分位会把环境分拉下来。",
        steps: [
          {
            lead: "当天全市场成交额是所有股票成交额之和。分位用这个原始合计，单位在比大小时会约掉。",
            latex: String.raw`A_t=\sum_i a_{i,t}`,
          },
          {
            lead: "分数是 A 的 60 日分位，权重 0.25。",
            latex: String.raw`s_{\text{成交}}=q\bigl(A_t;\,A_{t-n+1},\ldots,A_t\bigr)`,
          },
          {
            lead: "页面上写成「亿」只是读数。原始数不小于 10^10 时除以 10^8，不小于 10^6 时除以 10^4。这个换算不进入分数。",
            latex: String.raw`A_t^{\text{展示}}=\begin{cases}A_t/10^{8}&A_t\ge 10^{10}\\ A_t/10^{4}&A_t\ge 10^{6}\\ A_t&\text{其余}\end{cases}`,
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
            lead: "分数是 100 减去集中度分位。权重 0.20。",
            latex: String.raw`s_{\text{分散}}=100-h_t`,
          },
        ],
      },
      csi: {
        why: "成交若主要发生在沪深300里，宽基以外的股票没有足够的对手盘。占比越低，这一项越高。两个成交额的单位对不上时，比值会掉出合理区间，这一项直接弃用，避免脏数据进总分。",
        steps: [
          {
            lead: "占比用沪深300指数成交额除以全 A 成交额。只保留落在 2% 到 80% 之间的比值，再写成百分数。",
            latex: String.raw`\pi_t=\dfrac{A_t^{300}}{A_t}\times 100,\qquad \text{仅当 }0.02<\dfrac{A_t^{300}}{A_t}<0.80`,
          },
          {
            lead: "有效历史少于 15 天，或今天的比值被丢弃时，这一项不进入环境分。其余权重按比例放大。",
            latex: String.raw`c_t=q\bigl(\pi_t;\,\pi_{t-n+1},\ldots,\pi_t\bigr)`,
          },
          {
            lead: "分数是 100 减去占比分位。设计权重 0.15。",
            latex: String.raw`s_{\text{沪深300}}=100-c_t`,
          },
        ],
      },
    },
    combine: [
      {
        lead: "四项的设计权重是截面 0.40、成交 0.25、分散 0.20、沪深300占比 0.15。缺哪一项，就把剩下的权重除以它们的和。",
        latex: String.raw`w_{\text{截面}}=0.40,\; w_{\text{成交}}=0.25,\; w_{\text{分散}}=0.20,\; w_{\text{沪深300}}=0.15`,
      },
      SHARED_WEIGHT,
      {
        lead: "成交额分位低于 30、同时环境分低于 68 时，状态写成「谨慎」。这条先于下面的分档。否则从上到下命中第一条就停。",
        latex: String.raw`\text{状态}=\begin{cases}\text{谨慎}& q(A)<30\text{ 且 }S<68\\ \text{环境偏好}& S\ge 72\\ \text{良（可做）}& S\ge 64\\ \text{中性}& S\ge 56\\ \text{谨慎}& S\ge 45\\ \text{偏弱}& S<45\end{cases}`,
      },
    ],
    rating: [],
    symbols: [
      ...PCT_SYMBOLS,
      { symbol: "i", meaning: "股票。下标 t 是交易日。" },
      { symbol: "C_{i,t}", meaning: "股票 i 在 t 日的收盘价。" },
      { symbol: "r_{i,t}", meaning: "股票 i 在 t 日的收益率，收盘除以前收盘再减 1。" },
      { symbol: "\\mathcal{U}_t", meaning: "t 日进入截面标准差的股票集合，单日涨跌绝对值小于 35%。" },
      { symbol: "\\bar r_t", meaning: "集合 U_t 里收益率的算术平均。" },
      { symbol: "\\sigma_t", meaning: "t 日截面波动，即 U_t 上收益率的样本标准差。" },
      { symbol: "a_{i,t}", meaning: "股票 i 在 t 日的成交额，使用库里的原始单位。" },
      { symbol: "A_t", meaning: "t 日全市场成交额合计。" },
      { symbol: "A_t^{\\text{展示}}", meaning: "把 A_t 换成「亿」之后的读数，只用于显示。" },
      { symbol: "A_t^{300}", meaning: "沪深300指数在 t 日的成交额。" },
      { symbol: "H_t", meaning: "t 日成交额的赫芬达尔指数。" },
      { symbol: "h_t", meaning: "H_t 的 60 日分位。" },
      { symbol: "\\pi_t", meaning: "沪深300成交额占全 A 的百分数。比值不在 2% 到 80% 时，当天不定义。" },
      { symbol: "c_t", meaning: "π_t 的 60 日分位。" },
      { symbol: "s_{\\text{截面}}", meaning: "截面波动因子分，等于 σ 的分位。" },
      { symbol: "s_{\\text{成交}}", meaning: "成交活跃因子分，等于 A 的分位。" },
      { symbol: "s_{\\text{分散}}", meaning: "成交分散因子分，等于 100 减 H 的分位。" },
      { symbol: "s_{\\text{沪深300}}", meaning: "沪深300占比因子分，等于 100 减 π 的分位。" },
    ],
  },
  momentum: {
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
        lead: "五项设计权重加总为 1：涨跌停 0.28，封板 0.22，晋级 0.18，连板高度 0.12，涨停家数 0.20。",
        latex: String.raw`S=\operatorname{round}_{1}\!\left(0.28\,s_{\text{涨跌停}}+0.22\,s_{\text{封板}}+0.18\,s_{\text{晋级}}+0.12\,s_{\text{高度}}+0.20\,s_{\text{家数}}\right)`,
      },
      {
        lead: "状态只看环境分，从上到下命中第一条。",
        latex: String.raw`\text{状态}=\begin{cases}\text{情绪低迷}& S<45\\ \text{情绪中性}& S<60\\ \text{情绪偏热}& S\ge 60\end{cases}`,
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
        lead: "四项都在时，权重是动量 0.40、位置 0.25、波动 0.20、活跃 0.15。缺活跃时前三项按 0.40:0.25:0.20 归一。状态用宽基那一套分档。",
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
        lead: "四项权重 0.30、0.25、0.30、0.15。状态按环境分两档切开。",
        latex: String.raw`\text{状态}=\begin{cases}\text{环境偏好}& S\ge 58\\ \text{中性}& S\ge 48\\ \text{机会偏少}& S<48\end{cases}`,
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
        lead: "环境分是振幅分位的 70% 加实体效率分的 30%。状态按下面顺序命中第一条。",
        latex: String.raw`S=\operatorname{round}_{1}(0.70\,s_{\text{振幅}}+0.30\,s_{\text{实体}})`,
      },
      {
        lead: "偏静有两条入口：振幅分位低于 30 且实体效率低于 12，或者环境分低于 45。分数高但实体效率不足 15 时，写成有振幅、方向弱。",
        latex: String.raw`\text{状态}=\begin{cases}\text{偏静}& q(\bar a)<30\text{ 且 }\bar e<12\\ \text{良（可做）}& S\ge 64\text{ 且 }\bar e\ge 15\\ \text{有振幅，方向弱}& S\ge 64\\ \text{偏静}& S<45\\ \text{中性}& \text{其余}\end{cases}`,
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
        lead: "环境分三项的设计权重是振幅 0.35、结构 0.50、隔夜 0.15。路径分和反转分没有自己的权重，所以这里不做第二次归一。",
        latex: String.raw`S=\operatorname{round}_{1}\!\left(0.35\,s_{\text{振幅}}+0.50\,s_{\text{结构}}+0.15\,s_{\text{隔夜}}\right)`,
      },
      {
        lead: "状态先看结构，再看分数。路径效率的单位是百分数。偏反转还要求自相关小于 −0.1，或方差比小于 0.85；只有效率低、相关和方差比都普通时，写成来回磨。",
        latex: String.raw`\text{状态}=\begin{cases}\text{趋势段}& \eta\ge 30\text{ 且 }s_{\text{路径}}\ge s_{\text{反转}}\\ \text{来回磨，偏反转}& \eta<28\text{ 且 }(\rho_1<-0.1\text{ 或 }VR_4<0.85)\\ \text{来回磨}& \eta<28\\ \text{良（可做）}& S\ge 64\\ \text{中性}& S\ge 50\\ \text{谨慎}& S<50\end{cases}`,
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
