"use client"

import { useEffect, useState } from "react"
import { HelpCircle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type RebalanceMethod = "buy-hold" | "periodic" | "specified-date"

function autoRebalanceLabel(method: RebalanceMethod) {
  if (method === "buy-hold") return "否（买入持有不支持自动再平衡）"
  if (method === "specified-date") return "否（指定日再平衡不支持自动再平衡）"
  return "是（定期再平衡）"
}

export function PortfolioSaveDialog({
  open,
  onClose,
  onConfirm,
  rebalanceMethod,
}: {
  open: boolean
  onClose: () => void
  onConfirm: (name: string) => void
  rebalanceMethod: RebalanceMethod
}) {
  const [name, setName] = useState("")

  useEffect(() => {
    if (open) setName("")
  }, [open])

  function handleConfirm() {
    const trimmed = name.trim()
    if (!trimmed) {
      window.alert("请输入组合名称")
      return
    }
    onConfirm(trimmed)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-[520px] gap-0 p-0" showCloseButton>
        <DialogHeader className="px-6 py-4 border-b text-left">
          <DialogTitle className="text-base font-semibold">保存组合</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-6 space-y-5">
          <div className="flex items-center gap-4">
            <label className="w-28 shrink-0 text-sm text-right">
              <span className="text-red-500">*</span> 组合名称:
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="请输入组合名称"
              className="flex-1 h-9 px-3 border rounded text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="flex items-center gap-4">
            <div className="w-28 shrink-0 flex items-center justify-end gap-1 text-sm">
              <span className="text-red-500">*</span>
              <span>自动再平衡</span>
              <HelpCircle
                className="h-3.5 w-3.5 text-zinc-400"
                title="买入持有与指定日再平衡不支持自动再平衡"
              />
            </div>
            <p className="flex-1 text-sm text-zinc-600">{autoRebalanceLabel(rebalanceMethod)}</p>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t sm:justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 rounded border border-border text-sm hover:bg-muted transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="px-6 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
          >
            确定
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
