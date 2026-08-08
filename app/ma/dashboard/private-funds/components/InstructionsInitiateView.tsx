"use client"

import { useId, useState } from "react"
import { X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { DirectConvertForm } from "./DirectConvertForm"
import { DirectSubscribeForm } from "./DirectSubscribeForm"
import { FundPoolEntryForm } from "./FundPoolEntryForm"
import { ManagerExitPoolForm } from "./ManagerExitPoolForm"
import { ManagerPoolEntryForm } from "./ManagerPoolEntryForm"
import { UnderlyingConvertForm } from "./UnderlyingConvertForm"
import { UnderlyingSubscribeForm } from "./UnderlyingSubscribeForm"

type InstructionTone = "warm" | "cool"
type InstructionFormKey =
  | "underlying-subscribe"
  | "underlying-purchase"
  | "underlying-redeem"
  | "underlying-convert"
  | "direct-subscribe"
  | "direct-purchase"
  | "direct-convert"
  | "fund-pool-entry"
  | "fund-pool-exit"
  | "manager-pool-entry"
  | "manager-pool-exit"
  | "direct-redeem"

type InstructionCard = {
  title: string
  description: string
  mark: string
  formKey?: InstructionFormKey
}

type InstructionSection = {
  title: string
  description: string
  tone: InstructionTone
  cards: InstructionCard[]
}

type ProcessStepTone = "sky" | "amber"

type ProcessStep = {
  no: string
  label: string
  tone: ProcessStepTone
}

const UNDERLYING_OR_DIRECT_PROCESS: ProcessStep[] = [
  { no: "01", label: "基金经理发起", tone: "sky" },
  { no: "02", label: "总经理审批", tone: "amber" },
  { no: "03", label: "运维执行/确认", tone: "sky" },
  { no: "04", label: "生成交易记录", tone: "amber" },
]

const POOL_APPROVAL_PROCESS: ProcessStep[] = [
  { no: "01", label: "基金经理发起", tone: "sky" },
  { no: "02", label: "总经理审批", tone: "amber" },
  { no: "03", label: "基金入/出池", tone: "sky" },
]

const PROCESS_FLOWS: Record<string, ProcessStep[]> = {
  底层申赎类: UNDERLYING_OR_DIRECT_PROCESS,
  直投申赎类: UNDERLYING_OR_DIRECT_PROCESS,
  "入/出池审批": POOL_APPROVAL_PROCESS,
}

const STEP_TONE_STYLES: Record<
  ProcessStepTone,
  { from: string; to: string; ring: string; text: string; glow: string }
> = {
  sky: {
    from: "#d7ecff",
    to: "#8ec8f5",
    ring: "#7eb6e8",
    text: "#1d4f7a",
    glow: "rgba(99, 168, 224, 0.28)",
  },
  amber: {
    from: "#ffe7c2",
    to: "#f0b45a",
    ring: "#e0a14a",
    text: "#7a4a12",
    glow: "rgba(232, 168, 72, 0.28)",
  },
}

const SECTIONS: InstructionSection[] = [
  {
    title: "底层申赎类",
    description: "适用于有FOF产品的机构用户。仅限基金经理填写。",
    tone: "warm",
    cards: [
      { title: "认购底层基金", description: "发起认购底层基金", mark: "认", formKey: "underlying-subscribe" },
      { title: "申购底层基金", description: "发起申购底层基金", mark: "申", formKey: "underlying-purchase" },
      { title: "赎回底层基金", description: "发起赎回底层基金", mark: "赎", formKey: "underlying-redeem" },
      { title: "转换底层基金", description: "发起转换底层基金", mark: "转", formKey: "underlying-convert" },
    ],
  },
  {
    title: "直投申赎类",
    description: "适用于无FOF产品，直接投资基金产品机构。仅限基金经理填写。",
    tone: "warm",
    cards: [
      { title: "认购基金产品", description: "发起认购基金产品", mark: "认", formKey: "direct-subscribe" },
      { title: "申购基金产品", description: "发起申购基金产品", mark: "申", formKey: "direct-purchase" },
      { title: "赎回基金产品", description: "发起赎回基金产品", mark: "赎", formKey: "direct-redeem" },
      { title: "转换基金产品", description: "发起转换基金产品", mark: "转", formKey: "direct-convert" },
    ],
  },
  {
    title: "入/出池审批",
    description: "仅限基金经理填写。",
    tone: "cool",
    cards: [
      { title: "基金产品入池", description: "发起基金入池申请", mark: "入", formKey: "fund-pool-entry" },
      { title: "基金产品出池", description: "发起基金出池申请", mark: "出", formKey: "fund-pool-exit" },
      { title: "管理人入池", description: "发起管理人入池申请", mark: "入", formKey: "manager-pool-entry" },
      { title: "管理人出池", description: "发起管理人出池申请", mark: "出", formKey: "manager-pool-exit" },
    ],
  },
]

function HexMark({ mark, tone }: { mark: string; tone: InstructionTone }) {
  const stroke = tone === "warm" ? "rgba(220, 38, 38, 0.28)" : "rgba(37, 99, 235, 0.28)"
  const fill = tone === "warm" ? "rgba(220, 38, 38, 0.12)" : "rgba(37, 99, 235, 0.12)"
  return (
    <div className="relative h-16 w-16 flex-shrink-0 select-none" aria-hidden="true">
      <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full">
        <polygon
          points="32,4 56,18 56,46 32,60 8,46 8,18"
          fill="none"
          stroke={stroke}
          strokeWidth="1.5"
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center text-3xl font-semibold leading-none"
        style={{ color: fill }}
      >
        {mark}
      </span>
    </div>
  )
}

function InstructionCardButton({
  card,
  tone,
  onClick,
}: {
  card: InstructionCard
  tone: InstructionTone
  onClick: () => void
}) {
  const bg =
    tone === "warm"
      ? "bg-[#fff4eb] hover:bg-[#ffe9d9] dark:bg-orange-950/30 dark:hover:bg-orange-950/45"
      : "bg-[#eef5ff] hover:bg-[#e2eeff] dark:bg-blue-950/30 dark:hover:bg-blue-950/45"

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "group flex w-full items-center justify-between gap-3 rounded-md px-5 py-5 text-left transition-colors",
        "border border-transparent hover:border-black/5 dark:hover:border-white/10",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50",
        bg,
      ].join(" ")}
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{card.title}</div>
        <div className="mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">{card.description}</div>
      </div>
      <HexMark mark={card.mark} tone={tone} />
    </button>
  )
}

