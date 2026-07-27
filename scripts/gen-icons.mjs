// Renders the PWA icon PNGs from the two committed SVGs.
// Run:  node scripts/gen-icons.mjs
// Not a build step and not a devDependency: the PNGs are committed, and this exists so the
// next person can regenerate them after editing the SVGs.
//
// Renderer note: the originally-suggested `npx -y -p sharp@0.34 node scripts/gen-icons.mjs`
// does NOT work on Windows (verified) — `npx -p <pkg>` installs the package into its own temp
// node_modules and never puts it on Node's module resolution path for a plain `node <script>`
// invocation: ESM `import` ignores NODE_PATH entirely, and npx does not set NODE_PATH anyway
// (confirmed empty even for CJS `require`), so `import sharp from 'sharp'` throws
// ERR_MODULE_NOT_FOUND. This is unrelated to sharp's own SVG rendering ability (gradients and
// feGaussianBlur render fine once sharp actually loads) — it's purely an npx/module-resolution
// problem, so it likely affects any OS.
//
// Fix: use @resvg/resvg-js-cli instead. It ships its own binary, so npx running it directly
// (rather than "npx -p x node script.js") resolves correctly. This script shells out to it once
// per job via npx, so the one working command is simply:
//   node scripts/gen-icons.mjs
// Verified by inspecting rendered pixels: the linear gradients and the feGaussianBlur soft
// shadow both render correctly, and the maskable variant's four corner pixels are opaque
// (non-transparent), confirming the full-bleed background actually reaches the edges.
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const jobs = [
  ['public/favicon.svg', 'public/icon-192.png', 192],
  ['public/favicon.svg', 'public/icon-512.png', 512],
  ['public/icon-maskable.svg', 'public/icon-maskable-512.png', 512],
]

for (const [src, out, size] of jobs) {
  // npx on Windows is a .cmd shim, which Node can only launch through a shell — execSync always
  // runs its command through one, so this works cross-platform without needing to special-case
  // the binary name or pass options.shell explicitly.
  execSync(
    `npx -y @resvg/resvg-js-cli --background transparent --fit-width ${size} "${src}" "${out}"`,
    { stdio: 'inherit' },
  )
  const bytes = readFileSync(out).length
  console.log(`${out} ${size}x${size} ${bytes} bytes`)
}
