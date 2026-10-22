export const ACCOUNT_PROFILE_EVENT = "ma-account-profile"

export type AccountTheme = "system" | "light" | "dark"
export type AccountDensity = "comfortable" | "compact"
export type AccountLanding = "overview" | "account"
export type AccountChartAccess = "any" | "mom"
export type AccountBoardColumns = 1 | 2 | 3 | 4
export type AccountChartWidth = "narrow" | "half" | "wide" | "full"
export type AccountChartHeight = "s" | "m" | "l" | "auto"

export type AccountChartDef = {
  id: string
  title: string
  description: string
  group: string
  href: string
  access: AccountChartAccess
  wide?: boolean
}

export const ACCOUNT_CHARTS: AccountChartDef[] = [
  {
    id: "ashare-crowding",
    title: "A股拥挤度",
    description: "成交额集中度与市场情绪",
    group: "股票与宽基",
    href: "/ma/dashboard/stock-market",
    access: "any",
    wide: true,
  },
  {
    id: "turnover-concentration",
    title: "成交额集中度",
    description: "全市场成交向头部个股集中的程度",
    group: "股票与宽基",
    href: "/ma/dashboard/realtime-quotes",
    access: "any",
    wide: true,
  },
  {
    id: "scale-index-vol",
    title: "宽基波动率",
    description: "主要宽基指数的实现波动",
    group: "股票与宽基",
    href: "/ma/dashboard/realtime-quotes",
    access: "any",
  },
  {
    id: "scale-index-cross-vol",
    title: "宽基交叉波动",
    description: "宽基之间的波动对照",
    group: "股票与宽基",
    href: "/ma/dashboard/realtime-quotes",
    access: "any",
  },
  {
    id: "scale-index-beat",
    title: "宽基跑赢比例",
    description: "成分股跑赢指数的比例",
    group: "股票与宽基",
    href: "/ma/dashboard/realtime-quotes",
    access: "any",
  },
  {
    id: "iv-ih",
    title: "上证50隐含波动率",
    description: "HO 对应 QVIX，近月平值隐含波动率",
    group: "股票与宽基",
    href: "/ma/dashboard/realtime-quotes",
    access: "any",
  },
  {
    id: "iv-if",
    title: "沪深300隐含波动率",
    description: "IO 对应 QVIX，近月平值隐含波动率",
    group: "股票与宽基",
    href: "/ma/dashboard/realtime-quotes",
    access: "any",
  },
  {
    id: "iv-ic",
    title: "中证500隐含波动率",
    description: "500ETF 期权对应 QVIX",
    group: "股票与宽基",
    href: "/ma/dashboard/realtime-quotes",
    access: "any",
  },
  {
    id: "iv-im",
    title: "中证1000隐含波动率",
    description: "MO 对应 QVIX，近月平值隐含波动率",
    group: "股票与宽基",
    href: "/ma/dashboard/realtime-quotes",
    access: "any",
  },
  {
    id: "regime-similarity",
    title: "经济体制相似性",
    description: "当前宏观状态与历史月份的距离",
    group: "宏观",
    href: "/ma/dashboard/macro-market",
    access: "any",
    wide: true,
  },
  {
    id: "market-state",
    title: "当前市场状态",
    description: "PCA 聚类散点，可切换日、周、月",
    group: "宏观",
    href: "/ma/dashboard/macro-market",
    access: "any",
  },
  {
    id: "economic-quadrant",
    title: "经济象限",
    description: "增长与避险两个方向上的当前象限",
    group: "宏观",
    href: "/ma/dashboard/macro-market",
    access: "any",
  },
  {
    id: "pca-biplot",
    title: "PCA 双标图",
    description: "资产载荷与历史状态在同一张图上",
    group: "宏观",
    href: "/ma/dashboard/macro-market",
    access: "any",
  },
  {
    id: "asset-returns",
    title: "大类资产收益",
    description: "股票、债券、黄金、商品的阶段收益",
    group: "宏观",
    href: "/ma/dashboard/macro-market",
    access: "any",
    wide: true,
  },
  {
    id: "regime-timeseries",
    title: "体制时间序列",
    description: "聚类状态沿时间的变化",
    group: "宏观",
    href: "/ma/dashboard/macro-market",
    access: "any",
    wide: true,
  },
  {
    id: "money-credit",
    title: "货币与信用",
    description: "社融与利率划分的货币信用周期",
    group: "宏观",
    href: "/ma/dashboard/macro-market",
    access: "any",
    wide: true,
  },
  {
    id: "fomc-fedwatch",
    title: "下次加息概率",
    description: "CME FedWatch 对下次 FOMC 加息 25bp 的隐含概率",
    group: "宏观",
    href: "/ma/dashboard/macro-market",
    access: "any",
    wide: true,
  },
  {
    id: "fomc-core-mom",
    title: "核心 CPI 环比",
    description: "2026 年核心 CPI 季调环比，对照 2% 年化",
    group: "宏观",
    href: "/ma/dashboard/macro-market",
    access: "any",
  },
  {
    id: "fomc-aug-parts",
    title: "8 月 CPI 分项",
    description: "能源、住房和超级核心对 8 月通胀的贡献",
    group: "宏观",
    href: "/ma/dashboard/macro-market",
    access: "any",
  },
  {
    id: "fomc-nfp",
    title: "非农新增",
    description: "2026 年非农就业人数与前 12 个月均值",
    group: "宏观",
    href: "/ma/dashboard/macro-market",
    access: "any",
  },
  {
    id: "fomc-unrate-2026",
    title: "2026 失业率",
    description: "2026 年各月季调失业率",
    group: "宏观",
    href: "/ma/dashboard/macro-market",
    access: "any",
  },
  {
    id: "fomc-nfp-unrate",
    title: "非农与失业率",
    description: "同一份就业报告里的新增就业和失业率",
    group: "宏观",
    href: "/ma/dashboard/macro-market",
    access: "any",
    wide: true,
  },
  {
    id: "fomc-unrate",
    title: "失业率叠加 FOMC",
    description: "美国失业率 U-3，并标出历次议息",
    group: "宏观",
    href: "/ma/dashboard/macro-market",
    access: "any",
    wide: true,
  },
  {
    id: "fomc-u6",
    title: "U-3 与 U-6",
    description: "头条失业率与广义失业是否一起下降",
    group: "宏观",
    href: "/ma/dashboard/macro-market",
    access: "any",
    wide: true,
  },
  {
    id: "fomc-sahm",
    title: "Sahm 规则",
    description: "失业率升幅相对衰退阈值 0.50",
    group: "宏观",
    href: "/ma/dashboard/macro-market",
    access: "any",
  },
  {
    id: "fomc-participation",
    title: "劳动参与率",
    description: "就业改善是否来自劳动参与率下降",
    group: "宏观",
    href: "/ma/dashboard/macro-market",
    access: "any",
  },
  {
    id: "fomc-cpi-yoy",
    title: "CPI 同比",
    description: "美国 CPI 同比实际与预期，叠加 FOMC",
    group: "宏观",
    href: "/ma/dashboard/macro-market",
    access: "any",
    wide: true,
  },
  {
    id: "fomc-core-cpi",
    title: "核心 CPI 同比",
    description: "剔除食品能源的 CPI 同比，叠加 FOMC",
    group: "宏观",
    href: "/ma/dashboard/macro-market",
    access: "any",
    wide: true,
  },
  {
    id: "fomc-core-pce",
    title: "核心 PCE 同比",
    description: "美联储目标指标核心 PCE，叠加 FOMC",
    group: "宏观",
    href: "/ma/dashboard/macro-market",
    access: "any",
    wide: true,
  },
  {
    id: "fomc-cpi-mom",
    title: "CPI 环比",
    description: "头条与核心 CPI 季调环比，叠加 FOMC",
    group: "宏观",
    href: "/ma/dashboard/macro-market",
    access: "any",
    wide: true,
  },
  {
    id: "fomc-meeting-cpi",
    title: "会议时的 CPI",
    description: "每次 FOMC 开会时手里的 CPI 同比",
    group: "宏观",
    href: "/ma/dashboard/macro-market",
    access: "any",
    wide: true,
  },
  {
    id: "fomc-surprise",
    title: "CPI 意外",
    description: "每次会议时 CPI 相对一致预期的偏差",
    group: "宏观",
    href: "/ma/dashboard/macro-market",
    access: "any",
  },
  {
    id: "fomc-funds",
    title: "决议后政策利率",
    description: "每次决议后的联邦基金目标区间上限",
    group: "宏观",
    href: "/ma/dashboard/macro-market",
    access: "any",
  },
  {
    id: "fomc-cross",
    title: "CPI 意外与决议",
    description: "CPI 偏热或偏冷时，加息、按兵不动、降息各有多少次",
    group: "宏观",
    href: "/ma/dashboard/macro-market",
    access: "any",
  },
  {
    id: "fut-nhci",
    title: "南华商品指数",
    description: "去年至今每日收盘价",
    group: "期货",
    href: "/ma/dashboard/futures-market",
    access: "any",
    wide: true,
  },
  {
    id: "fut-sector",
    title: "南华板块指数",
    description: "去年至今累计涨跌幅，同一起点",
    group: "期货",
    href: "/ma/dashboard/futures-market",
    access: "any",
    wide: true,
  },
  {
    id: "fut-sector-vol",
    title: "南华板块滚动波动率",
    description: "20日滚动年化波动率",
    group: "期货",
    href: "/ma/dashboard/futures-market",
    access: "any",
    wide: true,
  },
  {
    id: "fut-sector-cs",
    title: "南华板块截面波动率",
    description: "各板块日收益率的截面标准差",
    group: "期货",
    href: "/ma/dashboard/futures-market",
    access: "any",
  },
  {
    id: "fut-corr-matrix",
    title: "南华板块滚动相关性矩阵",
    description: "板块之间的滚动相关性",
    group: "期货",
    href: "/ma/dashboard/futures-market",
    access: "any",
  },
  {
    id: "fut-corr-trend",
    title: "南华板块滚动相关性走势",
    description: "选定板块与其它板块的相关性时序",
    group: "期货",
    href: "/ma/dashboard/futures-market",
    access: "any",
    wide: true,
  },
  {
    id: "fut-scatter",
    title: "商品波动率与南华相关性",
    description: "品种波动率相对南华商品指数的相关性",
    group: "期货",
    href: "/ma/dashboard/futures-market",
    access: "any",
  },
  {
    id: "fut-dist",
    title: "品种相关性与波动率分布",
    description: "各品种与南华指数的相关性，或波动率分布",
    group: "期货",
    href: "/ma/dashboard/futures-market",
    access: "any",
  },
  {
    id: "fut-amount",
    title: "商品期货日成交额排行",
    description: "当日成交额分布",
    group: "期货",
    href: "/ma/dashboard/futures-market",
    access: "any",
    wide: true,
  },
  {
    id: "fut-basis-cont",
    title: "四大连续合约基差时序",
    description: "股指期货连续合约基差",
    group: "期货",
    href: "/ma/dashboard/futures-market",
    access: "any",
    wide: true,
  },
  {
    id: "fut-index-quote",
    title: "近月与远月期指",
    description: "股指期货近月、远月行情",
    group: "期货",
    href: "/ma/dashboard/futures-market",
    access: "any",
  },
  {
    id: "fut-basis-rate",
    title: "近月与远月年化基差率",
    description: "股指期货年化基差率截面",
    group: "期货",
    href: "/ma/dashboard/futures-market",
    access: "any",
  },
  {
    id: "fut-basis-ts",
    title: "近月与远月基差时序",
    description: "结算价相对现货收盘的基差",
    group: "期货",
    href: "/ma/dashboard/futures-market",
    access: "any",
    wide: true,
  },
  {
    id: "fut-basis-ann",
    title: "近月与远月年化基差率时序",
    description: "年化基差率的历史走势",
    group: "期货",
    href: "/ma/dashboard/futures-market",
    access: "any",
    wide: true,
  },
  {
    id: "fut-contract-ann",
    title: "合约年化基差率时序",
    description: "IH、IF、IC、IM 各合约年化基差率",
    group: "期货",
    href: "/ma/dashboard/futures-market",
    access: "any",
    wide: true,
  },
  {
    id: "fin-summary",
    title: "金融期权波动率概览",
    description: "股指与 ETF 当前 IV 与历史分位",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
  },
  {
    id: "fin-summary-pct",
    title: "金融期权 IV 分位对比",
    description: "按市值分组比较全历史分位",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
    wide: true,
  },
  {
    id: "fin-qvix",
    title: "金融期权 QVIX 时序",
    description: "ATM 隐含波动率指数，图内可切换品种",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
    wide: true,
  },
  {
    id: "fin-percentile",
    title: "金融期权 IV 分位",
    description: "全历史与 1 年滚动分位，图内可切换品种",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
    wide: true,
  },
  {
    id: "fin-term",
    title: "金融期权 IV 期限结构",
    description: "各到期月 ATM 隐含波动率",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
    wide: true,
  },
  {
    id: "fin-smile",
    title: "金融期权波动率微笑",
    description: "近月虚值期权 IV 相对行权价",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
  },
  {
    id: "fin-chain",
    title: "金融期权链微笑",
    description: "近月链 IV 与持仓量",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
    wide: true,
  },
  {
    id: "fin-surface",
    title: "金融期权 IV 曲面",
    description: "行权价、到期天数与隐含波动率",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
    wide: true,
  },
  {
    id: "fin-iv-rv",
    title: "金融期权 IV 与实现波动",
    description: "隐含波动相对 20 日、60 日实现波动",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
    wide: true,
  },
  {
    id: "fin-peer-iv",
    title: "金融期权同组 IV",
    description: "同组品种 ATM 隐含波动率走势",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
    wide: true,
  },
  {
    id: "fin-skew",
    title: "金融期权当日偏度",
    description: "翼部 IV 与 Risk Reversal、Butterfly",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
  },
  {
    id: "fin-skew-hist",
    title: "金融期权偏度时序",
    description: "Risk Reversal 与 Butterfly 的历史",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
    wide: true,
  },
  {
    id: "fin-pcr",
    title: "金融期权 Put/Call 持仓",
    description: "近月链看跌与看涨持仓量",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
  },
  {
    id: "fin-pcr-hist",
    title: "金融期权 PCR 时序",
    description: "Put/Call 持仓比的历史",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
    wide: true,
  },
  {
    id: "fin-term-slope",
    title: "金融期权期限斜率",
    description: "远月减近月 ATM IV 的历史",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
    wide: true,
  },
  {
    id: "fin-vol-cone",
    title: "金融期权波动率锥",
    description: "实现波动的历史分位带，对照当前 RV 与 IV",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
  },
  {
    id: "fin-iv-heat",
    title: "金融期权 IV 分位热力",
    description: "各品种全历史与 1 年滚动分位",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
    wide: true,
  },
  {
    id: "cmd-summary",
    title: "商品期权波动率概览",
    description: "各品种当前 IV 与历史分位",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
  },
  {
    id: "cmd-summary-pct",
    title: "商品期权 IV 分位对比",
    description: "按板块比较全历史分位",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
    wide: true,
  },
  {
    id: "cmd-history",
    title: "商品期权系列 IV 时序",
    description: "交易所公布的近月系列隐含波动率",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
    wide: true,
  },
  {
    id: "cmd-percentile",
    title: "商品期权 IV 分位",
    description: "全历史与 1 年滚动分位，图内可切换品种",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
    wide: true,
  },
  {
    id: "cmd-term",
    title: "商品期权 IV 期限结构",
    description: "各合约系列的 ATM 隐含波动率",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
    wide: true,
  },
  {
    id: "cmd-iv-rv",
    title: "商品期权 IV 与实现波动",
    description: "系列 IV 相对 20 日、60 日实现波动",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
    wide: true,
  },
  {
    id: "cmd-peer-iv",
    title: "商品期权同组 IV",
    description: "同板块品种系列 IV 走势",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
    wide: true,
  },
  {
    id: "cmd-skew",
    title: "商品期权当日偏度",
    description: "翼部 IV 与 Risk Reversal、Butterfly",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
  },
  {
    id: "cmd-skew-hist",
    title: "商品期权偏度时序",
    description: "Risk Reversal 与 Butterfly 的历史",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
    wide: true,
  },
  {
    id: "cmd-pcr",
    title: "商品期权 Put/Call 持仓",
    description: "近月链看跌与看涨持仓量",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
  },
  {
    id: "cmd-pcr-hist",
    title: "商品期权 PCR 时序",
    description: "Put/Call 持仓比的历史",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
    wide: true,
  },
  {
    id: "cmd-term-slope",
    title: "商品期权期限斜率",
    description: "远月减近月 ATM IV 的历史",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
    wide: true,
  },
  {
    id: "cmd-vol-cone",
    title: "商品期权波动率锥",
    description: "实现波动的历史分位带，对照当前 RV 与 IV",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
  },
  {
    id: "cmd-iv-heat",
    title: "商品期权 IV 分位热力",
    description: "各品种全历史与 1 年滚动分位",
    group: "期权",
    href: "/ma/dashboard/options-market",
    access: "any",
    wide: true,
  },
  {
    id: "rolling-vol",
    title: "滚动波动率",
    description: "产品净值相对基准的滚动波动",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/risk-report",
    access: "mom",
  },
  {
    id: "var-prediction",
    title: "VaR 预测",
    description: "历史波动下的在险价值与突破",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/risk-report",
    access: "mom",
    wide: true,
  },
  {
    id: "sector-position",
    title: "板块仓位",
    description: "商品、股指、国债与细分板块暴露",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/risk-report",
    access: "mom",
    wide: true,
  },
  {
    id: "equity-curve",
    title: "盘手收益曲线",
    description: "账户累计盈亏与权益",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis?tab=equity-curve",
    access: "mom",
    wide: true,
  },
  {
    id: "account-daily-pnl",
    title: "账户当日盈亏",
    description: "各账户最新交易日盈亏",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/risk-report",
    access: "mom",
  },
  {
    id: "sector-daily-pnl",
    title: "板块当日盈亏",
    description: "板块合计与多空盈亏",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/risk-report",
    access: "mom",
    wide: true,
  },
  {
    id: "advisor-equity",
    title: "投顾收益曲线",
    description: "投顾账户累计收益与基准",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "advisor-pnl-hist",
    title: "投顾盈亏分布",
    description: "投顾盈亏直方图与分布拟合",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
  },
  {
    id: "option-floating-pnl",
    title: "期权浮动盈亏",
    description: "期权持仓按账户与品种的浮动盈亏",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/risk-report",
    access: "mom",
    wide: true,
  },
  {
    id: "nhci-candle",
    title: "南华商品指数K线",
    description: "南华商品指数日K与副图",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "product-candle",
    title: "品种日K",
    description: "单品种日K、成交量与指标，默认可在图内改品种",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "cross-account",
    title: "跨账户对照",
    description: "同一品种在不同账户上的持仓与盈亏",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "au-trading",
    title: "品种交易复盘",
    description: "价格、成交与持仓对照，默认黄金，图内可切换",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "qvs-signals",
    title: "MOM 决策信号",
    description: "量化与主观的方向信号",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "qvs-allocation",
    title: "量化与主观资金分配",
    description: "保证金在量化账户与主观账户之间的占比",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
  },
  {
    id: "qvs-q-holding",
    title: "量化多空持仓",
    description: "量化账户多空持仓时序",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "qvs-s-holding",
    title: "主观多空持仓",
    description: "主观账户多空持仓时序",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "qvs-q-candle",
    title: "量化 K 线与盈亏",
    description: "筛选品种的 K 线与量化累计盈亏",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "qvs-s-candle",
    title: "主观 K 线与盈亏",
    description: "筛选品种的 K 线与主观累计盈亏",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "qvs-waterfall",
    title: "持仓边际拆解",
    description: "昨净仓、价格变动与主动调仓",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "qvs-sector-bar",
    title: "板块敞口：量化 vs 主观",
    description: "各板块风险或保证金的量化与主观对比",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
  },
  {
    id: "qvs-sector-scatter",
    title: "板块方向共识",
    description: "量化与主观在板块上的方向是否一致",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
  },
  {
    id: "qvs-sector-flow",
    title: "板块边际散点",
    description: "量化与主观的一日主动调仓",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
  },
  {
    id: "qvs-product-flow",
    title: "品种边际散点",
    description: "品种上的一日主动调仓",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
  },
  {
    id: "qvs-product-bar",
    title: "品种敞口对比",
    description: "品种风险或保证金的量化与主观对比",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
  },
  {
    id: "qvs-product-scatter",
    title: "品种方向共识",
    description: "量化与主观在品种上的方向是否一致",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
  },
  {
    id: "qvs-sector-ts",
    title: "板块敞口时序",
    description: "选定板块的量化与主观敞口历史",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "qvs-product-ts",
    title: "品种敞口时序",
    description: "选定品种的量化与主观敞口历史",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "qvs-signal-hist",
    title: "决策信号历史",
    description: "每日信号数量与板块热力",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "qvs-sector-table",
    title: "板块对照表",
    description: "量化与主观的板块风险和保证金",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "qvs-product-table",
    title: "品种对照表",
    description: "量化与主观的品种风险、保证金与波动",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "qs-edge-sector",
    title: "板块胜率与盈亏比",
    description: "每个板块的胜率和盈亏比",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
  },
  {
    id: "qs-edge-product",
    title: "品种胜率与盈亏比",
    description: "每个品种的胜率和盈亏比",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
  },
  {
    id: "qs-alpha-nav",
    title: "净值与南华商品指数",
    description: "账户净值对照南华商品指数",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "qs-alpha-cum",
    title: "累计 alpha 与 beta",
    description: "不跟着南华的盈亏，和跟着南华的盈亏",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "qs-alpha-sector",
    title: "各板块 alpha",
    description: "板块盈亏里不跟着南华的部分",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
  },
  {
    id: "qs-book-sector",
    title: "板块风险贡献",
    description: "各板块对组合风险的贡献",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
  },
  {
    id: "qs-book-product",
    title: "品种占组合风险",
    description: "品种风险占组合的比重",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
  },
  {
    id: "qs-freq",
    title: "板块成交天数",
    description: "各板块的交易频率",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
  },
  {
    id: "qs-sector-vol",
    title: "板块波动与敞口",
    description: "市场波动对照板块风险贡献",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "qs-roll-edge",
    title: "滚动胜率与盈亏比",
    description: "按交易日滚动的胜率、盈亏比和这段盈亏",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "qs-mkt-edge",
    title: "不同市况的胜率与盈亏比",
    description: "趋势和震荡市况下的胜率与盈亏比",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "qs-hedge-corr",
    title: "对冲、敞口与南华相关",
    description: "风险贡献、对冲度和与南华的相关性",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "qs-hold-freq",
    title: "持有天数和交易频率",
    description: "持仓多久，以及每天开平仓手数",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "qs-linear",
    title: "策略里的直线关系",
    description: "盈亏和市场变量的线性关系",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "qs-mkt-book",
    title: "市场波动与总敞口",
    description: "组合层：市场波动对照总敞口",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
  },
  {
    id: "qs-mkt-cross",
    title: "品种波动与市值权重",
    description: "截面上品种波动对照市值权重",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
  },
  {
    id: "qs-equity",
    title: "累计盈亏与回撤",
    description: "权益曲线和回撤",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "qs-pnl-hist",
    title: "日盈亏分布",
    description: "日盈亏的分布形态",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
  },
  {
    id: "qs-trade-hist",
    title: "单笔盈亏分布",
    description: "单笔盈亏的胜率与盈亏比形状",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
  },
  {
    id: "qs-factors",
    title: "哪种市场赚得多",
    description: "不同因子分档下的日均盈亏",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "qs-sector-pnl",
    title: "量化板块盈亏",
    description: "平仓盈亏加持仓盯市的板块合计",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
  },
  {
    id: "qs-carry",
    title: "Carry 与趋势一致性",
    description: "贴水升水与多周期趋势是否同向",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
  },
  {
    id: "qs-risk",
    title: "风险度",
    description: "杠杆用到什么水平",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "qs-after",
    title: "盈亏次日行为",
    description: "赚了或亏了之后第二天的仓位变化",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
  },
  {
    id: "qs-payoff",
    title: "盈亏偏好",
    description: "平仓胜率与盈亏比",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
  },
  {
    id: "qs-hold",
    title: "持仓多久才走",
    description: "盈利单和亏损单的持有天数",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
  },
  {
    id: "qs-session",
    title: "日盘与夜盘",
    description: "平仓盈亏发生在日盘还是夜盘",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
  },
  {
    id: "qs-ls",
    title: "多头与空头盈亏",
    description: "平多、平空再加持仓盯市",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
  },
  {
    id: "qs-hedge",
    title: "持仓是否对冲",
    description: "多空对冲度和同一合约双开",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "qs-products",
    title: "量化品种明细",
    description: "按合计盈亏排序的品种表",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "qs-asset-mv",
    title: "大类资产多空持仓",
    description: "这个量化账户的多空持仓市值",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
  {
    id: "qs-var-share",
    title: "持仓 VaR 占比",
    description: "各板块占这个账户组合方差的比例",
    group: "MOM分析",
    href: "/ma/dashboard/mom-analysis/trader-analysis",
    access: "mom",
    wide: true,
  },
]

const CHART_BY_ID = new Map(ACCOUNT_CHARTS.map((chart) => [chart.id, chart]))

export function accountChartById(id: string): AccountChartDef | undefined {
  return CHART_BY_ID.get(id)
}

export type AccountChartBox = {
  width: AccountChartWidth
  height: AccountChartHeight
}

export type AccountChartHolder = AccountChartBox & {
  id: string
  chartId: string | null
}

export type AccountDashboardPrefs = {
  title: string
  theme: AccountTheme
  density: AccountDensity
  landing: AccountLanding
  columns: AccountBoardColumns
  charts: string[]
  layout: Record<string, AccountChartBox>
  holders: AccountChartHolder[]
}

export const DEFAULT_ACCOUNT_CHARTS: string[] = []

export const DEFAULT_ACCOUNT_DASHBOARD: AccountDashboardPrefs = {
  title: "",
  theme: "system",
  density: "comfortable",
  landing: "overview",
  columns: 2,
  charts: [...DEFAULT_ACCOUNT_CHARTS],
  layout: {},
  holders: [],
}

export function defaultChartBox(id: string | null): AccountChartBox {
  return {
    width: id && accountChartById(id)?.wide ? "full" : "half",
    height: "auto",
  }
}

export function createChartHolder(): AccountChartHolder {
  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 6)
  return { id: `h_${stamp}${rand}`.slice(0, 40), chartId: null, width: "half", height: "m" }
}

