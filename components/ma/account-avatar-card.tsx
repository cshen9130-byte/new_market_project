"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { authService, type User } from "@/lib/auth"
import { UserAvatar } from "@/components/ma/user-avatar"

const EXPORT_SIZE = 512
const MAX_SOURCE_BYTES = 12 * 1024 * 1024

type Draft = {
  img: HTMLImageElement
  width: number
  height: number
}

type Offset = { x: number; y: number }

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function coverRect(imgW: number, imgH: number, size: number, zoom: number, offsetX: number, offsetY: number) {
  const scale = Math.max(size / imgW, size / imgH) * zoom
  const dw = imgW * scale
  const dh = imgH * scale
  const maxX = Math.max(0, (dw - size) / 2)
  const maxY = Math.max(0, (dh - size) / 2)
  const x = clamp(offsetX, -maxX, maxX)
  const y = clamp(offsetY, -maxY, maxY)
  return { dx: (size - dw) / 2 + x, dy: (size - dh) / 2 + y, dw, dh, x, y }
}

export function AccountAvatarCard({
  avatarUrl,
  onUser,
}: {
  avatarUrl: string | null
  onUser: (user: User) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 })
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !draft) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const rect = coverRect(draft.width, draft.height, EXPORT_SIZE, zoom, offset.x, offset.y)
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, EXPORT_SIZE, EXPORT_SIZE)
    ctx.drawImage(draft.img, rect.dx, rect.dy, rect.dw, rect.dh)
    if (Math.abs(rect.x - offset.x) > 0.5 || Math.abs(rect.y - offset.y) > 0.5) {
      setOffset({ x: rect.x, y: rect.y })
    }
  }, [draft, zoom, offset])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !draft) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const factor = event.deltaY < 0 ? 1.06 : 0.94
      setZoom((value) => clamp(value * factor, 1, 3))
    }
    canvas.addEventListener("wheel", onWheel, { passive: false })
    return () => canvas.removeEventListener("wheel", onWheel)
  }, [draft])

  function openPicker() {
    fileRef.current?.click()
  }

  function onFile(file: File | undefined) {
    setMsg(null)
    if (!file) return
    if (file.type && !file.type.startsWith("image/")) {
      setMsg("请选择图片文件")
      return
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setMsg("图片过大，请换一张小于 12MB 的图片")
      return
    }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      if (!img.naturalWidth || !img.naturalHeight) {
        setMsg("无法读取这张图片，请换一张 JPG、PNG 或 WEBP")
        return
      }
      setZoom(1)
      setOffset({ x: 0, y: 0 })
      setDraft({ img, width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      setMsg("无法读取这张图片，请换一张 JPG、PNG 或 WEBP")
    }
    img.src = url
  }

  function cancelDraft() {
    dragRef.current = null
    setDraft(null)
    setZoom(1)
    setOffset({ x: 0, y: 0 })
    setMsg(null)
  }

  function pointerScale() {
    const canvas = canvasRef.current
    if (!canvas) return 1
    const rect = canvas.getBoundingClientRect()
    return rect.width > 0 ? canvas.width / rect.width : 1
  }

  async function save() {
    const canvas = canvasRef.current
    if (!canvas || !draft) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const rect = coverRect(draft.width, draft.height, EXPORT_SIZE, zoom, offset.x, offset.y)
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, EXPORT_SIZE, EXPORT_SIZE)
    ctx.drawImage(draft.img, rect.dx, rect.dy, rect.dw, rect.dh)
    setSaving(true)
    setMsg(null)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9))
    if (!blob) {
      setSaving(false)
      setMsg("无法生成头像")
      return
    }
    const result = await authService.uploadAvatar(blob)
    setSaving(false)
    if (!result.success || !result.user) {
      setMsg(result.error || "上传失败")
      return
    }
    cancelDraft()
    setMsg("头像已更新")
    onUser(result.user)
  }

  async function remove() {
    setRemoving(true)
    setMsg(null)
    const result = await authService.removeAvatar()
    setRemoving(false)
    if (!result.success || !result.user) {
      setMsg(result.error || "移除失败")
      return
    }
    setMsg("头像已移除")
    onUser(result.user)
  }

  return (
    <section className="rounded-lg border p-5">
      <h2 className="text-sm font-semibold">头像</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        上传一张图片作为头像。拖动调整位置，用滑块或滚轮缩放。保存后显示在页面左上角。
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-5">
        {draft ? (
          <canvas
            ref={canvasRef}
            width={EXPORT_SIZE}
            height={EXPORT_SIZE}
            className="h-40 w-40 cursor-grab touch-none rounded-full border bg-white active:cursor-grabbing"
            aria-label="拖动调整头像位置"
            onPointerDown={(event) => {
              const canvas = canvasRef.current
              if (!canvas) return
              canvas.setPointerCapture(event.pointerId)
              dragRef.current = { id: event.pointerId, sx: event.clientX, sy: event.clientY, ox: offset.x, oy: offset.y }
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current
              if (!drag || drag.id !== event.pointerId || !draft) return
              const scale = pointerScale()
              const next = coverRect(
                draft.width,
                draft.height,
                EXPORT_SIZE,
                zoom,
                drag.ox + (event.clientX - drag.sx) * scale,
                drag.oy + (event.clientY - drag.sy) * scale,
              )
              setOffset({ x: next.x, y: next.y })
            }}
            onPointerUp={() => {
              dragRef.current = null
            }}
            onPointerCancel={() => {
              dragRef.current = null
            }}
          />
        ) : avatarUrl ? (
          <button type="button" className="rounded-full" title="选择图片" onClick={openPicker}>
            <UserAvatar avatarUrl={avatarUrl} className="size-40" />
          </button>
        ) : null}
        <div className="min-w-[12rem] flex-1 space-y-3">
          {draft && (
            <label className="block max-w-xs space-y-1">
              <span className="text-xs text-muted-foreground">缩放</span>
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={zoom}
                aria-label="缩放"
                className="h-2 w-full cursor-pointer accent-primary"
                onChange={(event) => setZoom(Number(event.target.value))}
              />
            </label>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ""
                onFile(file)
              }}
            />
            <Button type="button" variant="outline" onClick={openPicker} disabled={saving || removing}>
              选择图片
            </Button>
            {draft && (
              <>
                <Button type="button" onClick={() => void save()} disabled={saving}>
                  {saving ? "保存中…" : "保存头像"}
                </Button>
                <Button type="button" variant="ghost" onClick={cancelDraft} disabled={saving}>
                  取消
                </Button>
              </>
            )}
            {!draft && avatarUrl && (
              <Button type="button" variant="outline" onClick={() => void remove()} disabled={removing}>
                {removing ? "移除中…" : "移除头像"}
              </Button>
            )}
            {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
          </div>
        </div>
      </div>
    </section>
  )
}
