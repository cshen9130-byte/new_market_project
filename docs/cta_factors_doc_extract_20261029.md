# CTA factors doc extract — 2026-10-29 (Asia/Shanghai)

Source folder: `docs/cta_factors_doc/`. White paper OCR via RapidOCR (scanned PDF).

## 1. What each doc contains

| File | Contents |
|---|---|
| `CTA因子白皮书-国泰君安期货资管经典八因子.pdf` (~32MB, 41p, scanned) | **Priority.** Classic-8 factor white paper (对客版, 2026.09). Unified construction + one-sentence definitions + performance for 长期截面/长期规则/中期动量/量价相关性/基差/基差动量/库存/利润. Wind codes GTJAQH017–023/009. |
| `量化CTA因子&指数收盘价-含万得公式.xlsx` (~666KB) | **Priority for Wind codes.** Sheet `CTA因子`: Wind `i_dq_close` pulls for GTJAQH001–013 (旧编号表). Labels: 长期动量/波动/反转/偏度/中期动量/量价相关性/长期规则动量/截面动量/期限基差/仓单/库存/基差/利润. **No construction formulas** — only index close formulas. Sheet `指数收盘价`: related index closes. |
| `CTA因子产品对比.xlsx` | Product comparison: 中波等权 / 2号高波 / 3号 / 多因子指数. Factor lists, target vol, fees, backtest stats. Sheet `因子构成对比`: brochure method blurbs + Wind codes (021/017/009/022…). |
| `【合规版】…CTA因子组合3号…20260714(1).pdf` (26p) | CTA3 marketing deck: Alpha/Beta framing, 9-factor stack (4 fundamental + 4 PV + 会员持仓), 60% equal Smart Beta + 40% Alpha, risk scenarios per factor. |
| `CTA因子组合周报20261009_cta1_【对客版】.pdf` (~16MB, 1p scanned) | Weekly client report snapshot (image); no text layer. Performance/attribution for CTA1 — not methodology. |
| `期货因子.png` | External taxonomy screenshot (趋势/期限结构/量价/基本面). Includes concrete roll-yield formula `Rt=[lnP(T,N)-lnP(T,D)]*365/[N(T,N)-N(T,D)]`, CS mom top/bottom 20%, TS mom 5/22/66. Peer/tutorial style — not Guojun closed-form. |

## 2. Wind code map (white paper vs Excel dump)

White paper (核心商品 classic-8) uses **new** codes; local `gtjaqh_closes.csv` / Excel dump is **001–013** with different numbering:

| Factor | 构建方式 (WP p7) | White paper Wind | Excel dump (label) | Our live UI |
|---|---|---|---|---|
| 长期截面 | 截面 | GTJAQH022 | GTJAQH013 截面动量 | report_cs_long → calib 013 |
| 长期规则动量 | 时序 | GTJAQH019 | GTJAQH010 长期规则动量 | report_long_rule |
| 中期动量 | 时序 | GTJAQH018 | GTJAQH008 中期动量 | report_mid_mom |
| 量价相关性 | 截面 | GTJAQH020 | GTJAQH011 量价相关性 | report_pv_corr |
| 基差 | **时序** | GTJAQH021 | GTJAQH012 基差 | report_basis_spot → calib 012 |
| 基差动量 | 截面 | GTJAQH023 | (not in 001–013) | report_basis_mom |
| 库存 | 截面 | GTJAQH017 | GTJAQH007 库存 | report_inventory → calib 007 |
| 利润 | 时序 | GTJAQH009 | GTJAQH009 利润 | report_profit |

> Do **not** invent 017/021/022 closed forms from 007/012/013. Calib stays on dump codes; WP text is methodology guidance.

## 3. Unified construction (WP §1.1)

- 主力: max OI; switch next day when new OI > 1.1× old.
- 次主力: farther than current 主力, never been 主力/次主力, max OI among those.
- Universe: all commodity futures, **exclude financial + bond**; drop listed <1y; 主力 20d & 60d avg turnover both ≥ 10亿 else drop next day.
- Backtest: weight after ↑ close; trade next open TWAP5; notional 1亿; impact cost 1bp; sample 2016/01–2026/06 (利润 from 2019).
- **截面**: group L/S, equal long/short notional, **no net exposure**.
- **时序**: sign(factor) for direction, **weight by |factor|**, **net exposure allowed**.

