import { NextResponse } from "next/server"
import {
  createShareClassProduct,
  type ShareClassLetter,
  SHARE_CLASS_OPTIONS,
} from "@/lib/server/share-class-product"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function parseShareClass(raw: unknown): ShareClassLetter | null {
  if (typeof raw !== "string") return null
  const upper = raw.trim().toUpperCase()
  return SHARE_CLASS_OPTIONS.includes(upper as ShareClassLetter)
    ? (upper as ShareClassLetter)
    : null
}

export async function POST(req: Request) {
  try {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "bad_request" }, { status: 400 })
    }

    const { main_beian_hao, share_class: rawShareClass } = body as Record<string, unknown>
    const mainBeianHao = typeof main_beian_hao === "string" ? main_beian_hao.trim() : ""
    const shareClass = parseShareClass(rawShareClass)

    if (!mainBeianHao || !shareClass) {
      return NextResponse.json({ error: "missing_fields" }, { status: 400 })
    }

    const result = await createShareClassProduct({
      main_beian_hao: mainBeianHao,
      share_class: shareClass,
    })

    if ("error" in result) {
      const status =
        result.error === "main_not_found" ? 404
        : result.error === "share_class_exists" || result.error === "beian_exists" ? 409
        : 400
      return NextResponse.json({ error: result.error }, { status })
    }

    return NextResponse.json({
      ok: true,
      beian_hao: result.beian_hao,
      product_name: result.product_name,
    })
  } catch (err) {
    console.error("[share-class/create]", err)
    return NextResponse.json({ error: "Failed to create share class product" }, { status: 500 })
  }
}
