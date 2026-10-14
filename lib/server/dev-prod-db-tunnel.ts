/**
 * Windows `next dev` uses DATABASE_URL on 127.0.0.1:5433, an SSH forward to
 * the server Postgres. Open that forward once when it is not already listening.
 */

import { spawn, type ChildProcess } from "child_process"
import fs from "fs"
import net from "net"
import path from "path"

const LOCAL_PORT = 5433
const SSH_HOST = "root@8.154.33.143"

declare global {
  // eslint-disable-next-line no-var
  var _devPgTunnelChild: ChildProcess | undefined
  // eslint-disable-next-line no-var
  var _devPgTunnelPromise: Promise<void> | undefined
}

function keyPath(): string {
  return path.join(process.env.USERPROFILE || process.env.HOME || "", ".ssh", "id_ed25519_server")
}

function portOpen(port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" })
    const done = (ok: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once("connect", () => done(true))
    socket.once("timeout", () => done(false))
    socket.once("error", () => done(false))
  })
}

async function waitForPort(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await portOpen(LOCAL_PORT)) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return portOpen(LOCAL_PORT, 800)
}

async function openTunnel(): Promise<void> {
  if (await portOpen(LOCAL_PORT, 800)) return
  const key = keyPath()
  if (!fs.existsSync(key)) {
    throw new Error("本机没有 SSH 密钥，无法连接服务器 PostgreSQL")
  }
  const child = spawn(
    "ssh",
    [
      "-i", key,
      "-L", `${LOCAL_PORT}:127.0.0.1:5432`,
      "-N",
      "-o", "BatchMode=yes",
      "-o", "ExitOnForwardFailure=yes",
      "-o", "ServerAliveInterval=15",
      "-o", "ServerAliveCountMax=8",
      "-o", "StrictHostKeyChecking=accept-new",
      SSH_HOST,
    ],
    { stdio: "ignore", windowsHide: true },
  )
  global._devPgTunnelChild = child
  child.on("exit", () => {
    if (global._devPgTunnelChild === child) global._devPgTunnelChild = undefined
    global._devPgTunnelPromise = undefined
  })
  if (!(await waitForPort(15_000))) {
    child.kill()
    throw new Error("SSH 隧道没有连上服务器 PostgreSQL（127.0.0.1:5433）")
  }
}

/** No-op unless this Windows process is configured to use the server database tunnel. */
export function ensureDevPostgresTunnel(): Promise<void> {
  if (process.platform !== "win32") return Promise.resolve()
  const url = process.env.DATABASE_URL || ""
  if (!url.includes(`:${LOCAL_PORT}/`)) return Promise.resolve()
  if (!global._devPgTunnelPromise) {
    global._devPgTunnelPromise = openTunnel().catch((err) => {
      global._devPgTunnelPromise = undefined
      throw err
    })
  }
  return global._devPgTunnelPromise
}
