"use client"

import { HelpCircle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import type { AttributionFactorModel } from "@/lib/style-attribution"

type ExplanationBlock = {
  title: string
  paragraphs: string[]
  bullets?: string[]
}

const CTA_FACTOR_FORMULAS: ExplanationBlock = {
  title: "商品CTA风格因子如何构造",
  paragraphs: [
    "因子日序列由南华商品指数收盘价对齐到产品净值日期后计算，作为回归自变量（非真实期货风格因子组合）。",
    "指数输入：主指数 NHCI；板块 NHAI / NHECI / NHFI / NHPMI / NHNFI。适用于期货/CTA 策略，不适合 FOF/权益产品。",
  ],
  bullets: [
    "流动性因子：−zscore(|NHCI 日收益|, 60 日窗口)；波动越大得分越低",
    "长期时间序列动量：NHCI 60 日滚动收益 close_t / close_{t-60} − 1",
    "偏度因子：NHCI 日收益 20 日滚动偏度",
    "短期时间序列动量：NHCI 20 日滚动收益",
    "短期截面动量：五个板块各自 20 日收益的均值 − NHCI 20 日收益",
    "基差动量：spread = NHECI / NHAI，取 spread 的日变动 spread_t / spread_{t-1} − 1",
    "持仓变化因子：NHCI 日收益的一阶差分 r_t − r_{t-1}",
    "短期波动因子：NHCI 日收益 20 日滚动标准差",
    "期限结构因子：NHFI 20 日收益 − NHCI 20 日收益",
    "均价突破因子：NHCI / MA60 − 1",
    "基差因子：NHECI / NHAI − 1",
  ],
}

const MULTI_ASSET_FACTOR_FORMULAS: ExplanationBlock = {
  title: "多资产大类因子如何构造",
  paragraphs: [
    "每个因子直接取对应市场指数/ETF 在相邻净值日期之间的收益，与产品日收益区间对齐后作为回归自变量。",
    "解释的是产品收益对各大类市场的敏感度（β），不是持仓拆解。",
  ],
  bullets: [
    "大盘权益：沪深300（IF）区间收益",
    "中盘权益：中证500（IC）区间收益",
    "小盘权益：中证1000（IM）区间收益",
    "蓝筹权益：上证50（IH）区间收益",
    "利率债：国债ETF（511010.SH）区间收益",
    "黄金：黄金ETF（518880.SH）区间收益",
    "商品：南华商品指数（NHCI）区间收益（仅作为商品大类暴露，不是 CTA 风格因子）",
  ],
}

function factorFormulas(model: AttributionFactorModel): ExplanationBlock {
  return model === "multi-asset" ? MULTI_ASSET_FACTOR_FORMULAS : CTA_FACTOR_FORMULAS
}

function buildExplanations(model: AttributionFactorModel) {
  const formulas = factorFormulas(model)
  const modelLabel = model === "multi-asset" ? "多资产大类" : "商品CTA风格"

  return {
    regression: {
      heading: `区间因子回归分析 · 计算说明（${modelLabel}）`,
      blocks: [
        {
          title: "产品收益",
          paragraphs: [
            "按所选净值类型（单位净值 / 累计净值 / 复权净值）取序列，计算日收益：r_t = NAV_t / NAV_{t-1} − 1。",
            "若开启「超额收益」且存在基准，则用产品日收益减去对齐后的基准日收益。",
          ],
        },
        formulas,
        {
          title: "回归模型（OLS）",
          paragraphs: [
            "对对齐后的样本做最小二乘回归：r_fund,t = α + Σ β_i · f_i,t + ε_t。",
          ],
          bullets: [
            "收益敏感度：回归系数 β_i",
            "标准误差 / t / P>|t|：由 OLS 协方差与双侧检验给出",
            "相关系数：产品收益与该因子序列的 Pearson 相关",
            "R² / 调整 R² / F 统计量：整体拟合优度与联合显著性",
          ],
        },
      ],
    },
    explained: {
      heading: `风格因子解释 · 计算说明（${modelLabel}）`,
      blocks: [
        {
          title: "图中三条收益含义",
          paragraphs: [
            "在 OLS 拟合后，对日收益做累计复利（从区间起点累积到各日）。",
          ],
          bullets: [
            "产品收益率：∏(1 + r_fund) − 1，累计到当日",
            "因子贡献收益率：∏(1 + r̂) − 1，其中 r̂ 为回归拟合值 α + Σ β_i f_i",
            "特异因子贡献收益率：产品累计收益 − 因子贡献累计收益（图例旁数值）",
          ],
        },
        formulas,
      ],
    },
    contribution: {
      heading: `区间因子收益率贡献 · 计算说明（${modelLabel}）`,
      blocks: [
        {
          title: "单日与累计贡献",
          paragraphs: [
            "每个因子的日贡献定义为 contrib_i,t = β_i · f_i,t。",
            "特质因子日贡献 = r_fund,t − Σ contrib_i,t。",
          ],
          bullets: [
            "柱状图：对各因子日贡献做简单加总后 ×100，得到区间贡献（百分点）",
            "折线图：对日贡献做累计求和后再 ×100，展示贡献路径",
            "排序：正贡献按从大到小，负贡献按从小到大",
          ],
        },
        formulas,
      ],
    },
    riskContribution: {
      heading: `区间因子风险贡献 · 计算说明（${modelLabel}）`,
      blocks: [
        {
          title: "年化波动贡献",
          paragraphs: [
            "先得到各因子日贡献序列 contrib_i,t = β_i · f_i,t，以及特质残差日序列。",
            "风险贡献 = 该序列样本标准差 × √252 × 100（年化波动率，百分点）。",
            "注意：这是各贡献序列自身的年化波动，不是协方差分解下的边际风险贡献。",
          ],
        },
        formulas,
      ],
    },
    sensitivity: {
      heading: `因子敏感度趋势 · 计算说明（${modelLabel}）`,
      blocks: [
        {
          title: "分区间重估 β",
          paragraphs: [
            "在完整归因区间上做一次全样本回归，得到「归因区间」列。",
            "再按自然年 / 自然季切分净值，对每个子区间用同样的因子构造与 OLS 重新估计 β。",
            "子区间样本不足时跳过该列。雷达图对比最近完整子区间与全样本归因区间的 β。",
          ],
        },
        formulas,
        {
          title: "表中 R方值",
          paragraphs: [
            "每一列底部的 R方值为该子区间（或全样本）OLS 的 R²。",
          ],
        },
      ],
    },
  } as const
}

export type AttributionCalcKey = keyof ReturnType<typeof buildExplanations>

/** Clickable ? that opens calculation explanations for an attribution chart section. */
export function CalcExplanationButton({
  section,
  factorModel = "commodity-cta",
  label,
  className,
}: {
  section: AttributionCalcKey
  factorModel?: AttributionFactorModel
  label?: string
  className?: string
}) {
  const content = buildExplanations(factorModel)[section]

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={[
            "inline-flex items-center text-zinc-400 hover:text-zinc-700 transition-colors",
            className ?? "",
          ].join(" ")}
          aria-label={label ?? content.heading}
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{content.heading}</DialogTitle>
          <DialogDescription className="text-xs">
            以下说明对应页面当前所选因子模型，仅供参考。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm text-zinc-700">
          {content.blocks.map((block) => (
            <section key={block.title} className="space-y-2">
              <h4 className="text-sm font-semibold text-zinc-900">{block.title}</h4>
              {block.paragraphs.map((p) => (
                <p key={p} className="text-xs leading-relaxed text-zinc-600">
                  {p}
                </p>
              ))}
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
