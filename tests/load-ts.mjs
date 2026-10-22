/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
const require = createRequire(import.meta.url)
const ts = require('typescript')
export function loadTs(path, overrides = {}, cache = new Map()) {
  const absolute = resolve(path)
  if (cache.has(absolute)) return cache.get(absolute).exports
  const mod = { exports: {} }
  cache.set(absolute, mod)
  const js = ts.transpileModule(readFileSync(absolute, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  new Function('exports', 'require', 'module', '__dirname', js)(
    mod.exports,
    (id) => {
      if (id in overrides) return overrides[id]
      return id.startsWith('.')
        ? loadTs(resolve(dirname(absolute), `${id}.ts`), overrides, cache)
        : require(id)
    },
    mod,
    dirname(absolute)
  )
  return mod.exports
}
