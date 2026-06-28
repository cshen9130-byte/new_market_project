import { CustomFundNavManageView } from "@/components/ma/custom-fund-nav-manage-view"

export default async function CustomFundNavManagePage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  return <CustomFundNavManageView productCode={decodeURIComponent(code)} />
}