## 4. Concrete one-sentence formulas (quote from WP OCR)

### 长期截面 (WP p9)

```
国泰君安期货·CTA因子白皮书(对客版)
安期货
量价类因子
2. 长期截面因子(核心商品)
WIND：GTJAQH022.WI·Bloomberg：GJFQCSM
2.1. 一句话定义
长期截面因子刻画商品品种在较长周期内价格趋势的强度与稳定性：基于各品种日频
数据，采用过去一段时间的复权价格对时间进行回归，取回归系数与强度的乘积为因子
值，再按因子值从排序，做多因子值大的品种，同时做空因子值小的品种，多空市值相
等，日均换手率约为7.7%。
管理
2.2. 核心绩效速览
区间2016/01-2026/06
10.24%
8.83%
1.16
-10.47%
61.9%
0.98
年化收益
年化波动
夏普比率
最大回撤
月度胜率
卡玛比率
安期货
长期截面（核心商品）因子指数净值走势(2016/01-2026/06)
2.8
2.7
2.6
2.5
2.4
2.3
2.2
2.1
2.0
泰
1.9
净值
1.8
1.7
1.6
1.5
1.4
1.3
1.2
1.1
1.0
-60
0.8
0%
-2%
-4%
-6%
-8%
-10%
国
-12%
4.0
滚动252日夏普
3.0
20
1.0
0.0
-1.0-
2018
2020
2022
2024
2026
资料来源：WIND万得数据库，国泰君安期货研究
国泰
长期截面因子（核心商品）
```

### 长期规则动量 (WP p13)

```
国泰君安期货·CTA因子白皮书（对客版）
安期货
量价类因子
3. 长期规则动量因子（核心商品)
WIND：GTJAQH019.WI·Bloomberg:GJFQLRM
3.1. 一句话定义
长期规则动量因子跟踪各品种自身的中长期趋势方向：基于各品种日频数据，计算
长、短期均线值，做多短均线位于长均线以上的品种，做空短均线位于长均线以下的品
种，日均换手率约为15.5%。
3.2. 核心绩效速览区间2016/01-2026/06
4.40%
6.17%
0.71
-12.92%
57.1%
0.34
年化收益
年化波动
夏普比率
最大回撤
月度胜率
卡玛比率
长期规则动量（核心商品）因子指数净值走势(2016/01-2026/06)
1.7
1.6
1.5
1.4
理
1.3
净值
1.2
泰
1.1
1.0
-60
最大回撤-12.92%
0%
-2%
-4%
-6%
-8%
-10%
-12%
-14%
3.0
国
滚动252日夏普
2.0
1.0
0.0
-1.0
-2.0
2018
2020
2022
2024
2026
资料来源：WIND万得数据库，国泰君安期货研究
国泰
长期规则动量因子（核心商品)
—13—
```

### 中期动量 (WP p17)

```
国泰君安期货·CTA因子白皮书（对客版）
安期货
量价类因子
4. 中期动量因子（核心商品）
WIND：GTJAQH018.WI·Bloomberg:GJFQMTM
4.1.一句话定义
中期动量因子跟踪各品种自身在中等时间尺度上的价格趋势：基于各品种日频数据，
计算过去一段时间的累计涨跌幅为因子值，做多因子值高（中期走强）的品种，同时做空
因子值低（中期走弱）的品种。
4.2. 核心绩效速览区间2016/01-2026/06
6.44%
12.19%
0.53
-18.29%
55.6%
0.35
年化收益
年化波动
夏普比率
最大回撤
月度胜率
卡玛比率
中期动量（核心商品）因子指数净值走势（2016/01-2026/06)
2.1
君安期
2.0
1.9
1.8
1.7
1.6
1.5
1.4
最大回撤-18.29%
泰
1.3
1.2
1.1
1.0
0.9
0%
-5%
-1%
-15%
-20%
3.0
国
滚动252日夏普
2.0
1.0
0.0
-1.0
-2.0
2018
2020
2022
2024
2026
资料来源：WIND万得数据库，国泰君安期货研究
国泰
中期动量因子（核心商品）
—17—
```

