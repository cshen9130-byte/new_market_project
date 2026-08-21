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
        连续合约（如 IF0）按<strong className="text-foreground">主力</strong>到期：到期前 7 天内改用下月，避免 T=2
        时把约 1% 的贴水年化成 −100% 以上。
      </p>
      <p>
        曲线用所选周期的期货收盘与指数线按时间对齐。1 分钟图只画当日；指数分钟线通常从 09:31 开始，开盘第一分钟若还没有当日现货，会跳过，不会用昨收去对 09:30 的期货（否则年化基差会在开盘被拉歪）。日线及以上按当时剩余到期天数逐年化。
      </p>
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
