import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const helpers = new Set(['run.mjs', 'load-ts.mjs', 'pdf-fixture.mjs'])
for (const filename of readdirSync(new URL('.', import.meta.url)).sort()) {
  if (!filename.endsWith('.mjs') || helpers.has(filename)) continue
  console.log(`\n${filename}`)
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(filename, import.meta.url))], {
    stdio: 'inherit',
    timeout: 60000
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
