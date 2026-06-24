import { NextResponse } from "next/server"
import {
  loadShareClassPreview,
  type ShareClassLetter,
  SHARE_CLASS_OPTIONS,
} from "@/lib/server/share-class-product"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function parseShareClass(raw: string | null): ShareClassLetter | null {
  if (!raw) return null
  const upper = raw.trim().toUpperCase()
  return SHARE_CLASS_OPTIONS.includes(upper as ShareClassLetter)
    ? (upper as ShareClassLetter)
    : null
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const beianHao = (searchParams.get("beian_hao") || "").trim()
  if (!beianHao) {
    return NextResponse.json({ error: "missing_beian_hao" }, { status: 400 })
  }

  try {
    const preview = await loadShareClassPreview(beianHao, parseShareClass(searchParams.get("share_class")))
    if (!preview) {
      return NextResponse.json({ error: "not_found" }, { status: 404 })
    }
    return NextResponse.json(preview)
  } catch (err) {
    console.error("[share-class/preview]", err)
    return NextResponse.json({ error: "db_error" }, { status: 500 })
  }
}
