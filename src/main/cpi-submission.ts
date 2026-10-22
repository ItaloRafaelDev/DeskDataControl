import { createHash, randomUUID } from 'node:crypto'
import type { CpiPdfReview, PersonQueryResult, CpiSubmissionState } from '../shared/contracts'
import { buildCpiFormPlan } from '../shared/cpi-form-plan'
import { prepareCpiPreview } from './cpi-preview'
import {
  validateAttachmentIdentity,
  validateGeneratedPdf,
  type AttachmentIdentity
} from './cpi-attachment'
import type { CpiAttachmentStore } from './cpi-attachment-store'

interface Dependencies {
  resolve(): Promise<{ identity: AttachmentIdentity; result: PersonQueryResult }>
  validate(identity: AttachmentIdentity): Promise<void>
  generate(result: PersonQueryResult): Promise<Buffer>
  review(bytes: Buffer): Promise<void>
  prepareForm(review: CpiPdfReview): Promise<void>
  checkForm(review: CpiPdfReview): Promise<void>
  select(review: CpiPdfReview, bytes: Buffer): Promise<void>
  save(review: CpiPdfReview): Promise<void>
  verify(review: CpiPdfReview): Promise<void>
  record(review: CpiPdfReview): Promise<void>
  store: CpiAttachmentStore
  checkpoint(): void
  stage(state: CpiSubmissionState): Promise<void>
}
const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

// One reviewed candidate per selected request. The durable journal is the replay guard.
export class CpiSubmissionWorkflow {
  private prepared: { review: CpiPdfReview; bytes: Buffer; sourceHash: string } | null = null
  private busy = false
  constructor(private readonly deps: Dependencies) {}

  clear(): void {
    this.prepared = null
  }

  async prepare(): Promise<CpiPdfReview> {
    if (this.busy) throw new Error('Workflow CPI em andamento.')
    this.busy = true
    this.clear()
    try {
      this.deps.checkpoint()
      const { identity, result } = await this.deps.resolve()
      validateAttachmentIdentity(identity, { ...identity, cpf: result.cpf.replace(/\D/g, '') })
      const preview = prepareCpiPreview(result)
      const plan = buildCpiFormPlan(preview)
      if (!plan.readyForReview) throw new Error(plan.issues.join(' '))
      const previous = await this.deps.store.read(identity)
      if (
        previous &&
        !['PREPARADO', 'REVISAO_CONFIRMADA', 'RECONCILIADO_AUSENTE'].includes(previous.state)
      )
        throw new Error(
          'Tentativa CPI pendente ou concluída. Reconcilie o portal; repetição bloqueada.'
        )
      await this.deps.validate(identity)
      const bytes = await this.deps.generate(result)
      validateGeneratedPdf(bytes)
      const review: CpiPdfReview = {
        ...identity,
        reviewId: randomUUID(),
        classification: preview.classification,
        filename: `Relatorio_Pesquisa_${identity.requestId}_${identity.researchId}.pdf`,
        sha256: hash(bytes),
        byteLength: bytes.length,
        requestStatus: 'Em revisão',
        blockedReason: null
      }
      this.deps.checkpoint()
      await this.deps.validate(identity)
      await this.deps.prepareForm(review)
      await this.deps.review(bytes)
      this.deps.checkpoint()
      const sourceHash = hash(JSON.stringify(result))
      await this.deps.store.prepare(
        review,
        sourceHash,
        preview.classification as 'HA_INFORMACOES' | 'CONSTA_RESTRICAO'
      )
      this.prepared = { review, bytes, sourceHash }
      await this.deps.stage('reviewed')
      return review
    } finally {
      this.busy = false
    }
  }

  async confirm(reviewId: string): Promise<void> {
    if (this.busy) throw new Error('Workflow CPI em andamento.')
    this.busy = true
    let reserved = false
    const prepared = this.prepared
    try {
      if (!prepared || prepared.review.reviewId !== reviewId)
        throw new Error('Revise novamente a resposta e o PDF antes de confirmar.')
      const { review, bytes, sourceHash } = prepared
      const revalidate = async (): Promise<void> => {
        this.deps.checkpoint()
        const current = await this.deps.resolve()
        validateAttachmentIdentity(review, current.identity)
        if (hash(JSON.stringify(current.result)) !== sourceHash || hash(bytes) !== review.sha256)
          throw new Error('Resultado ou PDF alterado após revisão.')
        await this.deps.validate(review)
        await this.deps.checkForm(review)
      }
      await revalidate()
      validateGeneratedPdf(bytes)
      await this.deps.store.review(review, sourceHash)
      await this.deps.store.reserve(review, sourceHash)
      reserved = true
      this.clear()
      await this.deps.stage('selecting_file')
      await this.deps.select(review, bytes)
      await this.deps.store.selected(review)
      await this.deps.stage('file_selected')
      await revalidate()
      await this.deps.store.beginSave(review)
      await this.deps.stage('saving')
      // No retries after this boundary, including timeout and process restart.
      await this.deps.save(review)
      await this.deps.stage('verifying')
      await this.deps.verify(review)
      await this.deps.store.completeSubmission(review)
      await this.deps.record(review)
      await this.deps.stage('confirmed')
    } catch (error) {
      if (reserved && prepared) {
        await this.deps.store.uncertain(prepared.review).catch(() => undefined)
        await this.deps.stage('uncertain').catch(() => undefined)
        throw new Error(
          'Resposta CPI incerta. Confira o portal e o histórico; envio automático bloqueado.',
          { cause: error }
        )
      }
      throw error
    } finally {
      this.busy = false
    }
  }
}