### 量价相关性 (WP p21)

```
理
国泰君安期货·CTA因子白皮书(对客版)
安期货
量价类因子
5. 量价相关性因子（核心商品）
WIND：GTJAQH020.WI·Bloomberg：GJFQVPC
5.1.一句话定义
量价相关性因子关注商品品种“价格波动”与“成交热度”的同步程度：基于各品种
日频数据，计算过去一段时间各品种成交量和价格的相关系数，再按因子值从小至大排
列，做多因子值小的品种，同时做空因子值大的品种，多空市值相等，日均换手率约为
12%。
管理
5.2.核心绩效速览区间2016/01-2026/06
6.98%
8.64%
0.81
-14.39%
65.1%
0.49
年化收益
年化波动
夏普比率
最大回撤
月度胜率
卡玛比率
安期货
量价相关性（核心商品）因子指数净值走势(2016/01-2026/06)
2.11
2.0
1.9
1.8
1.7
1.6
泰
1.5
1.4
1.3
1.2
1.1
最大回撤-14.39%
0.9
0%
-2%
-4%
-6%
-8%
-10%
-12%
-14%
国
-16%
3.0
滚动252日夏普
2.0
1.0
0.0
-1.0
-2.0
2018
2020
2022
2024
2026
资料来源：WIND万得数据库，国泰君安期货研究
国泰
量价相关性因子（核心商品）
```

### 基差 (WP p25)

```
国泰
理
安期货
国泰君安期货·CTA 因子白皮书(对客版）
基本面类因子
6. 基差因子 （核心商品)
WIND：GTJAQH021.WI·Bloomberg：GJFQBAS
6.1.一句话定义
基差因子捕捉期现回归所产生的展期收益：基于各品种期货与现货数据，计算基差
率，做多贴水品种，做空升水品种，按因子值加权，日均换手率约为6.2%。
6.2.核心绩效速览区间2016/01-2026/06
11.43%
9.22%
1.24
-14.33%
58.7%
0.80
理
年化收益
年化波动
夏普比率
最大回撤
月度胜率
卡玛比率
国
基差（核心商品）因子指数净值走势（2016/01-2026/06)
3.21
3.1
3.0
2.9
2.8
2.7
2.6
2.5
管理
24
2.3
最大回撤-14.33%
2.2
净值
2.1
2.0
1.9
1.8
1.7
1.6
1.5
泰
1.4
1.3
1.2
1.1
1.0
0.9
0%
-2%
-4%
-6%
%8-
-10%
-12%
-14%
-16%
4.0
滚动252日夏普
3.0
2.0
1.0
国
0.0
-1.0
理部
2018
2020
2022
2024
2026
货资
资料来源：WIND万得数据库，国泰君安期货研究
国泰
基差因子(核心商品)
—25—
```

### 基差动量 (WP p29)

```
国泰君安期货·CTA因子白皮书(对客版)
安期货
基本面类因子
7. 基差动量因子（核心商品）
WIND：GTJAQH023.WI·Bloomberg：GJFQBAM
7.1.一句话定义
基差动量因子关注主次合约间期限结构的变化方向，而非其绝对水平：基于各品种主
力合约与次主力合约数据，计算基差率在过去一段时间的变化，做多基差率向贴水方向移
动的品种，同时做空向升水方向移动的品种，以此捕捉期限结构边际改善所带来的收益。
7.2. 核心绩效速览区间2016/01-2026/06
5.30%
7.66%
0.69
-13.62%
58.7%
0.39
年化收益
年化波动
夏普比率
最大回撤
月度胜率
卡玛比率
基差动量（核心商品）因子指数净值走势(2016/01-2026/06)
1.9
1.8
1.7
1.6
1.5
1.4
1.3
最大回撤-13.62%
泰
1.2
1.1
1.0
0.9
0%
-2%
-4%
-6%
-8%
-10%
-12%
-14%
3.0
国
滚动252日夏普
2.0
1.0
0.0
-1.0
-2.0
2018
2020
2022
2024
2026
资料来源：WIND万得数据库，国泰君安期货研究
国泰
基差动量因子（核心商品）
```

