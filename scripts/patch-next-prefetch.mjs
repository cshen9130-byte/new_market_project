/**
 * Patches Next.js 16 internal files that access `layoutOrPageMod.unstable_prefetch`
 * on client module proxies, which throws in Turbopack:
 *   "Cannot access unstable_prefetch.mode on the server."
 *
 * Wraps the access in a try-catch so client modules gracefully fall back to undefined.
 * Run via `postinstall` in package.json.
 */
import { readFileSync, writeFileSync, existsSync } from "fs"

const OLD = `const prefetchConfig = layoutOrPageMod ? layoutOrPageMod.unstable_prefetch : undefined;`
const NEW = `let prefetchConfig; try { prefetchConfig = layoutOrPageMod ? layoutOrPageMod.unstable_prefetch : undefined; } catch (_e) { prefetchConfig = undefined; }`

const files = [
  "node_modules/next/dist/server/app-render/create-component-tree.js",
  "node_modules/next/dist/esm/server/app-render/create-component-tree.js",
  "node_modules/next/dist/server/app-render/staged-validation.js",
  "node_modules/next/dist/esm/server/app-render/staged-validation.js",
]

let patched = 0
for (const f of files) {
  if (!existsSync(f)) continue
  const src = readFileSync(f, "utf8")
  if (!src.includes(OLD)) {
    if (src.includes(NEW)) {
      console.log(`  [skip] ${f} (already patched)`)
    } else {
      console.log(`  [skip] ${f} (pattern not found)`)
    }
    continue
  }
  writeFileSync(f, src.replaceAll(OLD, NEW), "utf8")
  console.log(`  [patch] ${f}`)
  patched++
}

console.log(`\nNext.js unstable_prefetch patch: ${patched} file(s) patched.`)
