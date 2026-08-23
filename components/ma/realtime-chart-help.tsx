"use client"

import type { ReactNode } from "react"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

function Formula({ children }: { children: ReactNode }) {
  return (
    <p className="rounded bg-muted px-2 py-1.5 font-mono text-[11px] text-foreground leading-snug">
      {children}
    </p>
  )
}

export function RealtimeChartHelp({
  title,
  children,
  className,
}: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${title} 计算说明`}
          className={cn(
            "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-input text-[11px] font-medium leading-none text-muted-foreground hover:bg-muted hover:text-foreground",
            className,
          )}
        >
          ?
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="w-[22rem] max-h-[70vh] overflow-y-auto text-xs leading-relaxed"
      >
        <div className="mb-2 text-sm font-medium text-foreground">{title}</div>
        <div className="space-y-2 text-muted-foreground">{children}</div>
      </PopoverContent>
    </Popover>
  )
}

export function HelpAnnualizedBasis({ product }: { product: string }) {
  return (
    <RealtimeChartHelp title="年化基差率怎么算">
      <p>
        比较所选股指期货最新价 <strong className="text-foreground">F</strong> 与对应现货指数{" "}
        <strong className="text-foreground">S</strong>（{product}）。基差为负表示期货相对现货贴水。
      </p>
      <Formula>基差点 = F − S</Formula>
      <Formula>基差% = (F − S) / S × 100</Formula>
      <Formula>年化基差率 = (F − S) / S / T × 365 × 100</Formula>
      <p>
        <strong className="text-foreground">T</strong> 是距离中金所到期日（合约月第三个周五）的日历天数，至少为 1。
        近月 / 远月 / 当季 / 下季用对应上市合约的到期日。连续合约（如 IF0）按<strong className="text-foreground">主力</strong>到期：到期前 7 天内改用下月，避免 T=2
        时把约 1% 的贴水年化成 −100% 以上。
      </p>
      <p>
        曲线用所选周期的期货收盘与指数线按时间对齐。1 分钟图只画当日；指数分钟线通常从 09:31 开始，开盘第一分钟若还没有当日现货，会跳过，不会用昨收去对 09:30 的期货（否则年化基差会在开盘被拉歪）。日线及以上按当时剩余到期天数逐年化。
      </p>
    </RealtimeChartHelp>
  )
}

export function HelpTodayClose() {
  return (
    <RealtimeChartHelp title="今收盘价">
      <p>交易时段为最新价；收盘后为当日收盘价。来自新浪 / CTP 行情。</p>
    </RealtimeChartHelp>
  )
}

export function HelpBasisPoints() {
  return (
    <RealtimeChartHelp title="基差怎么算">
      <p>
        基差 = 期货今收盘 − 对应现货指数。负值为贴水，正值为升水。
      </p>
      <Formula>基差 = F − S</Formula>
    </RealtimeChartHelp>
  )
}

export function HelpBasisTrend() {
  return (
    <RealtimeChartHelp title="基差走势怎么看">
      <p>
        四条线是 IH / IF / IC / IM 同一连续合约腿的日度基差（点）。负值为贴水，正值为升水。
      </p>
      <Formula>基差 = 期货结算价 − 现货收盘</Formula>
      <p>
        近月 / 远月 / 当季 / 下季分别对应当月、次月、当季、下季连续合约。最新一日若结算尚未入库，用行情最新价对现货补一点。
      </p>
    </RealtimeChartHelp>
  )
}

export function HelpAnnualizedDiscount() {
  return (
    <RealtimeChartHelp title="年化升贴水率怎么算">
      <p>
        用今收盘相对现货的升贴水，按剩余日历天数年化。到期日或已过期显示 0%。
      </p>
      <Formula>年化升贴水率 = (F − S) / S / T × 365 × 100</Formula>
    </RealtimeChartHelp>
  )
}

export function HelpScaleIndexVol() {
  return (
    <RealtimeChartHelp title="滚动年化波动率怎么算">
      <p>
        用规模指数日收盘的对数收益，按所选窗口（默认 20 日）算样本标准差，再年化。
      </p>
      <Formula>波动率 = stdev(ln(Pₜ / Pₜ₋₁)) × √252 × 100</Formula>
      <p>
        「历史分位数」把当日波动率放到过去 250 个交易日里比高低，100% 表示处于窗口内最高。
      </p>
    </RealtimeChartHelp>
  )
}

export function HelpScaleIndexCrossVol() {
  return (
    <RealtimeChartHelp title="截面年化波动率怎么算">
      <p>
        把当期收益一次年化，不做滚动窗口。日频噪声更大，数值通常高于 20 日滚动波动率。
      </p>
      <Formula>波动率 = |ln(Pₜ / Pₜ₋₁)| × √N × 100</Formula>
      <p>日频 N = 252，周频 N = 52，月频 N = 12。周 / 月用该期最后一个交易日收盘。</p>
      <p>
        「历史分位数」把当日截面波动率放到过去 250 期里比高低。
      </p>
    </RealtimeChartHelp>
  )
}

export function HelpScaleIndexBeatRatio() {
  return (
    <RealtimeChartHelp title="跑赢指数占比怎么算">
      <p>
        全市场有成交的个股中，当期涨跌幅高于对应规模指数的家数占比。六条线是同一股票池相对六只指数。
      </p>
      <Formula>跑赢占比 = 个股收益大于指数收益的家数 / 有成交家数 × 100</Formula>
      <p>日频用相邻交易日收盘；周频 / 月频用该期最后一个交易日收盘。新股首日、停牌无成交的不计入。</p>
    </RealtimeChartHelp>
  )
}

export function HelpTurnoverConcentration() {
  return (
    <RealtimeChartHelp title="个股成交集中度怎么算">
      <p>
        当日全市场按成交额从高到低排序，头部 1% / 5% / 10% / 25% 家数的成交额占全市场成交额的比例。
      </p>
      <Formula>Top x% 占比 = 成交额最高的 ceil(N × x%) 只个股成交额之和 / 全市场成交额 × 100</Formula>
      <p>家数按当日有成交额的股票计。占比越高，成交越集中在少数个股。</p>
    </RealtimeChartHelp>
  )
}

export function HelpIndexIv({ product }: { product: string }) {
  return (
    <RealtimeChartHelp title="隐含波动率怎么算">
      <p>
        图上不是本系统自行倒推期权隐含波动率，而是期权论坛{" "}
        <strong className="text-foreground">QVIX</strong>
        （近月 ATM 方差互换波动率指数），单位为年化百分比。
      </p>
      <p>
        品种对应：上证50 → 50ETF QVIX（HO）；沪深300 → 300ETF QVIX（IO）；中证500 → 500ETF QVIX；中证1000 →
        1000股指 QVIX（MO）。当前图为 <strong className="text-foreground">{product}</strong>。
      </p>
      <Formula>图中数值 = 当日 QVIX 分钟收盘（已年化，%）</Formula>
      <Formula>涨跌 = 最新 QVIX − 当日序列首根</Formula>
      <p>
        优先用 optbbs 分钟 CSV。分钟源中断时改用库内 QVIX 日线，或用分钟文件里的昨收填一条参考线，标题会标明「日线」或「昨收」。
      </p>
    </RealtimeChartHelp>
  )
}