### 库存 (WP p33)

```
国泰君安期货·CTA因子白皮书（对客版）
安期货
基本面类因子
8. 库存因子（核心商品)
WIND：GTJAQH017.WI·Bloomberg:GJFQIVT
8.1.一句话定义
库存因子从供需格局出发捕捉品种间的强弱差异：基于各品种库存数据，计算库存变
化率，按因子值从大至小排列，做多因子值小（去库）的品种，同时做空因子值大（累
库）的品种，多空市值相等；因库存数据更新频率较低，该因子采用周度换仓，日均换手
率约为 7.9%。
管理
8.2. 核心绩效速览区间2016/01-2026/06
5.82%
6.97%
0.84
-10.00%
58.7%
0.58
年化收益
年化波动
夏普比率
最大回撤
月度胜率
卡玛比率
安期货
库存(核心商品)因子指数净值走势(2016/01-2026/06)
1.9]
1.8
1.7
1.6
1.5
泰
1.4
1.3
1.2
1.1
1.0
最大回撤-10.00%
0%
-2%
-4%
-6%
-8%
-10%
国
-12%
3.0
滚动252日夏普
2.0
1.0
0.0
-1.0
2018
2020
2022
2024
2026
资料来源：WIND万得数据库，国泰君安期货研究
国泰
库存因子(核心商品)
-33—
```

### 利润 (WP p37)

```
理
君安期货
国泰君安期货·CTA 因子白皮书
基本面类因子
9. 利润因子
WIND：GTJAQH009.WI·Bloomberg：GTJAFPRF
9.1.一句话定义
利润因子基于产业链利润的估值回归特性构建：基于各品种日频或周频利润数据，做
多当前利润较历史偏低的品种，做空当前利润较历史偏高的品种，日均换手率约为
20.9%。
泰
9.2. 核心绩效速览区间2019/01-2026/06
理
11.25%
8.66%
1.30
-11.07%
63.3%
1.02
年化收益
年化波动
夏普比率
最大回撤
月度胜率
卡玛比率
利润因子指数净值走势(2019/01-2026/06)
2.3
2.2
2.1
安期
2.0
1.9
1.8
理
1.7
1.6
1.5
泰
1.4
1.3
1.2
1.1
最大回撤-11.07%
1.0
0.9
0%
-2%
-4%
-6%
-8%
-10%
-12%
5.0
4.0
国
滚动252日夏普
3.0
2.0
1.0
0.0
-1.0
-2.0
2020
2021
2022
2023
2024
2025
2026
资料来源：WIND万得数据库，国泰君安期货研究
国泰
利润因子—37一
```

### Cleaned quotes (human-readable)

1. **长期截面 (GTJAQH022, 截面)**: 复权价格对时间回归，**因子值 = 回归系数 × 强度**；按因子值排序，做多最大、做空最小，多空市值相等；日均换手约 7.7%。
2. **长期规则动量 (GTJAQH019, 时序)**: 长/短均线；做多短均线在长均线之上，做空短在长之下；日均换手约 15.5%。
3. **中期动量 (GTJAQH018, 时序)**: 过去一段时间累计涨跌幅为因子值；做多中期走强、做空走弱。
4. **量价相关性 (GTJAQH020, 截面)**: 成交量与价格相关系数；**做多相关小、做空相关大**，多空市值相等；日均换手约 12%。
5. **基差 (GTJAQH021, 时序)**: 期现基差率；**做多贴水、做空升水，按因子值加权**；日均换手约 6.2%。*(WP classifies as 时序 = net exposure OK, weight by magnitude — differs from pure CS L/S.)*
6. **基差动量 (GTJAQH023, 截面)**: 主次合约基差率在过去一段时间的**变化**；做多向贴水方向移动、做空向升水移动。
7. **库存 (GTJAQH017, 截面)**: **库存变化率**；做多因子值小（去库）、做空因子值大（累库），多空市值相等；因数据更新频率低，**周度换仓**；日均换手约 7.9%。
8. **利润 (GTJAQH009, 时序)**: 产业链利润估值回归；做多当前利润较历史偏低、做空偏高；日均换手约 20.9%。

