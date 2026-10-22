import type { CpiLinkRecord, CpiPreview, CpiSelectedResearch } from '../shared/contracts'
import type { StoredResearch } from './research-history'

export interface CpiSelection {
  requestId: string
  cpf: string
  maskedCpf: string
}
interface Dependencies {
  readOpenedReference(): Promise<string>
  checkOpenedResearch(cpf: string): Promise<{ match: boolean }>
  listLinks(): Promise<CpiLinkRecord[]>
  listResearch(): Promise<StoredResearch[]>
  readResearch(id: string): Promise<StoredResearch>
  preparePreview(result: NonNullable<StoredResearch['result']>): CpiPreview
}

export async function resolveCpiHistory(
  selection: CpiSelection,
  deps: Dependencies,
  chosenId?: string
): Promise<CpiSelectedResearch> {
  if (
    (await deps.readOpenedReference()) !== selection.requestId ||
    !(await deps.checkOpenedResearch(selection.cpf)).match
  )
    throw new Error('Formulário CPI alterado. Solicitação ou CPF divergente.')
  const links = (await deps.listLinks()).filter((link) => link.cpiReference === selection.requestId)
  if (links.length > 1) throw new Error('Vínculo local ambíguo. Revise em Ferramentas avançadas.')
  if (links[0] && links[0].cpf.replace(/\D/g, '') !== selection.cpf)
    throw new Error('CPF do vínculo local divergente.')
  const matches = (await deps.listResearch()).filter(
    (record) =>
      record.status === 'completed' && record.result?.cpf.replace(/\D/g, '') === selection.cpf
  )
  const base = { requestId: selection.requestId, maskedCpf: selection.maskedCpf }
  let historyId = links[0]?.historyId ?? null
  if (chosenId) {
    if (!matches.some((record) => record.id === chosenId))
      throw new Error('Histórico selecionado inválido.')
    if (historyId && historyId !== chosenId) throw new Error('Seleção divergente do vínculo local.')
    historyId = chosenId
  }
  if (!historyId && matches.length > 1)
    return {
      ...base,
      historyId: null,
      preview: null,
      historyState: 'ambiguous',
      candidates: matches.map((record) => ({
        id: record.id,
        queryCode: record.queryCode,
        createdAt: record.createdAt
      }))
    }
  historyId ??= matches[0]?.id ?? null
  if (!historyId)
    return { ...base, historyId: null, preview: null, historyState: 'missing', candidates: [] }
  const record = await deps.readResearch(historyId)
  if (
    record.status !== 'completed' ||
    !record.result ||
    record.result.cpf.replace(/\D/g, '') !== selection.cpf
  )
    throw new Error('CPF ou resultado do histórico local divergente.')
  return {
    ...base,
    historyId,
    preview: deps.preparePreview(record.result),
    historyState: 'unique',
    candidates: []
  }
}
