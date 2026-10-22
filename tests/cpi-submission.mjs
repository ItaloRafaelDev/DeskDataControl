import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadTs } from './load-ts.mjs'
import { pdfFixture } from './pdf-fixture.mjs'
const { CpiSubmissionWorkflow } = loadTs('src/main/cpi-submission.ts')
const { CpiAttachmentStore } = loadTs('src/main/cpi-attachment-store.ts')
const identity = {
  requestId: '251870',
  researchId: '497718',
  cpf: '52998224725',
  historyId: 'local'
}
const zero = {
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
const directory = await mkdtemp(join(tmpdir(), 'cpi-submission-'))
try {
  for (const scenario of [
    'confirmed',
    'upload-interrupted',
    'save-timeout',
    'unconfirmed',
    'history-changed',
    'cpf-mismatch',
    'invalid-pdf',
    'undefined',
    'criminal',
    'paused',
    'cancelled',
    'concurrent'
  ]) {
    const calls = []
    let current = structuredClone(zero)
    if (scenario === 'undefined') current.sections = []
    if (scenario === 'criminal') {
      current.sections[0] = {
        dataset: 'lawsuits',
        present: true,
        total: 1,
        returnedItems: 1,
        data: {
          total: 1,
          items: [{ court_type: 'CRIMINAL', number: 'FICTICIO', parties: [{ doc: identity.cpf }] }]
        }
      }
    }
    const store = new CpiAttachmentStore(join(directory, scenario))
    let halted = false
    const deps = {
      resolve: async () => ({
        identity: { ...identity, cpf: scenario === 'cpf-mismatch' ? '11144477735' : identity.cpf },
        result: current
      }),
      validate: async () => {
        calls.push('identity')
      },
      generate: async () => (scenario === 'invalid-pdf' ? Buffer.from('invalid') : pdfFixture()),
      review: async () => {
        calls.push('review')
      },
      prepareForm: async () => {
        calls.push('prepare-form')
      },
      checkForm: async () => {
        calls.push('check-form')
      },
      select: async () => {
        calls.push('select')
        if (scenario === 'upload-interrupted') throw Error('interrupted')
      },
      save: async () => {
        calls.push('save')
        if (scenario === 'save-timeout') throw Error('timeout')
      },
      verify: async () => {
        calls.push('verify')
        if (scenario === 'unconfirmed') throw Error('no document')
      },
      record: async () => {
        calls.push('record')
      },
      checkpoint: () => {
        if (halted) throw Error('paused/cancelled')
      },
      stage: async (state) => {
        calls.push(state)
      },
      store
    }
    let workflow = new CpiSubmissionWorkflow(deps)
    if (['cpf-mismatch', 'invalid-pdf', 'undefined'].includes(scenario)) {
      await assert.rejects(() => workflow.prepare())
      assert.equal(calls.includes('select'), false)
      continue
    }
    const review = await workflow.prepare()
    assert.equal(
      review.classification,
      scenario === 'criminal' ? 'CONSTA_RESTRICAO' : 'HA_INFORMACOES'
    )
    assert.equal(calls.includes('select'), false, 'review must not upload')
    if (scenario === 'history-changed') current = { ...current, queryCode: 'changed' }
    if (['paused', 'cancelled'].includes(scenario)) halted = true
    if (['paused', 'cancelled', 'history-changed'].includes(scenario)) {
      await assert.rejects(() => workflow.confirm(review.reviewId))
      assert.equal(calls.includes('select'), false)
      continue
    }
    if (['upload-interrupted', 'save-timeout', 'unconfirmed'].includes(scenario)) {
      await assert.rejects(() => workflow.confirm(review.reviewId), /incerta/)
      assert.equal((await store.read(identity)).state, 'CONFIRMACAO_INCERTA')
      assert.equal(calls.includes('record'), false)
    } else {
      if (scenario === 'concurrent') {
        const outcomes = await Promise.allSettled([
          workflow.confirm(review.reviewId),
          workflow.confirm(review.reviewId)
        ])
        assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1)
      } else await workflow.confirm(review.reviewId)
      assert.equal((await store.read(identity)).state, 'RESPOSTA_CONFIRMADA')
      assert.ok(calls.indexOf('verify') < calls.indexOf('record'))
      assert.equal(calls.filter((c) => c === 'save').length, 1)
    }
    const saves = calls.filter((c) => c === 'save').length
    workflow = new CpiSubmissionWorkflow(deps)
    await assert.rejects(() => workflow.prepare(), /repetição bloqueada/)
    assert.equal(calls.filter((c) => c === 'save').length, saves)
    console.log(`PASS: workflow ${scenario}; reinício sem reenvio`)
  }
} finally {
  await rm(directory, { recursive: true, force: true })
}
