"use client"

import { useToast } from "@/hooks/use-toast"

type InstructionTone = "warm" | "cool"

type InstructionCard = {
  title: string
  description: string
  mark: string
}

type InstructionSection = {
  title: string
  description: string
  tone: InstructionTone
  cards: InstructionCard[]
}

const SECTIONS: InstructionSection[] = [
  {
    title: "底层申赎类",
    description: "适用于有FOF产品的机构用户。仅限基金经理填写。",
    tone: "warm",
    cards: [
      { title: "认购底层基金", description: "发起认购底层基金", mark: "认" },
      { title: "申购底层基金", description: "发起申购底层基金", mark: "申" },
      { title: "赎回底层基金", description: "发起赎回底层基金", mark: "赎" },
      { title: "转换底层基金", description: "发起转换底层基金", mark: "转" },
    ],
  },
  {
    title: "直投申赎类",
    description: "适用于无FOF产品，直接投资基金产品机构。仅限基金经理填写。",
    tone: "warm",
    cards: [
      { title: "认购基金产品", description: "发起认购基金产品", mark: "认" },
      { title: "申购基金产品", description: "发起申购基金产品", mark: "申" },
      { title: "赎回基金产品", description: "发起赎回基金产品", mark: "赎" },
      { title: "转换基金产品", description: "发起转换基金产品", mark: "转" },
    ],
  },
  {
    title: "入/出池审批",
    description: "仅限基金经理填写。",
    tone: "cool",
    cards: [
      { title: "基金产品入池", description: "发起基金入池申请", mark: "入" },
      { title: "基金产品出池", description: "发起基金出池申请", mark: "出" },
      { title: "管理人入池", description: "发起管理人入池申请", mark: "入" },
      { title: "管理人出池", description: "发起管理人出池申请", mark: "出" },
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

export function InstructionsInitiateView() {
  const { toast } = useToast()

  function handleStart(card: InstructionCard) {
    toast({
      title: card.title,
      description: "指令发起表单正在建设中，敬请期待。",
    })
  }

  function handleViewProcess(sectionTitle: string) {
    toast({
      title: `${sectionTitle}流程`,
      description: "流程说明正在建设中，敬请期待。",
    })
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
    </div>
  )
}
