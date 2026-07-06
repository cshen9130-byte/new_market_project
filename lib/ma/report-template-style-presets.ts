import type { CSSProperties } from "react"
import type { ElementStyle } from "@/lib/ma/report-template-types"

export type StylePreset = {
  id: string
  label: string
  description?: string
  style: ElementStyle
}

export const ELEMENT_STYLE_PRESETS: StylePreset[] = [
  {
    id: "default",
    label: "默认",
    style: {
      backgroundColor: "#ffffff",
      backgroundOpacity: 100,
      textColor: "#18181b",
      borderWidth: 0,
      borderRadius: 4,
      shadowEnabled: false,
      padding: 8,
      opacity: 100,
    },
  },
  {
    id: "card-soft",
    label: "柔和卡片",
    description: "浅灰背景 + 轻阴影",
    style: {
      backgroundColor: "#fafafa",
      backgroundOpacity: 100,
      textColor: "#18181b",
      borderColor: "#e4e4e7",
      borderWidth: 1,
      borderRadius: 8,
      borderStyle: "solid",
      shadowEnabled: true,
      shadowBlur: 12,
      shadowSpread: 0,
      shadowOpacity: 12,
      shadowColor: "#000000",
      shadowOffsetX: 0,
      shadowOffsetY: 2,
      padding: 12,
      opacity: 100,
    },
  },
  {
    id: "glass",
    label: "玻璃拟态",
    description: "半透明背景",
    style: {
      backgroundColor: "#ffffff",
      backgroundOpacity: 65,
      textColor: "#18181b",
      borderColor: "#ffffff",
      borderWidth: 1,
      borderRadius: 12,
      borderStyle: "solid",
      shadowEnabled: true,
      shadowBlur: 20,
      shadowOpacity: 8,
      shadowColor: "#000000",
      shadowOffsetY: 4,
      padding: 12,
      opacity: 100,
    },
  },
  {
    id: "highlight-red",
    label: "品牌高亮",
    description: "红色主题强调",
    style: {
      backgroundColor: "#fef2f2",
      backgroundOpacity: 100,
      textColor: "#991b1b",
      borderColor: "#fecaca",
      borderWidth: 1,
      borderRadius: 6,
      borderStyle: "solid",
      shadowEnabled: true,
      shadowBlur: 8,
      shadowOpacity: 10,
      shadowColor: "#ef4444",
      shadowOffsetY: 2,
      padding: 10,
      opacity: 100,
      fontWeight: "bold",
    },
  },
  {
    id: "dark-panel",
    label: "深色面板",
    style: {
      backgroundColor: "#18181b",
      backgroundOpacity: 95,
      textColor: "#fafafa",
      borderWidth: 0,
      borderRadius: 8,
      shadowEnabled: true,
      shadowBlur: 16,
      shadowOpacity: 25,
      shadowColor: "#000000",
      shadowOffsetY: 4,
      padding: 12,
      opacity: 100,
    },
  },
  {
    id: "minimal-border",
    label: "极简边框",
    style: {
      backgroundColor: "transparent",
      backgroundOpacity: 0,
      textColor: "#18181b",
      borderColor: "#d4d4d8",
      borderWidth: 1,
      borderRadius: 0,
      borderStyle: "solid",
      shadowEnabled: false,
      padding: 8,
      opacity: 100,
    },
  },
]

export const PAGE_STYLE_PRESETS: StylePreset[] = [
  {
    id: "page-white",
    label: "纯白",
    style: { backgroundColor: "#ffffff", backgroundOpacity: 100 },
  },
  {
    id: "page-warm",
    label: "暖白",
    style: { backgroundColor: "#fafaf9", backgroundOpacity: 100 },
  },
  {
    id: "page-grid",
    label: "浅灰网格底",
    style: { backgroundColor: "#f4f4f5", backgroundOpacity: 100 },
  },
]

export const CANVAS_SIZE_PRESETS = [
  { id: "16:9", label: "16:9 宽屏", width: 1280, height: 720 },
  { id: "a4", label: "A4 竖版", width: 794, height: 1123 },
  { id: "a4-landscape", label: "A4 横版", width: 1123, height: 794 },
  { id: "one-pager-tall", label: "一页通(长)", width: 900, height: 1600 },
  { id: "one-pager-extra", label: "一页通(超长)", width: 900, height: 2400 },
  { id: "ppt-standard", label: "PPT 标准", width: 960, height: 540 },
  { id: "custom", label: "自定义", width: 1280, height: 720 },
] as const

export function styleToCss(style?: ElementStyle): CSSProperties {
  if (!style) return {}
  const bgOpacity = (style.backgroundOpacity ?? 100) / 100
  const overallOpacity = (style.opacity ?? 100) / 100
  const bg = style.backgroundColor ?? "transparent"
  const rgbaBg = bg.startsWith("#") && bg.length === 7
    ? `rgba(${parseInt(bg.slice(1, 3), 16)}, ${parseInt(bg.slice(3, 5), 16)}, ${parseInt(bg.slice(5, 7), 16)}, ${bgOpacity})`
    : bg

  const shadow = style.shadowEnabled
    ? `${style.shadowOffsetX ?? 0}px ${style.shadowOffsetY ?? 2}px ${style.shadowBlur ?? 8}px ${style.shadowSpread ?? 0}px rgba(0,0,0,${(style.shadowOpacity ?? 15) / 100})`
    : undefined

  return {
    backgroundColor: rgbaBg,
    color: style.textColor,
    borderColor: style.borderColor,
    borderWidth: style.borderWidth ? `${style.borderWidth}px` : undefined,
    borderStyle: style.borderStyle ?? (style.borderWidth ? "solid" : undefined),
    borderRadius: style.borderRadius ? `${style.borderRadius}px` : undefined,
    boxShadow: shadow,
    padding: style.padding ? `${style.padding}px` : undefined,
    opacity: overallOpacity,
    fontWeight: style.fontWeight,
    fontFamily: style.fontFamily,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing ? `${style.letterSpacing}px` : undefined,
  }
}