export function withHolders(prefs: AccountDashboardPrefs, holders: AccountChartHolder[]): AccountDashboardPrefs {
  const projected = projectBoard(holders)
  return { ...prefs, holders, charts: projected.charts, layout: projected.layout }
}

export function chartSpan(width: AccountChartWidth, columns: AccountBoardColumns): number {
  const half = Math.max(1, Math.ceil(columns / 2))
  const wide = Math.max(half, columns - 1)
  if (width === "narrow") return 1
  if (width === "half") return Math.min(columns, half)
  if (width === "wide") return Math.min(columns, wide)
  return columns
}

function asRecord(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return raw as Record<string, unknown>
}

export function normalizeAccountDashboardPrefs(raw: unknown): AccountDashboardPrefs {
  const obj = asRecord(raw)
  const theme: AccountTheme =
    obj.theme === "light" || obj.theme === "dark" || obj.theme === "system" ? obj.theme : "system"
  const density: AccountDensity =
    obj.density === "compact" || obj.density === "comfortable" ? obj.density : "comfortable"
  const landing: AccountLanding =
    obj.landing === "account" || obj.landing === "overview" ? obj.landing : "overview"
  const title = typeof obj.title === "string" ? obj.title.replace(/\s+/g, " ").trim().slice(0, 40) : ""
  const known = new Set(ACCOUNT_CHARTS.map((chart) => chart.id))
  const columns: AccountBoardColumns =
    obj.columns === 1 || obj.columns === 2 || obj.columns === 3 || obj.columns === 4 ? obj.columns : 2
  const source = Array.isArray(obj.charts) ? obj.charts : DEFAULT_ACCOUNT_CHARTS
  const chartsFromList: string[] = []
  for (const item of source) {
    if (typeof item !== "string" || !known.has(item) || chartsFromList.includes(item)) continue
    chartsFromList.push(item)
  }
  const rawLayout = asRecord(obj.layout)
  const usedIds = new Set<string>()
  const holders = Array.isArray(obj.holders)
    ? obj.holders.flatMap((item, index) => {
        const holder = normalizeHolder(item, index, usedIds, known)
        return holder ? [holder] : []
      })
    : chartsFromList.map((chartId, index) => {
        const box = normalizeChartBox(rawLayout[chartId], chartId)
        return { id: stableHolderId(chartId, index, usedIds), chartId, ...box }
      })
  const projected = projectBoard(holders)
  return { title, theme, density, landing, columns, charts: projected.charts, layout: projected.layout, holders }
}

