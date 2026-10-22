import { createHash } from 'node:crypto'
import { mkdir, open, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AttachmentIdentity } from './cpi-attachment'
import type { CpiPdfReview } from '../shared/contracts'

export type CpiOperationState =
  | 'GRAVACAO_EM_ANDAMENTO'
  | 'RESPOSTA_CONFIRMADA'
  | 'PREPARADO'
  | 'REVISAO_CONFIRMADA'
  | 'ANEXACAO_EM_ANDAMENTO'
  | 'ARQUIVO_SELECIONADO'
  | 'CONFIRMACAO_INCERTA'
  | 'DOCUMENTO_CONFIRMADO'
  | 'RECONCILIADO_AUSENTE'

export interface CpiOperationRecord {
  version: 1
  revision: number
  state: CpiOperationState
  at: string
  binding: {
    historyHash: string
    sha256: string
    sourceHash: string
    classification: 'HA_INFORMACOES' | 'CONSTA_RESTRICAO'
  } | null
}

const states: CpiOperationState[] = [
  'GRAVACAO_EM_ANDAMENTO',
  'RESPOSTA_CONFIRMADA',
  'PREPARADO',
  'REVISAO_CONFIRMADA',
  'ANEXACAO_EM_ANDAMENTO',
  'ARQUIVO_SELECIONADO',
  'CONFIRMACAO_INCERTA',
  'DOCUMENTO_CONFIRMADO',
  'RECONCILIADO_AUSENTE'
]
const pending = (state: CpiOperationState): boolean =>
  [
    'ANEXACAO_EM_ANDAMENTO',
    'ARQUIVO_SELECIONADO',
    'GRAVACAO_EM_ANDAMENTO',
    'CONFIRMACAO_INCERTA'
  ].includes(state)
const hash = (value: string): string => createHash('sha256').update(value).digest('hex')

// Immutable events use exclusive creation as compare-and-swap. Partial writes
// fail closed. Store no CPF, document contents, paths or external error messages.
export class CpiAttachmentStore {
  constructor(private readonly directory: string) {}

  private key(identity: AttachmentIdentity): string {
    if (!/^\d{1,15}$/.test(identity.requestId) || !/^\d{1,15}$/.test(identity.researchId))
      throw new Error('IDs CPI inválidos para persistência.')
    return hash(`${identity.requestId}:${identity.researchId}`)
  }

  async read(identity: AttachmentIdentity): Promise<CpiOperationRecord | null> {
    const record = await this.raw(identity)
    return record && pending(record.state) ? { ...record, state: 'CONFIRMACAO_INCERTA' } : record
  }

  private async raw(identity: AttachmentIdentity): Promise<CpiOperationRecord | null> {
    const key = this.key(identity)
    await mkdir(this.directory, { recursive: true })
    let legacy: CpiOperationRecord | null = null
    try {
      const value = JSON.parse(await readFile(join(this.directory, `${key}.json`), 'utf8'))
      if (!['uncertain', 'attached'].includes(value.state)) throw new Error('legacy')
      legacy = {
        version: 1,
        revision: -1,
        state: value.state === 'attached' ? 'DOCUMENTO_CONFIRMADO' : 'CONFIRMACAO_INCERTA',
        at: value.at,
        binding: null
      }
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
        throw new Error('Registro CPI inválido. Reconciliação manual necessária.', { cause: error })
    }
    const names = (await readdir(this.directory))
      .filter(
        (name) => name.startsWith(`${key}.`) && /^\d{8}\.json$/.test(name.slice(key.length + 1))
      )
      .sort()
    if (legacy && names.length > 0)
      throw new Error('Registros CPI incompatíveis; duplicação bloqueada.')
    let last = legacy
    for (let index = 0; index < names.length; index++) {
      let value: CpiOperationRecord
      try {
        value = JSON.parse(await readFile(join(this.directory, names[index]), 'utf8'))
      } catch {
        throw new Error('Diário CPI corrompido. Operação bloqueada.')
      }
      if (
        names[index] !== `${key}.${String(index).padStart(8, '0')}.json` ||
        value.version !== 1 ||
        value.revision !== index ||
        !states.includes(value.state) ||
        !value.binding ||
        ![value.binding.historyHash, value.binding.sha256, value.binding.sourceHash].every(
          (item) => typeof item === 'string' && /^[a-f0-9]{64}$/.test(item)
        ) ||
        !['HA_INFORMACOES', 'CONSTA_RESTRICAO'].includes(value.binding.classification)
      )
        throw new Error('Diário CPI inválido. Operação bloqueada.')
      last = value
    }
    return last
  }

  private async durableWrite(path: string, value: unknown): Promise<void> {
    const file = await open(path, 'wx', 0o600)
    try {
      await file.writeFile(JSON.stringify(value))
      await file.sync()
    } finally {
      await file.close()
    }
  }

  private async append(
    identity: AttachmentIdentity,
    previous: CpiOperationRecord | null,
    state: CpiOperationState,
    binding = previous?.binding
  ): Promise<void> {
    if (!binding)
      throw new Error('Registro legado exige reconciliação manual; duplicação bloqueada.')
    const revision = (previous?.revision ?? -1) + 1
    const path = join(
      this.directory,
      `${this.key(identity)}.${String(revision).padStart(8, '0')}.json`
    )
    try {
      await this.durableWrite(path, {
        version: 1,
        revision,
        state,
        at: new Date().toISOString(),
        binding
      })
    } catch {
      throw new Error('Alteração concorrente ou falha no diário CPI; duplicação bloqueada.')
    }
  }