## 5. Brochure CTA3 (p14) method blurbs

```
\n     CTA因子组合3号：因子选取与策略架构
九大因子构成
基本面类因子（4个）
基差 GTJAQH021.WI
做多贴水品种，做空升水品种
库存 GTJAQH017.WI
做多去库品种，做空累库品种
利润 GTJAQH009.WI
做多利润偏低品种，做空利润
偏高品种
基差动量 GTJAQH023.WI
基于主次合约收益率差的动量
变化
量价类因子（4个）
中期动量 GTJAQH018.WI
计算月度累计收益
长期规则 GTJAQH019.WI
基于均线交叉信号
长期截面 GTJAQH022.WI
价格对时间回归
量价相关性 GTJAQH020.WI
成交量与价格相关系数
另类因子（1个）
利用交易所每日公布的会员持仓数据构建另类因子
策略选取特征：因子逻辑分散、相关性低：不同逻辑的四个基本面因子 + 四个量价因子 + 一个另类因子（
均衡配置）
组合策略架构
60%
等权组合
Smart Beta
+
40%
轮动策略
Alpha
通过等权组合获取稳定的Beta收益，通过轮动策略捕捉量化择时Alpha机会，实
现风险与收益的平衡。
产品主要Alpha来源
我司CTA因子组合产品的主要收益来源是选取的因子间的低相关性带来
的组合整体的收益表现大幅提升，而非单因子的超高收益表现。因子间
的低相关性由因子底层逻辑分散支持。
【风险提示】以上内容仅供参考，不代表产品必然投资方向，不构成投资建议，亦不代表投资者可能获得的实际收益，请以产品合同约定为准。市场有风险，投资需谨慎。
\n\n
```

Key blurbs: 基差=做多贴水做空升水；库存=做多去库做空累库；利润=做多利润偏低做空偏高；基差动量=主次合约收益率差的动量变化；中期动量=月度累计收益；长期规则=均线交叉；长期截面=价格对时间回归；量价=成交量与价格相关系数。

## 6. Product comparison xlsx — factor composition

Sheet `因子构成对比` (tab-separated):

```
成分因子构成对比（✓=采用；3号选用“核心商品”系列因子代码）								
类别	因子名称	Wind代码（组合/指数版）	因子逻辑	构建方式	中波等权	2号高波复合	CTA因子组合3号	GTJAQHCTA1
基本面	基差	GTJAQH021.WI	基于各品种期货与现货数据计算基差率，做多贴水品种、做空升水品种	时序	✓	✓	✓	✓
基本面	库存	GTJAQH017.WI	基于各品种库存数据计算库存变化率，做多去库存品种、做空累库存品种	截面	✓	✓	✓	✓
基本面	利润	GTJAQH009.WI	基于各品种利润数据，做多利润较历史偏低的品种、做空偏高的品种	时序	✓	✓	✓	✓
基本面	基差动量	GTJAQH023.WI	基于主次合约收益率差的动量变化	时序	—	—	✓	—
量价	长期规则动量	GTJAQH019.WI	短期均线高于长期均线时做多，短期均线低于长期均线时做空	时序	✓	✓	✓	✓
量价	长期截面动量	GTJAQH022.WI	对各品种复权价格时序做回归	截面	✓	✓	✓	✓
量价	量价相关性	GTJAQH020.WI	做多量价相关性偏低的品种、做空量价相关性偏高的品种	截面	✓	✓	✓	✓
量价	中期动量	GTJAQH018.WI	计算月度累计收益	截面	—	—	✓	—
另类	另类因子	—（无Wind代码）	利用交易所每日公布的会员持仓数据构建	/	—	—	✓	—
								
说明：①中波等权/2号/GTJAQHCTA1均采用六因子框架——三个不同逻辑的基本面因子+三个量价因子，三个时序+三个截面（均衡），因子逻辑分散、相关性低（基本面与量价因子收益相关性仅0.209，截面与时序仅0.267）；②CTA因子组合3号扩展为九因子（4基本面+4量价+1另类），选用GTJAQH015-023“核心商品”系列代码；③单因子跟踪误差低于万5（资料来源：Wind，米筐，国泰君安期货研究）。								
								
```

