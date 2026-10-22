import { createHash, randomUUID } from 'node:crypto'
import type { CpiAttachmentState, CpiPdfReview, PersonQueryResult } from '../shared/contracts'
import { prepareCpiPreview } from './cpi-preview'
import { isValidCpf } from './persons'
import { CpiControlError, type CpiDiagnostic } from './cpi-diagnostics'
import type { CpiAttachmentStore, CpiOperationState } from './cpi-attachment-store'

export interface AttachmentIdentity {
  requestId: string
  researchId: string
  cpf: string
  historyId: string
}

export interface AttachmentTarget extends AttachmentIdentity {
  requestStatus: string
  blockedReason: string | null
  blockedCategory?: CpiDiagnostic['category']
}

export function validateAttachmentIdentity(
  expected: AttachmentIdentity,
  actual: AttachmentIdentity
): void {
  if (!isValidCpf(expected.cpf) || expected.cpf !== actual.cpf)
    throw new CpiControlError('IDENTITY_MISMATCH', 'CPF divergente. Anexação bloqueada.')
  if (
    !/^\d{1,15}$/.test(expected.requestId) ||
    !/^\d{1,15}$/.test(expected.researchId) ||
    expected.requestId !== actual.requestId ||
    expected.researchId !== actual.researchId
  )
    throw new CpiControlError(
      'IDENTITY_MISMATCH',
      'IDs CPI divergentes ou não confirmados. Anexação bloqueada.'
    )
  if (!expected.historyId || expected.historyId !== actual.historyId)
    throw new CpiControlError(
      'IDENTITY_MISMATCH',
      'Vínculo ao histórico divergente. Anexação bloqueada.'
    )
}

// Only accepts the unmodified Chromium PDF emitted by the existing generator.
// This is deliberately not a parser for arbitrary external PDF files.
export function validateGeneratedPdf(bytes: Buffer): void {
  const raw = bytes.toString('latin1')
  const boxes = [...raw.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)]
  const pages = [...raw.matchAll(/\/Type\s*\/Page\b/g)]
  const offset = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(raw)?.[1])
  // The current Chromium generator emits a classic xref table. Fail closed on
  // other formats instead of pretending to parse arbitrary supplied PDFs.
  const table =
    Number.isSafeInteger(offset) && offset > 0 && offset < bytes.length
      ? /^xref\s+0\s+(\d+)\s*\r?\n([\s\S]*?)trailer\s*<<([\s\S]*?)>>\s*startxref/.exec(
          raw.slice(offset)
        )
      : null
  const entries =
    table?.[2]
      .trim()
      .split(/\r?\n/)
      .map((line) => /^(\d{10})\s+(\d{5})\s+([nf])\s*$/.exec(line)) ?? []
  const root = table && /\/Root\s+(\d+)\s+(\d+)\s+R\b/.exec(table[3])
  const rootEntry = root ? entries[Number(root[1])] : null
  const validXref =
    table &&
    Number(table[1]) === entries.length &&
    Number(/\/Size\s+(\d+)/.exec(table[3])?.[1]) === entries.length &&
    entries.length > 1 &&
    entries[0]?.[3] === 'f' &&
    entries.every(
      (entry, index) =>
        entry &&
        (entry[3] === 'f' ||
          (Number(entry[1]) > 0 &&
            Number(entry[1]) < offset &&
            raw.slice(Number(entry[1])).startsWith(`${index} ${Number(entry[2])} obj`)))
    ) &&
    rootEntry &&
    rootEntry[3] === 'n' &&
    Number(rootEntry[2]) === Number(root?.[2]) &&
    /\/Type\s*\/Catalog\b/.test(
      raw.slice(Number(rootEntry[1]), raw.indexOf('endobj', Number(rootEntry[1])))
    )
  if (
    bytes.length < 100 ||
    !raw.startsWith('%PDF-1.') ||
    !/%%EOF\s*$/.test(raw) ||
    !/startxref\s+\d+\s+%%EOF\s*$/.test(raw) ||
    !validXref ||
    pages.length === 0 ||
    boxes.length !== pages.length ||
    boxes.some(
      (box) =>
        !Number.isFinite(Number(box[1])) ||
        !Number.isFinite(Number(box[2])) ||
        Math.abs(Number(box[1]) - 595.28) > 2 ||
        Math.abs(Number(box[2]) - 841.89) > 2
    )
  )
    throw new CpiControlError(
      'PDF_INVALID',
      'PDF inválido ou formato A4 não confirmado. Anexação bloqueada.'
    )
}

