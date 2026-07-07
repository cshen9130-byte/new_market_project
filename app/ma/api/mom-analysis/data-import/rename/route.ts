import { NextResponse } from "next/server"

import { standardizeMomDataNames } from "@/lib/server/mom-data-standardize-names"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request): Promise<Response> {
  try {
    let filterFolders: string[] | null = null
    try {
      const body = await request.json()
      if (Array.isArray(body?.folders) && body.folders.length > 0) {
        filterFolders = body.folders as string[]
      }
    } catch {
      // no body or invalid JSON — process all
    }

    const result = standardizeMomDataNames(filterFolders)
    if (result.errors.some((e) => e.startsWith("目录不存在"))) {
      return NextResponse.json({ error: result.errors[0] }, { status: 404 })
    }

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "重命名操作失败。"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