## 7. PNG `期货因子.png` notes (OCR)

Taxonomy + peer formulas (not Guojun):
- TS mom windows **5/22/66**; CS mom rank period R, hold H; example top/bottom **20%**, equal long/short notional, rebal every H days.
- Roll yield: `Rt = [ln P(T,N) - ln P(T,D)] * 365 / [N(T,N) - N(T,D)]` (near vs deferred).
- Basis-momentum preferred over static roll yield in the slide narrative.

OCR excerpt:
```
Cta第略分类\n期指喜利\n趋势交易\nBeta\n趋势维策略\n趋势频路的收益来源\nAlpha\n涨跌幅预测\n方向预测\n*扣除手续费和滑点后期望收益为正数\n动量\n期限结构\n量价\n“海外寒用商品期货因子\n持仓相关\n价值\n基本面\nBeta\n动\n趋势\n基差\n短时间序列动量\n长时间序列动量\n培湖基普动址\n基基动量\n短期截置动量\n松深动量\n火富牛期货风格因子分类\n量价\n期酸结构\n设动\n均价突碳因子\n近月合约收益\n展期收益率\n波动因子\n短期波动因子\n偏息因子\n价值\n价值囚子\n逻辑：价格变动趋务会在未来延续\n前期雅了，未来还要涨\n前期跌了，未来还要跌\n做多前R日上涨的品种，做空前R日下碳的品种\n时间序列动量\n5/22/66交易日周期，动温因子越大=>该旭合在5/22/66交易日内素计收益越大\n动量因子\nShort_Ts_Mom = N5(1+Return)\n同一个时间点上，做多能幅较高的品种，做空涨幅较低的品种\n截面音量是时序动量在截置上的牌序，动量结大，Rank的高，在般置上的非序的高\n截置动量\n排序期(R)，这段时间的涨跌幅：持有期(H)，需仓周期\n④每个1个交层日(H）调整一次；\n①取5/22交易日作大排序期，5(周)为短期，22(月)为长期，调仓系期为1个交易日;\n③多头端和空头编的币值保持一致：\n②以5个交易日为排序期，累计涨崛排名的20%的为多头组合，后20%为空头组合；\n不同月份合约的价格 = 商品价格的期限结构\n近期>运期，期限结构向下馈料，期货贴水\n运期>近期，期限结构向上频斜，期窗升水\n基本逻辑\n角色：生严食、黄易商、奢保害、按制，者前三者诉风龄转移给控机者，投物者承受风险并获德正收益\n套保看空远期价格(未来价格要下跌)=>当天期货价格翻匀低估到\n期日期货价格=>期贷贴水（现据温价）=>投机者买入期空\n套保者净多头 =>当天期货价格 倾匀于高估别期日的期货\n价格 =>新货升水 (现货折价）=>投机膏费出期资\n展期收益越疆，表示近月合约上策幅度大幅超过远月合的\n=> 随着官利者的参与，远近月合的价差回归可能越大。\n屋期收益率高 => 现货溢价水平高，期货价格低估 =>商品期贷价格期眼结构向上\n附货因子\n期限结构类因子\n晨期收益率\n组合=买入展期收益高的一扰子合约，卖出展期收益低的一游子合的\n策略实现：买入现指滋价爆度高的期合合约+卖出现指溢价罐度低的期指合约\nP(T,N)是T时刻近月合约(主力合约)的价格，P(T,D)是\nT时刻运月合约(次主力合约)的价格\nRt=[Lnp(T,N)-Inp(T,D)]*365/[N(T,N)-N(T,D)]\nN(T,N)是近月合约交割日距变T时刻的天数。\nN(T,D)是远月合约距奥T时刻的天数\n基差动量球尾=>近月合约上涨幅合大干远月合\n约 =>喜利介入后，远近月合约价着日回概率大\n基差动量 优于展期攻益率\n策略实现：做多基差动量强的合约，储空基差动量弱的合约\n(1+I), -(°N1+I),H = Wg\n基差动量\nBM:表示t时刻商品i的基差动量.\nr为较早期近月合约 TN 在 S 日的收益率.\nr为远月合约TF 在 S 日的收益率。\n连乘表示的是到动量计算周期日R的复利；\n基差动呈描述的是期限结构斜率的变化，数值越大表示两者累计收堂率差值越大\n溴度<0，概率密度函数左侧尾部长=>地大\n多数的值位于平均值右训\n慎度>0.概率密度函数右例尾部长=>绝大\n多数的值位于平均值左则\n偏度=0，相对均匀地分布平均值在左右两\n侧，但不必然是对称\n偏度，用来衡示随机变带分布的不确定性\n德座因子\n极缴天气、自然灾害=>库存微降=>价格上\n升+期货贴水=>收益分布正编\n逻辑：供需/库存冲击=>收益率出现极值\n天气好转、技术进步=>应存上升=>价格下\n跌+期货升水=>收益分布负偏\n统计每个品种过去1年的日收益率分布情况\n负前度的期望收益均值>正编度攻益期望均值\n策略实现\nR={,j=0,1,255}\nSK=Skew(R')\nSkew是偏宣的计算公式，Skew =U3/o^3\nU3是均值三阶中心矩（一阶是均值，二阶是\n方差，二阶是供度，四阶是峰度\nRct 基256个交易目，每天收甜的样本\n因子Sk直越大，正偶程度越高，根据收益率均值回归特性，未来价格下降的可能性越大\n做多偏窄小的品种+做空偏宜大的品种\n框率练大。按明均值回归的统计规律，做空正偏，做多左编\n*正偏意味着价格跑到右侧的常部，越往右边越极端，回归的\n波动率-价格的波动程度（收益的年化标准差），衡量的是济产收益率的不确定性高=>不确定，低=>确定，在均值对近\n期货市场，波动高=>未来能获得较高的收益\n短期波动| = > 该品种活获度1 => 经线交易| => 参 与度| = > 单达行情\n动因子\n曲线上\n风险溢价=到期前价格不确定性的补信（风险溢价），反应在期货合约的价格\n波动度量 =方差/阳货收益均值\nCv=[σ^3]/|R]\nCv值验大表示流动率超表，风险补信越高\n因子&策略\n三价因子\n策略文现\n样本：5日和22日\nR) =(1=61..M-1)\n对Cv进行排序，做多波动系数高的合约+做空波动系数低的合约\n流动性=变现能力\n价格尺度 = 公允市场相比的折扣\n时闻尺度=卖出耦要的时间\n期龄合约的流动性，取决于成交量主力会约=或交量最大的那个“月份的合的”\n流动性理论：流动性越差=>预期收益越高\nAmivest 流动性比率\n流动性因子\n流动性因子\nAmibud 非流动性比率\n以上向个因子用来客产战草的流动性，Amive作为期质流动性因子\n0 = 255days\n策路实汉\n每个交易日的(当日收益率/当日或交量)求和之后求均值（除以样本天数D)\n因子龄大 => 流
```

