/**
 * PM abbreviation for 单账户总览, keyed by 资金账号.
 * Source: 单账户对应pm缩写.docx (fund, broker, account, PM).
 * Accounts absent from that file stay blank.
 */
const PM_BY_ACCOUNT: Record<string, string> = {
  "8010101763": "黄CF",
  "807636": "胡GX",
  "8001005006": "华X",
  "80018985": "刘MC",
  "807660": "黄CF",
  "807686": "黄CF",
  "90357999": "庄JY",
  "10800677": "JC",
}

function accountKey(accountNo: string): string {
  return String(accountNo ?? "").replace(/\D/g, "").replace(/^0+/, "")
}

export function pmForAccount(accountNo: string): string {
  const key = accountKey(accountNo)
  return key ? (PM_BY_ACCOUNT[key] ?? "") : ""
}