function projectBoard(holders: AccountChartHolder[]): { charts: string[]; layout: Record<string, AccountChartBox> } {
  const charts: string[] = []
  const layout: Record<string, AccountChartBox> = {}
  for (const holder of holders) {
    if (!holder.chartId) continue
    if (!charts.includes(holder.chartId)) charts.push(holder.chartId)
    if (!layout[holder.chartId]) layout[holder.chartId] = { width: holder.width, height: holder.height }
  }
  return { charts, layout }
}

function stableHolderId(chartId: string, index: number, used: Set<string>): string {
  const base = (`h_${chartId}`.replace(/[^a-zA-Z0-9_-]/g, "") || `h_${index + 1}`).slice(0, 32)
  let id = base
  let n = 2
  while (used.has(id)) {
    id = `${base}_${n}`.slice(0, 40)
    n += 1
  }
  used.add(id)
  return id
}

function normalizeHolder(
  raw: unknown,
  index: number,
  used: Set<string>,
  known: Set<string>,
): AccountChartHolder | null {
  const item = asRecord(raw)
  if (Object.keys(item).length === 0 && !Array.isArray(raw)) return null
  let id = typeof item.id === "string" ? item.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) : ""
  if (!id) id = `h_${index + 1}`
  while (used.has(id)) id = `${id.slice(0, 34)}_${used.size}`.slice(0, 40)
  used.add(id)
  const chartId = typeof item.chartId === "string" && known.has(item.chartId) ? item.chartId : null
  const box = normalizeChartBox(item, chartId)
  return { id, chartId, width: box.width, height: box.height }
}

