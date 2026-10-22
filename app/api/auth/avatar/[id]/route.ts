import { NextResponse } from "next/server"
import { readAvatarFile } from "@/lib/server/user-avatar"
import { userHasAvatar } from "@/lib/server/users"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, { params }: RouteContext) {
  const { id } = await params
  if (!(await userHasAvatar(id))) return new NextResponse(null, { status: 404 })
  const file = await readAvatarFile(id)
  if (!file) return new NextResponse(null, { status: 404 })
  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
