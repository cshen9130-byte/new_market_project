export type CfmmcAccountStatus = "active" | "paused"

/** Monitor-center login failed because the saved password was rejected or the account is locked from retries. */
export function isCfmmcWrongPasswordError(message: string | null | undefined): boolean {
  if (!message) return false
  if (message.includes("验证码")) return false
  const text = message.toLowerCase()
  if (text.includes("wrong password") || text.includes("invalid password")) return true
  if (message.includes("密码错误") || message.includes("密码不正确")) return true
  if (message.includes("次数过多") || message.includes("错误尝试超过")) return true
  if (message.includes("分钟后再试") && (message.includes("密码") || text.includes("password"))) return true
  if (text.includes("try again after") && text.includes("password")) return true
  return false
}

export function resolveCfmmcAccountStatus(
  rawStatus: string | null | undefined,
  lastError: string | null | undefined,
): CfmmcAccountStatus {
  if (rawStatus === "paused") return "paused"
  if (rawStatus === "active") return "active"
  return isCfmmcWrongPasswordError(lastError) ? "paused" : "active"
}
