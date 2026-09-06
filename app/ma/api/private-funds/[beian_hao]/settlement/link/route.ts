import { NextResponse } from "next/server"

import {
  deleteProductSettlementLink,
  publicProductSettlementLink,
  saveProductSettlementLink,
} from "@/lib/server/product-settlement"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ beian_hao: string }> },
) {
  try {
    const { beian_hao } = await params
    return NextResponse.json({ link: publicProductSettlementLink(beian_hao) })
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取关联失败。"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ beian_hao: string }> },
) {
  try {
    const { beian_hao } = await params
    const body = await request.json() as {
      userId?: string
      password?: string
      enabled?: boolean
      scheduleTime?: string
    }
    const link = saveProductSettlementLink(beian_hao, body)
    return NextResponse.json({ ok: true, link })
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存关联失败。"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ beian_hao: string }> },
) {
  try {
    const { beian_hao } = await params
    const link = deleteProductSettlementLink(beian_hao)
    return NextResponse.json({ ok: true, link })
  } catch (error) {
    const message = error instanceof Error ? error.message : "取消关联失败。"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
