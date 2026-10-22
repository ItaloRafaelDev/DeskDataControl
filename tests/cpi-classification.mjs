/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const ts = require('typescript')
function load(path, overrides = {}) {
  const mod = { exports: {} }
  new Function(
    'exports',
    'require',
    'module',
    ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS }
    }).outputText
  )(mod.exports, (id) => overrides[id] ?? require(id), mod)
  return mod.exports
}
const { prepareCpiPreview } = load('src/main/cpi-preview.ts', {
  './persons': load('src/main/persons.ts')
})
const { buildCpiFormPlan } = load('src/shared/cpi-form-plan.ts')
const cpf = '52998224725'
const civil = { number: 'test', court_type: 'Cível', parties: [{ cpf }] }
function result(items = [], changes = {}) {
  return {
    cpf,
    queryCode: null,
    sections: [
      {
        dataset: 'lawsuits',
        present: true,
        total: items.length,
        returnedItems: items.length,
        data: { total: items.length, items },
        ...changes
      }
    ]
  }
}
for (const [name, input, expected] of [
  ['zero confirmado', result(), 'HA_INFORMACOES'],
  ['civil reconciliado', result([civil]), 'HA_INFORMACOES'],
  ['criminal documental', result([{ ...civil, court_type: 'Criminal' }]), 'CONSTA_RESTRICAO'],
  ['ausente', result([], { present: false }), 'INDEFINIDO'],
  ['sem lista', result([], { data: { total: 0 } }), 'INDEFINIDO'],
  ['contagem divergente', result([], { total: 1 }), 'INDEFINIDO'],
  ['retorno divergente', result([], { returnedItems: 1 }), 'INDEFINIDO'],
  ['vínculo duvidoso', result([{ ...civil, parties: [] }]), 'INDEFINIDO'],
  [
    'criminal incompleto',
    result([{ ...civil, court_type: 'Criminal' }], { total: 2 }),
    'INDEFINIDO'
  ],
  ['erro no dataset', result([], { data: { total: 0, items: [], error: 'failed' } }), 'INDEFINIDO'],
  ['truncado', result([], { data: { total: 0, items: [], truncated: true } }), 'INDEFINIDO']
]) {
  const preview = prepareCpiPreview(input)
  assert.equal(preview.classification, expected, name)
  const plan = buildCpiFormPlan(preview)
  assert.equal(
    plan.resultSelector,
    expected === 'INDEFINIDO' ? null : expected === 'CONSTA_RESTRICAO' ? '#consta3' : '#consta2',
    name
  )
  assert.equal(plan.readyForReview, expected !== 'INDEFINIDO', name)
  console.log(`PASS: ${name}`)
}
