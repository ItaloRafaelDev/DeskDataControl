/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { loadTs } from './load-ts.mjs'
import { pdfFixture } from './pdf-fixture.mjs'
const require = createRequire(import.meta.url)
const { CpiAttachmentWorkflow, validateGeneratedPdf } = loadTs('src/main/cpi-attachment.ts')
const { CpiAttachmentStore } = loadTs('src/main/cpi-attachment-store.ts')
const pdf = pdfFixture()
const identity = {
  requestId: '251870',
  researchId: '497718',
  cpf: '52998224725',
  historyId: 'local-history'
}
const result = {
  cpf: identity.cpf,
  sections: [
    {
      dataset: 'lawsuits',
      present: true,
      total: 0,
      returnedItems: 0,
      data: { total: 0, items: [] }
    }
  ]
}
const fixtureDirectory = await mkdtemp(join(tmpdir(), 'cpi-attachment-fixtures-'))
let fixtureIndex = 0
process.on('exit', () =>
  require('node:fs').rmSync(fixtureDirectory, { recursive: true, force: true })
)
function fixture(overrides = {}) {
  const counts = { uploads: 0, confirmations: 0, completed: 0, reserved: false }
  const target = { ...identity, requestStatus: 'Aguardando', blockedReason: null }
  const store = new CpiAttachmentStore(join(fixtureDirectory, String(fixtureIndex++)))
  const reserve = store.reserve.bind(store)
  store.reserve = async (identity, sourceHash) => {
    await reserve(identity, sourceHash)
    counts.reserved = true
  }
  const complete = store.complete.bind(store)
  store.complete = async (identity) => {
    await complete(identity)
    counts.completed++
  }
  const deps = {
    resolve: async () => ({ identity: { ...identity }, result }),
    inspect: async () => target,
    generate: async () => pdf,
    review: async (bytes) => assert.equal(bytes, pdf),
    confirm: async () => {
      counts.confirmations++
      return true
    },
    hasDocument: async () => counts.uploads > 0,
    upload: async (_target, _filename, bytes) => {
      assert.equal(bytes, pdf)
      counts.uploads++
    },
    store,
    ...overrides
  }
  return { workflow: new CpiAttachmentWorkflow(deps), counts, deps, target }
}
for (const [name, changed] of [
  ['CPF divergente', { cpf: '11144477735' }],
  ['solicitação divergente', { requestId: '999' }],
  ['pesquisa divergente', { researchId: '999' }],
  ['histórico divergente', { historyId: 'other' }]
]) {
  const f = fixture({ inspect: async () => ({ ...identity, ...changed }) })
  await assert.rejects(() => f.workflow.prepare(), /divergente/)
  assert.equal(f.counts.uploads, 0)
  console.log(`PASS: ${name} bloqueado`)
}
for (const invalid of [
  Buffer.from('invalid'),
  Buffer.from(pdf.toString().replace('595.28', '612')),
  Buffer.from(pdf.toString().replace('595.28', '..')),
  Buffer.from(pdf.toString().replace(/startxref\n\d+/, 'startxref\n999999')),
  Buffer.from(pdf.toString().replace('0000000009 00000 n', '0000000008 00000 n')),
  pdf.subarray(0, -10)
])
  assert.throws(() => validateGeneratedPdf(invalid), /PDF inválido/)
await assert.rejects(
  () => fixture({ generate: async () => Buffer.from('invalid') }).workflow.prepare(),
  /PDF inválido/
)
console.log('PASS: PDF inválido, truncado e fora de A4 bloqueados')
const blocked = fixture()
blocked.target.blockedReason = 'Controle oficial de upload ausente'
const blockedReview = await blocked.workflow.prepare()
assert.equal((await blocked.workflow.attach(blockedReview.reviewId)).state, 'blocked')
assert.equal(blocked.counts.confirmations, 0)
assert.equal(blocked.counts.uploads, 0)
console.log('PASS: controle ausente bloqueia antes de confirmar e enviar')
const cancelled = fixture({ confirm: async () => false })
assert.equal(
  (await cancelled.workflow.attach((await cancelled.workflow.prepare()).reviewId)).state,
  'cancelled'
)
assert.equal(cancelled.counts.uploads, 0)
console.log('PASS: cancelamento do operador impede envio')
const success = fixture()
const review = await success.workflow.prepare()
assert.equal((await success.workflow.attach(review.reviewId)).state, 'attached')
assert.equal(success.counts.completed, 1)
assert.equal(success.counts.uploads, 1)
await assert.rejects(() => success.workflow.attach(review.reviewId), /Prepare/)
assert.equal(
  (await success.workflow.attach((await success.workflow.prepare()).reviewId)).state,
  'already_present'
)
assert.equal(success.counts.uploads, 1)
console.log(
  'PASS: confirmação, evidência posterior no portal e prevenção de duplicação (simulados)'
)
const uncertain = fixture({ hasDocument: async () => false })
assert.equal(
  (await uncertain.workflow.attach((await uncertain.workflow.prepare()).reviewId)).state,
  'uncertain'
)
assert.equal(uncertain.counts.completed, 0)
assert.equal(
  (await uncertain.workflow.attach((await uncertain.workflow.prepare()).reviewId)).state,
  'uncertain'
)
assert.equal(uncertain.counts.uploads, 1)
console.log('PASS: ausência de evidência não conclui nem permite novo envio')
const changed = fixture()
const before = await changed.workflow.prepare()
changed.deps.confirm = async () => {
  changed.target.researchId = '999'
  return true
}
await assert.rejects(() => changed.workflow.attach(before.reviewId), /divergente/)
assert.equal(changed.counts.uploads, 0)
console.log('PASS: identidade revalidada após confirmação do operador')
const directory = await mkdtemp(join(tmpdir(), 'cpi-journal-test-'))
try {
  await new CpiAttachmentStore(directory).reserve(identity)
  await assert.rejects(() => new CpiAttachmentStore(directory).reserve(identity), /duplicação/)
  await new CpiAttachmentStore(directory).complete(identity)
  await assert.rejects(() => new CpiAttachmentStore(directory).reserve(identity), /duplicação/)
  console.log('PASS: duplicação bloqueada entre instâncias, inclusive tentativa incerta')
} finally {
  await rm(directory, { recursive: true, force: true })
}