interface Dependencies {
  resolve(): Promise<{ identity: AttachmentIdentity; result: PersonQueryResult }>
  inspect(identity: AttachmentIdentity): Promise<AttachmentTarget>
  generate(result: PersonQueryResult): Promise<Buffer>
  review(bytes: Buffer): Promise<void>
  confirm(review: CpiPdfReview): Promise<boolean>
  // The real adapter must only provide these after the official portal mechanism
  // and persisted-document evidence have been validated against its actual DOM.
  hasDocument(target: AttachmentTarget, filename: string, sha256: string): Promise<boolean>
  upload(target: AttachmentTarget, filename: string, bytes: Buffer): Promise<void>
  store: CpiAttachmentStore
  diagnose?(event: CpiDiagnostic): void
  // Only an authenticated, authoritative portal read may supply this evidence.
  // Absence must also establish that no request is still in flight.
  reconcileDocument?(
    target: AttachmentTarget,
    sha256: string
  ): Promise<
    AttachmentIdentity & {
      sha256: string
      status: 'present' | 'absent' | 'unknown'
      settled: boolean
    }
  >
}

export class CpiAttachmentWorkflow {
  private prepared: { review: CpiPdfReview; bytes: Buffer; sourceHash: string } | null = null
  private busy = false

  constructor(private readonly deps: Dependencies) {}

  clear(): void {
    this.prepared = null
  }

  async prepare(): Promise<CpiPdfReview> {
    if (this.busy) throw new Error('Anexação em andamento.')
    this.busy = true
    this.clear()
    const started = performance.now()
    try {
      const { identity, result } = await this.deps.resolve()
      validateAttachmentIdentity(identity, { ...identity, cpf: result.cpf.replace(/\D/g, '') })
      const target = await this.deps.inspect(identity)
      validateAttachmentIdentity(identity, target)
      const bytes = await this.deps.generate(result)
      validateGeneratedPdf(bytes)
      const classification = prepareCpiPreview(result).classification
      const review: CpiPdfReview = {
        ...identity,
        reviewId: randomUUID(),
        filename: `Relatorio_Pesquisa_${identity.requestId}_${identity.researchId}.pdf`,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        byteLength: bytes.length,
        requestStatus: target.requestStatus,
        blockedReason: target.blockedReason,
        classification
      }
      const sourceHash = this.hashResult(result)
      if (classification !== 'INDEFINIDO')
        await this.deps.store.prepare(review, sourceHash, classification)
      await this.deps.review(bytes)
      this.prepared = { review, bytes, sourceHash }
      this.diagnostic('prepare', started, 'ok', null, 'review_again')
      return review
    } catch (error) {
      this.diagnostic(
        'prepare',
        started,
        'failed',
        error instanceof CpiControlError ? error.category : 'VALIDATION_REQUIRED',
        'review_again'
      )
      throw error
    } finally {
      this.busy = false
    }
  }

