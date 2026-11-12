"use client"

import { useEffect, useRef, useState } from "react"

function isHeaderRed(r: number, g: number, b: number): boolean {
  return r >= 80 && r <= 210 && g <= 80 && b <= 80 && r >= g + 40 && r >= b + 40
}

function detectHeaderBand(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): { top: number; height: number } | null {
  const maxY = Math.max(8, Math.round(height * 0.22))
  const data = ctx.getImageData(0, 0, width, maxY).data
  const sampleXs = [0.02, 0.08, 0.15, 0.25].map((p) => Math.min(width - 1, Math.round(width * p)))

  const rowIsRed = (y: number) => {
    let hits = 0
    for (const x of sampleXs) {
      const i = (y * width + x) * 4
      if (isHeaderRed(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0)) hits += 1
    }
    return hits >= 2
  }

  let top = -1
  for (let y = 0; y < maxY; y += 1) {
    if (rowIsRed(y)) {
      top = y
      break
    }
  }
  if (top < 0) return null

  let bottom = top
  let gap = 0
  for (let y = top + 1; y < maxY; y += 1) {
    if (rowIsRed(y)) {
      bottom = y
      gap = 0
    } else {
      gap += 1
      if (gap > 6) break
    }
  }

  const bandH = bottom - top + 1
  if (bandH < height * 0.03) return null
  return { top, height: bandH }
}

function cssRgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`
}

export function paintReportTitleOnCanvas(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  title: string,
): boolean {
  const width = img.naturalWidth || img.width
  const height = img.naturalHeight || img.height
  if (!width || !height) return false

  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) return false

  ctx.drawImage(img, 0, 0)
  const name = title.trim()
  if (!name) return true

  const band = detectHeaderBand(ctx, width, height)
  if (!band) return false

  const coverTop = band.top + Math.round(band.height * 0.18)
  const coverBottom = band.top + Math.round(band.height * 0.68)
  const coverLeft = Math.round(width * 0.03)
  const coverRight = Math.round(width * 0.68)
  const coverH = Math.max(8, coverBottom - coverTop)
  const coverW = Math.max(8, coverRight - coverLeft)

  const sampleX = Math.min(width - 1, Math.max(0, Math.round(width * 0.04)))
  const sampleY = Math.min(height - 1, Math.max(0, coverTop + Math.round(coverH * 0.5)))
  const px = ctx.getImageData(sampleX, sampleY, 1, 1).data
  ctx.fillStyle = cssRgba(px[0] ?? 140, px[1] ?? 29, px[2] ?? 29, px[3] ?? 255)
  ctx.fillRect(coverLeft, coverTop, coverW, coverH)

  const textX = Math.round(width * 0.06)
  const textY = coverTop + coverH / 2
  const maxWidth = Math.max(20, coverRight - textX - 4)
  const fontStack = '"Microsoft YaHei","PingFang SC","Noto Sans SC","Source Han Sans SC",sans-serif'
  let fontSize = Math.max(12, Math.round(band.height * 0.30))
  ctx.fillStyle = "#ffffff"
  ctx.textAlign = "left"
  ctx.textBaseline = "middle"
  while (fontSize > 10) {
    ctx.font = `bold ${fontSize}px ${fontStack}`
    if (ctx.measureText(name).width <= maxWidth) break
    fontSize -= 1
  }
  ctx.fillText(name, textX, textY, maxWidth)
  return true
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("报告图片加载失败"))
    img.src = src
  })
}

export async function compositeReportTitleBlob(src: string, title: string): Promise<Blob> {
  const img = await loadImage(src)
  const canvas = document.createElement("canvas")
  const painted = paintReportTitleOnCanvas(canvas, img, title)
  if (!painted) {
    const resp = await fetch(src)
    if (!resp.ok) throw new Error("报告图片读取失败")
    return resp.blob()
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
  if (!blob) throw new Error("无法生成带标题的图片")
  return blob
}

export async function compositeReportTitleBlobFromBuffer(buf: ArrayBuffer, title: string): Promise<Blob> {
  const src = URL.createObjectURL(new Blob([buf], { type: "image/png" }))
  try {
    return await compositeReportTitleBlob(src, title)
  } finally {
    URL.revokeObjectURL(src)
  }
}

export async function downloadReportPngWithTitle(src: string, title: string, filename: string): Promise<void> {
  const blob = await compositeReportTitleBlob(src, title)
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function ReportPngWithTitle({
  src,
  title,
  alt,
  className,
}: {
  src: string
  title: string
  alt?: string
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [showCanvas, setShowCanvas] = useState(false)

  useEffect(() => {
    let cancelled = false
    const canvas = canvasRef.current
    if (!canvas || !src) return
    setShowCanvas(false)
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      try {
        const ok = paintReportTitleOnCanvas(canvas, img, title)
        if (!cancelled) setShowCanvas(ok)
      } catch {
        if (!cancelled) setShowCanvas(false)
      }
    }
    img.onerror = () => {
      if (!cancelled) setShowCanvas(false)
    }
    img.src = src
    return () => {
      cancelled = true
    }
  }, [src, title])

  return (
    <span className="relative block w-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt ?? title}
        className={showCanvas ? "hidden" : className}
      />
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={alt ?? title}
        className={showCanvas ? className : "hidden"}
        style={{ width: "100%", height: "auto" }}
      />
    </span>
  )
}
