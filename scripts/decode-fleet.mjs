// Fleet art ships in the repo as base64 text (fleet-art-b64/*.b64) because
// the GitHub write path used for this repo is UTF-8-only and cannot carry
// PNG binaries. This script materialises the real PNGs into public/fleet/
// before Vite builds, so the deployed app serves /fleet/<id>.png normally.
// Run automatically by `npm run build` and `npm run dev`. Idempotent.
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'fleet-art-b64')
const outDir = join(root, 'public', 'fleet')
if (existsSync(srcDir)) {
  mkdirSync(outDir, { recursive: true })
  for (const name of readdirSync(srcDir)) {
    if (!name.endsWith('.b64')) continue
    const b64 = readFileSync(join(srcDir, name), 'utf8').replace(/\s+/g, '')
    writeFileSync(join(outDir, name.replace(/\.b64$/, '.png')), Buffer.from(b64, 'base64'))
  }
}