  async attach(reviewId: string): Promise<CpiAttachmentState> {
    if (this.busy) throw new Error('Anexação em andamento.')
    this.busy = true
    const started = performance.now()
    try {
      const prepared = this.prepared
      if (!prepared || prepared.review.reviewId !== reviewId)
        throw new Error('Prepare e confira novamente o PDF da pesquisa selecionada.')
      const { review, bytes } = prepared
      if (review.classification === 'INDEFINIDO') {
        this.diagnostic('validate', started, 'blocked', 'CLASSIFICATION_UNDEFINED', 'review_again')
        return {
          state: 'blocked',
          message: 'Classificação INDEFINIDO. Revise o resultado antes de anexar.',
          requestStatus: review.requestStatus
        }
      }
      const resolve = async (): Promise<AttachmentTarget> => {
        const current = await this.deps.resolve()
        validateAttachmentIdentity(review, current.identity)
        validateAttachmentIdentity(review, {
          ...current.identity,
          cpf: current.result.cpf.replace(/\D/g, '')
        })
        if (this.hashResult(current.result) !== prepared.sourceHash)
          throw new Error('Resultado local alterado. Confira novamente o PDF.')
        validateGeneratedPdf(bytes)
        if (createHash('sha256').update(bytes).digest('hex') !== review.sha256)
          throw new Error('PDF alterado. Anexação bloqueada.')
        const target = await this.deps.inspect(current.identity)
        validateAttachmentIdentity(review, target)
        return target
      }
      let target = await resolve()
      const operation = await this.deps.store.read(review)
      if (operation?.state === 'CONFIRMACAO_INCERTA') {
        this.diagnostic(
          'validate',
          started,
          'uncertain',
          'CONFIRMATION_MISSING',
          'reconcile_portal'
        )
        return {
          state: 'uncertain',
          message:
            'CONFIRMACAO_INCERTA. Reconcilie o estado no portal antes de qualquer nova tentativa.',
          requestStatus: target.requestStatus
        }
      }
      if (operation?.state === 'DOCUMENTO_CONFIRMADO') {
        this.diagnostic('verify_document', started, 'ok', null, 'none')
        return {
          state: 'already_present',
          message: 'Documento já confirmado para esta pesquisa. Nenhum novo envio.',
          requestStatus: target.requestStatus
        }
      }
      if (target.blockedReason) {
        this.diagnostic(
          'validate',
          started,
          'blocked',
          target.blockedCategory ?? 'VALIDATION_REQUIRED',
          target.blockedCategory === 'SESSION_REQUIRED' ? 'login' : 'validate_portal'
        )
        return {
          state: 'blocked',
          message: target.blockedReason,
          requestStatus: target.requestStatus
        }
      }
      const hasDocument = async (): Promise<boolean> => {
        const present = await this.deps.hasDocument(target, review.filename, review.sha256)
        if (typeof present !== 'boolean')
          throw new CpiControlError(
            'CONFIRMATION_MISSING',
            'Estado documental indefinido; envio bloqueado.'
          )
        return present
      }
      if (await hasDocument()) {
        await this.deps.store.confirmExisting(review, prepared.sourceHash)
        this.diagnostic('verify_document', started, 'ok', null, 'none')
        return {
          state: 'already_present',
          message: 'Documento já presente no portal. Nenhum novo envio.',
          requestStatus: target.requestStatus
        }
      }
      if ((await this.deps.confirm(review)) !== true) {
        this.diagnostic('review', started, 'cancelled', null, 'review_again')
        return {
          state: 'cancelled',
          message: 'Anexação cancelada pelo operador.',
          requestStatus: target.requestStatus
        }
      }
      // Re-read after the operator has reviewed the document and confirmed.
      target = await resolve()
      if (target.blockedReason) {
        this.diagnostic(
          'validate',
          started,
          'blocked',
          target.blockedCategory ?? 'VALIDATION_REQUIRED',
          'validate_portal'
        )
        return {
          state: 'blocked',
          message: target.blockedReason,
          requestStatus: target.requestStatus
        }
      }
      if (await hasDocument()) {
        await this.deps.store.confirmExisting(review, prepared.sourceHash)
        this.diagnostic('verify_document', started, 'ok', null, 'none')
        return {
          state: 'already_present',
          message: 'Documento já presente no portal. Nenhum novo envio.',
          requestStatus: target.requestStatus
        }
      }
      // Durable reservation happens BEFORE the side effect. Uncertain attempts
      // stay blocked across restarts; never retry an ambiguous upload.
      await this.deps.store.review(review, prepared.sourceHash)
      await this.deps.store.reserve(review, prepared.sourceHash)
      this.clear()
      let stage: CpiDiagnostic['stage'] = 'select_file'
      let stageStarted = performance.now()
      try {
        await this.deps.upload(target, review.filename, bytes)
        await this.deps.store.selected(review)
        this.diagnostic(stage, stageStarted, 'ok', null, 'none')
        stage = 'verify_document'
        stageStarted = performance.now()
        target = await resolve()
        if (!(await hasDocument())) throw new Error('Presença do documento não confirmada.')
        await this.deps.store.complete(review)
        this.diagnostic(stage, stageStarted, 'ok', null, 'none')
        return {
          state: 'attached',
          message: 'Documento confirmado no portal. Situação da solicitação preservada.',
          requestStatus: target.requestStatus
        }
      } catch {
        // If recording uncertainty also fails, the durable pre-effect state
        // already blocks replay. Do not lose the uncertainty response.
        await this.deps.store.uncertain(review).catch(() => undefined)
        this.diagnostic(
          stage,
          stageStarted,
          'uncertain',
          stage === 'select_file' ? 'INTERRUPTED' : 'CONFIRMATION_MISSING',
          'reconcile_portal'
        )
        return {
          state: 'uncertain',
          message:
            'Gravação não confirmada. Confira o portal; nova tentativa bloqueada para evitar duplicação.',
          requestStatus: target.requestStatus
        }
      }
    } catch (error) {
      this.diagnostic(
        'validate',
        started,
        'failed',
        error instanceof CpiControlError ? error.category : 'VALIDATION_REQUIRED',
        'review_again'
      )
      throw error
    } finally {
      this.busy = false
    }
  }

