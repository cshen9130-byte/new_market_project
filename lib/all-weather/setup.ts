export const CONTRACT_TENORS = [
  {
    id: "current",
    label: "当前合约",
    hint: "股指当月 · 国债当季 · 商品主力",
  },
  {
    id: "following",
    label: "下季合约",
    hint: "股指下季 · 国债下季 · 商品次主力",
  },
] as const

export type ContractTenor = (typeof CONTRACT_TENORS)[number]["id"]

export function isContractTenor(value: unknown): value is ContractTenor {
  return value === "current" || value === "following"
}

export function tenorHint(tenor: ContractTenor) {
  return CONTRACT_TENORS.find((item) => item.id === tenor)?.hint ?? ""
}
