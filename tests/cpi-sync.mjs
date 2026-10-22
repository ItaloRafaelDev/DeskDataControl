import assert from 'node:assert/strict'
import { loadTs } from './load-ts.mjs'
const { restoreOperation } = loadTs('src/main/operational-state.ts')
const saved = {
  selected: { requestId: '123', researchId: '456' },
  queue: { rows: [] },
  identity: { cpf: 'old' },
  research: { historyId: 'local' }
}
const state = restoreOperation(saved)
assert.equal(state.selected, null)
assert.equal(state.queue, null)
assert.equal(state.identity, null)
assert.equal(state.status, 'disconnected')
assert.equal(saved.research.historyId, 'local')
console.log('PASS: estados da sessão não são restaurados como ativos')