  async reconcile(reviewId: string): Promise<CpiOperationState> {
    if (this.busy) throw new Error('Anexação em andamento.')
    this.busy = true
    const started = performance.now()
    try {
      const prepared = this.prepared
      if (!prepared || prepared.review.reviewId !== reviewId || !this.deps.reconcileDocument)
        throw new Error(
          'Reconciliação no portal ainda não validada. Nenhuma nova tentativa permitida.'
        )
      const { review, sourceHash } = prepared
      const current = await this.deps.resolve()
      validateAttachmentIdentity(review, current.identity)
      validateAttachmentIdentity(review, {
        ...current.identity,
        cpf: current.result.cpf.replace(/\D/g, '')
      })
      if (this.hashResult(current.result) !== sourceHash)
        throw new Error('Resultado local alterado. Reconciliação bloqueada.')
      const record = await this.deps.store.read(review)
      if (
        !record?.binding ||
        record.state !== 'CONFIRMACAO_INCERTA' ||
        record.binding.sourceHash !== sourceHash ||
        record.binding.historyHash !== createHash('sha256').update(review.historyId).digest('hex')
      )
        throw new Error('Vínculo do registro incerto divergente. Reconciliação manual necessária.')
      const target = await this.deps.inspect(review)
      validateAttachmentIdentity(review, target)
      const evidence = await this.deps.reconcileDocument(target, record.binding.sha256)
      validateAttachmentIdentity(review, evidence)
      if (evidence.sha256 !== record.binding.sha256)
        throw new Error('PDF da reconciliação divergente.')
      if (!['present', 'absent'].includes(evidence.status) || evidence.settled !== true)
        throw new Error('Reconciliação não conclusiva; operação ainda bloqueada.')
      const after = await this.deps.resolve()
      validateAttachmentIdentity(review, after.identity)
      if (this.hashResult(after.result) !== sourceHash)
        throw new Error('Resultado alterado durante reconciliação.')
      validateAttachmentIdentity(review, await this.deps.inspect(review))
      const next = await this.deps.store.reconcile(
        review,
        record.revision,
        evidence.status as 'present' | 'absent'
      )
      this.clear()
      this.diagnostic(
        'reconcile',
        started,
        'ok',
        null,
        next === 'RECONCILIADO_AUSENTE' ? 'review_again' : 'none'
      )
      return next
    } catch (error) {
      this.diagnostic('reconcile', started, 'blocked', 'CONFIRMATION_MISSING', 'reconcile_portal')
      throw error
    } finally {
      this.busy = false
    }
  }

  private diagnostic(
    stage: CpiDiagnostic['stage'],
    started: number,
    status: CpiDiagnostic['status'],
    category: CpiDiagnostic['category'],
    recovery: CpiDiagnostic['recovery']
  ): void {
    try {
      this.deps.diagnose?.({
        stage,
        durationMs: Math.max(0, performance.now() - started),
        status,
        category,
        recovery
      })
    } catch {
      /* Diagnostics must never change transactional behavior. */
    }
  }

  private hashResult(result: PersonQueryResult): string {
    return createHash('sha256').update(JSON.stringify(result)).digest('hex')
  }
}