function ProcessStepMarker({ no, tone }: { no: string; tone: ProcessStepTone }) {
  const uid = useId().replace(/:/g, "")
  const style = STEP_TONE_STYLES[tone]
  const gradId = `process-pin-${uid}`

  return (
    <div
      className="relative flex h-[72px] w-[56px] items-start justify-center"
      aria-hidden="true"
      style={{ filter: `drop-shadow(0 6px 10px ${style.glow})` }}
    >
      <svg viewBox="0 0 56 72" className="h-[72px] w-[56px]">
        <defs>
          <linearGradient id={gradId} x1="18" y1="4" x2="40" y2="62" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={style.from} />
            <stop offset="100%" stopColor={style.to} />
          </linearGradient>
        </defs>
        <path
          d="M28 3C15.85 3 6 12.85 6 25c0 14.8 22 44 22 44s22-29.2 22-44C50 12.85 40.15 3 28 3z"
          fill={`url(#${gradId})`}
          stroke={style.ring}
          strokeWidth="1.25"
        />
        <ellipse cx="28" cy="24" rx="15" ry="14" fill="rgba(255,255,255,0.35)" />
      </svg>
      <span
        className="absolute top-[16px] text-[15px] font-semibold tracking-wide"
        style={{ color: style.text }}
      >
        {no}
      </span>
    </div>
  )
}

function ProcessConnector() {
  return (
    <div className="mt-7 flex w-full items-center self-start pt-0.5" aria-hidden="true">
      <div className="h-[2px] flex-1 rounded-full bg-gradient-to-r from-sky-300 via-amber-300 to-sky-300" />
      <svg viewBox="0 0 12 12" className="-ml-0.5 h-3.5 w-3.5 shrink-0 text-amber-500">
        <path d="M2 1.5 L11 6 L2 10.5 Z" fill="currentColor" />
      </svg>
    </div>
  )
}

