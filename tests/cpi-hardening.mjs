/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadTs } from './load-ts.mjs'
import { pdfFixture } from './pdf-fixture.mjs'
const { CpiAttachmentStore } = loadTs('src/main/cpi-attachment-store.ts')
const { CpiAttachmentWorkflow } = loadTs('src/main/cpi-attachment.ts')
const identity = {
  requestId: '251870',
  researchId: '497718',
  cpf: '52998224725',
  historyId: 'history'
}
const pdf = pdfFixture()
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
const directory = await mkdtemp(join(tmpdir(), 'cpi-hardening-'))
try {
  const store = new CpiAttachmentStore(directory)
  let uploads = 0
  let present = false
  const diagnostics = []
  const deps = {
    resolve: async () => ({ identity, result }),
    inspect: async () => ({ ...identity, requestStatus: 'Aguardando', blockedReason: null }),
    generate: async () => pdf,
    review: async () => {},
    confirm: async () => true,
    hasDocument: async () => present,
    upload: async () => {
      uploads++
      throw new Error('token=SECRET 52998224725')
    },
    store,
    diagnose: (event) => diagnostics.push(event)
  }
  // A missing journal or retry after restart must never permit a second effect.
  let workflow = new CpiAttachmentWorkflow(deps)
  let review = await workflow.prepare()
  assert.equal((await store.read(identity)).state, 'PREPARADO')
  assert.equal((await workflow.attach(review.reviewId)).state, 'uncertain')
  assert.equal((await store.read(identity)).state, 'CONFIRMACAO_INCERTA')
  assert.equal(uploads, 1)
  workflow = new CpiAttachmentWorkflow(deps)
  review = await workflow.prepare()
  assert.equal((await workflow.attach(review.reviewId)).state, 'uncertain')
  assert.equal(uploads, 1)
  console.log('PASS: interrupção persiste CONFIRMACAO_INCERTA e reinício não repete upload')

  // Neither a name match nor an untyped/unknown response authorizes retry.
  await assert.rejects(() => workflow.reconcile(review.reviewId), /reconcilia/i)
  assert.equal((await store.read(identity)).state, 'CONFIRMACAO_INCERTA')
  deps.reconcileDocument = async () => ({ ...identity, sha256: review.sha256, status: 'unknown' })
  await assert.rejects(() => workflow.reconcile(review.reviewId), /reconcilia/i)
  deps.reconcileDocument = async () => ({
    ...identity,
    cpf: '11144477735',
    sha256: review.sha256,
    status: 'absent'
  })
  await assert.rejects(() => workflow.reconcile(review.reviewId), /CPF/)
  deps.reconcileDocument = async () => ({ ...identity, sha256: '0'.repeat(64), status: 'absent' })
  await assert.rejects(() => workflow.reconcile(review.reviewId), /PDF/)
  deps.reconcileDocument = async () => ({
    ...identity,
    sha256: review.sha256,
    status: 'absent',
    settled: true
  })
  assert.equal(await workflow.reconcile(review.reviewId), 'RECONCILIADO_AUSENTE')
  // Require another explicit review/confirmation after reconciliation.
  deps.upload = async () => {
    uploads++
    present = true
  }
  review = await workflow.prepare()
  assert.equal((await workflow.attach(review.reviewId)).state, 'attached')
  assert.equal((await store.read(identity)).state, 'DOCUMENTO_CONFIRMADO')
  assert.equal(uploads, 2)
  console.log(
    'PASS: reconciliação exige identidade, hash e evidência explícita antes de nova tentativa'
  )

  workflow = new CpiAttachmentWorkflow(deps)
  review = await workflow.prepare()
  assert.equal((await workflow.attach(review.reviewId)).state, 'already_present')
  assert.equal(uploads, 2)
  console.log('PASS: arquivo já associado permanece sem duplicação após reinício')

  const other = { ...identity, requestId: '251871' }
  const prepared = { ...review, ...other }
  await store.prepare(prepared, 'a'.repeat(64), 'HA_INFORMACOES')
  await store.review(other)
  const race = await Promise.allSettled([
    store.reserve(other),
    new CpiAttachmentStore(directory).reserve(other)
  ])
  assert.equal(race.filter((entry) => entry.status === 'fulfilled').length, 1)
  assert.equal((await new CpiAttachmentStore(directory).read(other)).state, 'CONFIRMACAO_INCERTA')
  console.log('PASS: reserva concorrente única e retomada conservadora de operação em andamento')

  const undefinedResult = new CpiAttachmentWorkflow({
    ...deps,
    resolve: async () => ({ identity, result: { cpf: identity.cpf, sections: [] } })
  })
  const undefinedReview = await undefinedResult.prepare()
  assert.equal((await undefinedResult.attach(undefinedReview.reviewId)).state, 'blocked')
  assert.equal(uploads, 2)
  console.log('PASS: resposta indefinida não pode ser anexada ou convertida em Há Informações')

  const unreviewed = new CpiAttachmentWorkflow({
    ...deps,
    hasDocument: async () => false,
    inspect: async () => ({
      ...identity,
      requestId: '251872',
      requestStatus: 'Aguardando',
      blockedReason: null
    }),
    resolve: async () => ({ identity: { ...identity, requestId: '251872' }, result }),
    confirm: async () => undefined
  })
  assert.equal((await unreviewed.attach((await unreviewed.prepare()).reviewId)).state, 'cancelled')
  assert.equal(uploads, 2)
  console.log('PASS: confirmação indefinida nunca autoriza anexação')

  // Use a new identity: a previously confirmed record must stay blocked locally.
  const newIdentity = { ...identity, requestId: '251873' }
  const unknownDeps = {
    ...deps,
    resolve: async () => ({ identity: newIdentity, result }),
    inspect: async () => ({ ...newIdentity, requestStatus: 'Aguardando', blockedReason: null }),
    hasDocument: async () => undefined
  }
  const unknownWorkflow = new CpiAttachmentWorkflow(unknownDeps)
  await assert.rejects(
    async () => unknownWorkflow.attach((await unknownWorkflow.prepare()).reviewId),
    /indefinido/
  )
  assert.equal(uploads, 2)
  console.log('PASS: estado documental indefinido bloqueia antes do efeito externo')

  const changedIdentity = { ...identity, requestId: '251874' }
  const changedDeps = {
    ...deps,
    resolve: async () => ({ identity: changedIdentity, result }),
    inspect: async () => ({ ...changedIdentity, requestStatus: 'Aguardando', blockedReason: null }),
    hasDocument: async () => false
  }
  const changedWorkflow = new CpiAttachmentWorkflow(changedDeps)
  const changedReview = await changedWorkflow.prepare()
  changedDeps.confirm = async () => {
    changedIdentity.researchId = '999'
    return true
  }
  await assert.rejects(() => changedWorkflow.attach(changedReview.reviewId), /divergente/)
  assert.equal(uploads, 2)
  console.log('PASS: formulário trocado após revisão bloqueia antes da reserva')

  const unconfirmedIdentity = { ...identity, requestId: '251875' }
  const unconfirmedDeps = {
    ...deps,
    resolve: async () => ({ identity: unconfirmedIdentity, result }),
    inspect: async () => ({
      ...unconfirmedIdentity,
      requestStatus: 'Aguardando',
      blockedReason: null
    }),
    hasDocument: async () => false,
    upload: async () => {
      uploads++
    }
  }
  const unconfirmed = new CpiAttachmentWorkflow(unconfirmedDeps)
  const unconfirmedReview = await unconfirmed.prepare()
  assert.equal((await unconfirmed.attach(unconfirmedReview.reviewId)).state, 'uncertain')
  assert.equal((await store.read(unconfirmedIdentity)).state, 'CONFIRMACAO_INCERTA')
  // Chromium may regenerate different metadata/bytes after restart. Reconcile
  // against the original durable hash, never a replacement PDF's hash.
  unconfirmedDeps.generate = async () => Buffer.concat([pdf, Buffer.from('\n')])
  const restarted = new CpiAttachmentWorkflow(unconfirmedDeps)
  const restartedReview = await restarted.prepare()
  assert.notEqual(restartedReview.sha256, unconfirmedReview.sha256)
  assert.equal((await restarted.attach(restartedReview.reviewId)).state, 'uncertain')
  assert.equal(uploads, 3)
  unconfirmedDeps.reconcileDocument = async () => ({
    ...unconfirmedIdentity,
    sha256: unconfirmedReview.sha256,
    status: 'present',
    settled: true
  })
  assert.equal(await restarted.reconcile(restartedReview.reviewId), 'DOCUMENTO_CONFIRMADO')
  console.log(
    'PASS: seleção/clique sem evidência de gravação fica incerto; reconciliação de presença encerra sem reenvio'
  )

  // Safe pre-effect states can be resumed, but operator confirmation is renewed.
  const preEffectIdentity = { ...identity, requestId: '251876' }
  const preEffectDeps = {
    ...deps,
    resolve: async () => ({ identity: preEffectIdentity, result }),
    inspect: async () => ({
      ...preEffectIdentity,
      requestStatus: 'Aguardando',
      blockedReason: null
    }),
    hasDocument: async () => false,
    confirm: async () => false
  }
  await new CpiAttachmentWorkflow(preEffectDeps).prepare()
  const resumed = new CpiAttachmentWorkflow(preEffectDeps)
  assert.equal((await resumed.attach((await resumed.prepare()).reviewId)).state, 'cancelled')
  assert.equal((await store.read(preEffectIdentity)).state, 'PREPARADO')
  assert.equal(uploads, 3)
  console.log('PASS: reinício antes do efeito retoma preparação e exige nova revisão humana')

  assert.ok(diagnostics.length > 0)
  for (const event of diagnostics) {
    assert.ok(Number.isFinite(event.durationMs) && event.durationMs >= 0)
    assert.ok(event.stage && event.status && event.recovery)
  }
  const persisted = []
  async function readTree(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory()) await readTree(join(path, entry.name))
      else persisted.push(await readFile(join(path, entry.name), 'utf8'))
    }
  }
  await readTree(directory)
  assert.doesNotMatch(
    JSON.stringify(diagnostics) + persisted.join(''),
    /52998224725|SECRET|token=|%PDF/
  )
  console.log('PASS: diagnóstico e persistência sem CPF, mensagem externa ou documento')

  const corruptDir = join(directory, 'corrupt')
  const corruptStore = new CpiAttachmentStore(corruptDir)
  await corruptStore.reserve(identity)
  const [legacyName] = await readdir(corruptDir)
  await writeFile(join(corruptDir, legacyName), '{')
  await assert.rejects(() => new CpiAttachmentStore(corruptDir).reserve(identity))
  console.log('PASS: registro corrompido falha fechado')
} finally {
  await rm(directory, { recursive: true, force: true })
}
