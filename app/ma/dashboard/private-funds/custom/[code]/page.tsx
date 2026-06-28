import { redirect } from "next/navigation"

export default async function CustomFundDetailRedirectPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  redirect(`/ma/dashboard/private-funds/${encodeURIComponent(code)}`)
}