function ProcessFlowDialog({
  open,
  onOpenChange,
  steps,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  steps: ProcessStep[]
}) {
  const gridTemplateColumns = Array.from({ length: Math.max(steps.length * 2 - 1, 1) }, (_, i) =>
    i % 2 === 0 ? "minmax(0,1fr)" : "minmax(2.5rem,4rem)",
  ).join(" ")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(860px,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden border-zinc-200 p-0 shadow-xl sm:rounded-lg [&>button]:hidden">
        <DialogHeader className="flex flex-row items-center justify-between space-y-0 border-b border-zinc-100 px-5 py-3.5 dark:border-zinc-800">
          <DialogTitle className="text-[15px] font-medium text-zinc-800 dark:text-zinc-100">
            查看流程
          </DialogTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </DialogHeader>
        <div className="bg-[linear-gradient(180deg,#f8fbff_0%,#ffffff_42%,#fffaf3_100%)] px-6 py-12 dark:bg-none sm:px-10">
          <ol
            className="mx-auto grid max-w-[720px] items-start"
            style={{ gridTemplateColumns }}
          >
            {steps.map((step, index) => (
              <li key={step.no} className="contents">
                <div className="flex flex-col items-center px-1">
                  <ProcessStepMarker no={step.no} tone={step.tone} />
                  <div className="mt-3 text-center text-[13px] font-medium leading-snug text-zinc-700 dark:text-zinc-200">
                    {step.label}
                  </div>
                </div>
                {index < steps.length - 1 ? <ProcessConnector /> : null}
              </li>
            ))}
          </ol>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function InstructionsInitiateView() {
  const { toast } = useToast()
  const [activeForm, setActiveForm] = useState<InstructionFormKey | null>(null)
  const [processSection, setProcessSection] = useState<string | null>(null)

  function handleStart(card: InstructionCard) {
    if (card.formKey) {
      setActiveForm(card.formKey)
      return
    }
    toast({
      title: card.title,
      description: "指令发起表单正在建设中，敬请期待。",
    })
  }

  function handleViewProcess(sectionTitle: string) {
    if (PROCESS_FLOWS[sectionTitle]) {
      setProcessSection(sectionTitle)
      return
    }
    toast({
      title: `${sectionTitle}流程`,
      description: "流程说明正在建设中，敬请期待。",
    })
  }

  const processSteps = processSection ? PROCESS_FLOWS[processSection] : null

  if (activeForm === "underlying-subscribe") {
    return (
      <UnderlyingSubscribeForm
        instructionType="认购"
        onBack={() => setActiveForm(null)}
      />
    )
  }

  if (activeForm === "underlying-purchase") {
    return (
      <UnderlyingSubscribeForm
        instructionType="申购"
        onBack={() => setActiveForm(null)}
      />
    )
  }

  if (activeForm === "underlying-redeem") {
    return (
      <UnderlyingSubscribeForm
        instructionType="赎回"
        onBack={() => setActiveForm(null)}
      />
    )
  }

  if (activeForm === "underlying-convert") {
    return <UnderlyingConvertForm onBack={() => setActiveForm(null)} />
  }

  if (activeForm === "direct-subscribe") {
    return (
      <DirectSubscribeForm
        instructionType="认购"
        onBack={() => setActiveForm(null)}
      />
    )
  }

  if (activeForm === "direct-purchase") {
    return (
      <DirectSubscribeForm
        instructionType="申购"
        onBack={() => setActiveForm(null)}
      />
    )
  }

  if (activeForm === "direct-redeem") {
    return (
      <DirectSubscribeForm
        instructionType="赎回"
        onBack={() => setActiveForm(null)}
      />
    )
  }

  if (activeForm === "direct-convert") {
    return <DirectConvertForm onBack={() => setActiveForm(null)} />
  }

  if (activeForm === "fund-pool-entry") {
    return <FundPoolEntryForm onBack={() => setActiveForm(null)} />
  }

  if (activeForm === "fund-pool-exit") {
    return (
      <FundPoolEntryForm
        instructionType="基金出池"
        onBack={() => setActiveForm(null)}
      />
    )
  }

  if (activeForm === "manager-pool-entry") {
    return <ManagerPoolEntryForm onBack={() => setActiveForm(null)} />
  }

  if (activeForm === "manager-pool-exit") {
    return <ManagerExitPoolForm onBack={() => setActiveForm(null)} />
  }

  return (
    <div className="flex flex-col gap-8 pb-6">
      {SECTIONS.map((section) => (
        <section key={section.title} className="min-w-0">
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <div className="flex items-center gap-2">
              <span className="h-4 w-1 rounded-sm bg-red-500" aria-hidden="true" />
              <h2 className="text-base font-semibold text-foreground">{section.title}</h2>
            </div>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              {section.description}
              <button
                type="button"
                onClick={() => handleViewProcess(section.title)}
                className="ml-1 text-blue-500 hover:text-blue-600 hover:underline focus:outline-none"
              >
                查看流程
              </button>
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {section.cards.map((card) => (
              <InstructionCardButton
                key={`${section.title}-${card.title}`}
                card={card}
                tone={section.tone}
                onClick={() => handleStart(card)}
              />
            ))}
          </div>
        </section>
      ))}

      {processSteps ? (
        <ProcessFlowDialog
          open={Boolean(processSection)}
          onOpenChange={(open) => {
            if (!open) setProcessSection(null)
          }}
          steps={processSteps}
        />
      ) : null}
    </div>
  )
}