  async prepare(
    review: CpiPdfReview,
    sourceHash: string,
    classification: 'HA_INFORMACOES' | 'CONSTA_RESTRICAO'
  ): Promise<void> {
    const current = await this.raw(review)
    if (
      current &&
      (pending(current.state) ||
        ['DOCUMENTO_CONFIRMADO', 'RESPOSTA_CONFIRMADA'].includes(current.state))
    )
      return
    const binding = {
      historyHash: hash(review.historyId),
      sha256: review.sha256,
      sourceHash,
      classification
    }
    if (!/^[a-f0-9]{64}$/.test(binding.sha256) || !/^[a-f0-9]{64}$/.test(sourceHash))
      throw new Error('Hashes CPI inválidos.')
    await this.append(review, current, 'PREPARADO', binding)
  }

  async review(
    identity: AttachmentIdentity & { sha256?: string },
    sourceHash?: string
  ): Promise<void> {
    const current = await this.raw(identity)
    if (
      identity.sha256 &&
      (current?.binding?.sha256 !== identity.sha256 ||
        current.binding.sourceHash !== sourceHash ||
        current.binding.historyHash !== hash(identity.historyId))
    )
      throw new Error('PDF ou histórico do diário divergente; duplicação bloqueada.')
    if (!current || current.state !== 'PREPARADO')
      throw new Error('Revisão CPI fora de etapa; duplicação bloqueada.')
    await this.append(identity, current, 'REVISAO_CONFIRMADA')
  }

  async confirmExisting(review: CpiPdfReview, sourceHash: string): Promise<void> {
    const current = await this.raw(review)
    if (
      !current ||
      current.state !== 'PREPARADO' ||
      current.binding?.sha256 !== review.sha256 ||
      current.binding.sourceHash !== sourceHash ||
      current.binding.historyHash !== hash(review.historyId)
    )
      throw new Error('Evidência documental sem vínculo ao diário CPI. Operação bloqueada.')
    await this.append(review, current, 'DOCUMENTO_CONFIRMADO')
  }

  async reserve(
    identity: AttachmentIdentity & { sha256?: string },
    sourceHash?: string
  ): Promise<void> {
    const current = await this.raw(identity)
    if (!current) {
      // Compatibility: old callers create a permanent fail-closed reservation.
      try {
        await this.durableWrite(join(this.directory, `${this.key(identity)}.json`), {
          state: 'uncertain',
          at: new Date().toISOString()
        })
      } catch {
        throw new Error('Reserva CPI existente ou indisponível; duplicação bloqueada.')
      }
      return
    }
    if (current.state !== 'REVISAO_CONFIRMADA')
      throw new Error(
        'Tentativa pendente ou concluída; reconciliação necessária; duplicação bloqueada.'
      )
    if (
      current.binding?.historyHash !== hash(identity.historyId) ||
      (identity.sha256 &&
        (current.binding.sha256 !== identity.sha256 || current.binding.sourceHash !== sourceHash))
    )
      throw new Error('Vínculo da reserva CPI divergente; duplicação bloqueada.')
    await this.append(identity, current, 'ANEXACAO_EM_ANDAMENTO')
  }

  async selected(identity: AttachmentIdentity): Promise<void> {
    await this.transition(identity, ['ANEXACAO_EM_ANDAMENTO'], 'ARQUIVO_SELECIONADO')
  }

  async uncertain(identity: AttachmentIdentity): Promise<void> {
    await this.transition(
      identity,
      ['ANEXACAO_EM_ANDAMENTO', 'ARQUIVO_SELECIONADO', 'GRAVACAO_EM_ANDAMENTO'],
      'CONFIRMACAO_INCERTA'
    )
  }

  async beginSave(identity: AttachmentIdentity): Promise<void> {
    await this.transition(identity, ['ARQUIVO_SELECIONADO'], 'GRAVACAO_EM_ANDAMENTO')
  }

  async completeSubmission(identity: AttachmentIdentity): Promise<void> {
    await this.transition(identity, ['GRAVACAO_EM_ANDAMENTO'], 'RESPOSTA_CONFIRMADA')
  }

  async complete(identity: AttachmentIdentity): Promise<void> {
    const current = await this.raw(identity)
    if (current?.binding)
      await this.transition(identity, ['ARQUIVO_SELECIONADO'], 'DOCUMENTO_CONFIRMADO')
    else if (!current) throw new Error('Reserva CPI ausente.')
    // Legacy reservations remain blocked: old completion is not new evidence.
  }

  async reconcile(
    identity: AttachmentIdentity,
    revision: number,
    status: 'present' | 'absent'
  ): Promise<CpiOperationState> {
    if (status !== 'present' && status !== 'absent')
      throw new Error('Reconciliação indefinida. Operação bloqueada.')
    const current = await this.raw(identity)
    if (!current || current.revision !== revision || !pending(current.state) || !current.binding)
      throw new Error(
        'Reconciliação concorrente, legada ou sem tentativa pendente. Operação bloqueada.'
      )
    const next = status === 'present' ? 'DOCUMENTO_CONFIRMADO' : 'RECONCILIADO_AUSENTE'
    await this.append(identity, current, next)
    return next
  }

  private async transition(
    identity: AttachmentIdentity,
    allowed: CpiOperationState[],
    next: CpiOperationState
  ): Promise<void> {
    const current = await this.raw(identity)
    if (!current || !allowed.includes(current.state))
      throw new Error('Transição CPI inválida; duplicação bloqueada.')
    await this.append(identity, current, next)
  }
}