## 8. Implications vs our live REPORT_FIT (actionable deltas)

| Factor | WP / brochure | Our live (approx) | Gap / candidate |
|---|---|---|---|
| 基差 | **时序**: sign(基差率) + weight by |factor|; net exposure OK; ann-style 基差率 | CS L/S buffered + invvol, ann_pct, scale0.24, enter19/exit39, nameClip0.18, gate75×0.5, calib 012 | Try TS signed magnitude weights (full book), or abs_score weights; WP does not give lookback/topFrac. |
| 长期截面 | score = **回归系数 × 强度**; CS L/S equal | OLS logP~t; R² only as **filter** (≥0.15); score=±slope or ±z; blend+hybrid K60 LO | **Implement slope×R² (or ×|t|) as score** — not previously burned as primary score. |
| 库存 | CS on **库存变化率**; **weekly** rebalance | 5-leg blend (social/wh/socZ/Ave80) ×4.75, daily CS, calib 007 | Add weeklyFri rebal candidate; primary score already Δ% (matches). |
| 基差动量 | Δ基差率 CS | report_basis_mom live | Confirm Δ(basis rate) not near-far mom only. |
| 量价 | corr(vol,price); **long low corr** | report_pv_corr (dOi shock blend) | Direction/sign check vs WP. |
| 长期规则 | MA cross TS | report_long_rule | Align short/long MA if known. |
| 利润 | level vs history TS | profitRetBlend carryMom | Level-vs-history z may match WP better than carryMom alone. |

