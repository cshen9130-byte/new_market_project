/**
 *   npx tsx --test lib/ma/workbuddy-mcp-config.test.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { buildWorkBuddyMcpConfig } from "@/lib/ma/workbuddy-mcp-config"

test("fund-only accounts get a single streamable-http server", () => {
  const parsed = JSON.parse(buildWorkBuddyMcpConfig({
    fundApiKey: "mf_fund",
    momApiKey: "mk_should_not_appear",
    momAccess: false,
  })) as { mcpServers: Record<string, { type: string; url: string; headers: { "x-api-key": string } }> }
  assert.deepEqual(Object.keys(parsed.mcpServers), ["fund-data"])
  assert.equal(parsed.mcpServers["fund-data"].type, "streamable-http")
  assert.equal(parsed.mcpServers["fund-data"].url, "https://8.154.33.143/ma/api/fund-data/mcp")
  assert.equal(parsed.mcpServers["fund-data"].headers["x-api-key"], "mf_fund")
})

test("accounts with both APIs get fund-data and mom-data in one file", () => {
  const parsed = JSON.parse(buildWorkBuddyMcpConfig({
    fundApiKey: "mf_fund",
    momApiKey: "mk_mom",
    momAccess: true,
  })) as { mcpServers: Record<string, { url: string; headers: { "x-api-key": string } }> }
  assert.deepEqual(Object.keys(parsed.mcpServers), ["fund-data", "mom-data"])
  assert.equal(parsed.mcpServers["mom-data"].url, "https://8.154.33.143/ma/api/mom-data/mcp")
  assert.equal(parsed.mcpServers["mom-data"].headers["x-api-key"], "mk_mom")
})

test("MOM access without a generated key does not invent a mom-data entry", () => {
  const parsed = JSON.parse(buildWorkBuddyMcpConfig({
    fundApiKey: "mf_fund",
    momApiKey: "  ",
    momAccess: true,
  })) as { mcpServers: Record<string, unknown> }
  assert.deepEqual(Object.keys(parsed.mcpServers), ["fund-data"])
})
