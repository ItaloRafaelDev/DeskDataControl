import assert from 'node:assert/strict'
import { loadTs } from './load-ts.mjs'
const { restoreOperation } = loadTs('src/main/operational-state.ts')
assert.equal(typeof restoreOperation, 'function', 'A restauração operacional deve existir')
const saved = {
  selected: { requestId: '1' },
  research: { historyId: 'local' },
  step: 'Anexando',
  busy: true,
  connected: true,
  pdf: { reviewId: 'old' },
  attachment: { state: 'uncertain' }
}
const restored = restoreOperation(saved)
assert.equal(restored.connected, false)
assert.equal(restored.busy, false)
assert.equal(restored.pdf, null)
assert.equal(restored.research.historyId, 'local')
assert.equal(restored.selected, null)
assert.equal(restored.attachment.state, 'uncertain')
assert.match(restored.step, /retomada|revisão/i)
console.log('PASS: reinício recupera seleção sem conexão fictícia ou revisão obsoleta')