## 9. What is NOT in the docs

- Exact lookback windows, top fraction, MA lengths, inventory lag, profit percentile window.
- Closed-form linking GTJAQH012↔021 / 007↔017 / 013↔022.
- Wind Excel “含万得公式” = fetch formulas only, not factor algebra.

Extract generated 2026-10-29 13:43 Asia/Shanghai.

## 10. Calib tests run this turn (vs Wind dump; no live promote)

### 长期截面 `report_cs_long` vs GTJAQH013

| Candidate | 3m cr/cl/end/julMin | YTD cr/cl/end | H1 cr/end |
|---|---|---|---|
| LIVE (hybrid ols_neg_slope K60) | 0.378 / 0.893 / +5.63 / −1.17 | 0.688 / 0.898 / +12.98 | 0.749 / +5.36 |
| hybrid `ols_neg_slope_r2` | 0.383 / 0.897 / +5.14 / −1.42 | 0.691 / 0.910 / +12.86 | 0.754 / +5.98 |
| hybrid `ols_neg_slope_t` | 0.393 / 0.892 / +5.00 / −1.82 | 0.691 / 0.898 / +12.42 | 0.755 / +5.71 |
| blend `neg_slope`→`neg_slope_r2` | 0.329 / 0.876 / +6.79 / −0.65 | 0.647 / 0.911 / +14.44 | 0.713 / +5.31 |
| Wind 013 ref | end +4.49; YTD +12.5; H1 +7.63; jul~−0.64 | | |

**Verdict:** WP「回归系数×强度」as `slope×R²` / `slope×|t|` is **marginal** vs LIVE (tiny corr up, julMin slightly worse). **Not a clear win — no REPORT_FIT promote.**

### 基差 `report_basis_spot` vs GTJAQH012

| Candidate | 3m cr/end | YTD cr/end | H1 cr/end |
|---|---|---|---|
| LIVE invvol | 0.803 / +3.36 | 0.678 / +5.34 | 0.499 / +1.04 |
| abs_score (WP 按因子值加权 proxy) | 0.738 / +4.82 | 0.615 / +5.48 | 0.451 / −0.67 |
| equal | 0.757 / +4.66 | 0.659 / +5.12 | 0.513 / −0.40 |
| Wind 012 ref | end~+4.06; YTD~+6.39; H1~+1.25 | | |

**Verdict:** abs_score / equal **lose** to LIVE invvol on corr + H1 sign. Full 时序 net-exposure book not wired this turn (larger change). **No promote.**

### 库存

WP confirms CS on 库存变化率 + **周度换仓**. Live already uses Δ% legs; weekly rebal knob not wired for inventory this turn (daily CS). **No promote.**

### Code infra added (behavior-preserving for existing kinds)

- `priceTimeRegression` now also returns `tStat`
- `olsCsScore(reg, kind)` supports `*_r2` / `*_t` kinds for future grids
- Live `REPORT_FIT` knobs **unchanged**

Artifacts: `tmp_wp_formula_calib.json`, `tmp_wp_hy_retest.mts`, `docs/_wp_ocr/p*.txt`