function normalizeChartBox(raw: unknown, id: string | null): AccountChartBox {
  const item = asRecord(raw)
  const fallback = defaultChartBox(id)
  const width: AccountChartWidth =
    item.width === "narrow" || item.width === "half" || item.width === "wide" || item.width === "full"
      ? item.width
      : fallback.width
  const height: AccountChartHeight =
    item.height === "s" || item.height === "m" || item.height === "l" || item.height === "auto"
      ? item.height
      : fallback.height
  return { width, height }
}

export function accountCanUseMom(user: { role?: string; permissions?: { mom?: boolean } } | null | undefined): boolean {
  return !!user && (user.role === "admin" || user.permissions?.mom === true)
}

export function sanitizeAccountDashboardPrefs(raw: unknown, allowMom: boolean): AccountDashboardPrefs {
  const prefs = normalizeAccountDashboardPrefs(raw)
  if (allowMom) return prefs
  const holders = prefs.holders.filter((holder) => {
    if (!holder.chartId) return true
    return accountChartById(holder.chartId)?.access !== "mom"
  })
  return withHolders(prefs, holders)
}

export function accountChartGroups(allowMom: boolean): Array<{ group: string; charts: AccountChartDef[] }> {
  const groups: Array<{ group: string; charts: AccountChartDef[] }> = []
  for (const chart of ACCOUNT_CHARTS) {
    if (chart.access === "mom" && !allowMom) continue
    const found = groups.find((item) => item.group === chart.group)
    if (found) found.charts.push(chart)
    else groups.push({ group: chart.group, charts: [chart] })
  }
  return groups
}
