import type { CpiPreview, CpiPreviewProcess, PersonQueryResult } from '../shared/contracts'
import { isValidCpf } from './persons'

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null
}

function asText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function normalized(value: unknown): string {
  return asText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
}

function digits(value: unknown): string {
  return asText(value).replace(/\D/g, '')
}

function sphere(value: unknown): CpiPreviewProcess['sphere'] {
  const name = normalized(value)

  if (/CRIMIN|\bPENAL\b/.test(name)) {
    return 'criminal'
  }

  if (/CIVEL|TRABALH|FAMILIA|FAZENDA|ELEITORAL|TRIBUTAR|PREVIDENCI/.test(name)) {
    return 'noncriminal'
  }

  return 'unknown'
}

function getParticipants(process: JsonRecord): unknown[] {
  const value = process.parties ?? process.participants

  if (Array.isArray(value)) return value

  const wrapped = record(value)

  return Array.isArray(wrapped?.items) ? wrapped.items : []
}

export function prepareCpiPreview(result: PersonQueryResult): CpiPreview {
  const section = result.sections.find((item) => item.dataset === 'lawsuits')

  const data = record(section?.data)
  const values = data?.items

  const total =
    typeof data?.total === 'number' && Number.isSafeInteger(data.total) && data.total >= 0
      ? data.total
      : null

  const cpf = digits(result.cpf)
  const hasCpf = isValidCpf(cpf)
  const warnings: string[] = []

  if (!Array.isArray(values)) {
    warnings.push('A pesquisa não contém uma lista de processos utilizável.')
  }

  const items = Array.isArray(values) ? values : []

  if (total !== null && total > items.length) {
    warnings.push('A quantidade recebida é menor que o total informado pela API.')
  }

  if (!hasCpf) {
    warnings.push('CPF indisponível para verificar participação por documento.')
  }

  const processes: CpiPreviewProcess[] = items.map((value, index) => {
    const process = record(value) ?? {}
    const type = sphere(process.court_type)

    const matching = hasCpf
      ? getParticipants(process).filter((part) => {
          const person = record(part)
          const details = record(person?.details)

          return [person?.doc, person?.document, person?.cpf, details?.doc].some(
            (candidate) => digits(candidate) === cpf
          )
        })
      : []

    const roles = [
      ...new Set(
        matching
          .map((part) => {
            const person = record(part)
            const details = record(person?.details)

            return asText(details?.type ?? person?.participation ?? person?.role).trim()
          })
          .filter(Boolean)
      )
    ]

    return {
      number: asText(process.number ?? process.process_number) || `Sem número (${index + 1})`,
      courtType: asText(process.court_type),
      situation: asText(process.status),
      sphere: type,
      participation: matching.length > 0 ? 'document_matched' : 'not_verified',
      roles
    }
  })

  const criminal = processes.filter((item) => item.sphere === 'criminal').length

  const unknown = processes.filter((item) => item.sphere === 'unknown').length

  const criminalWithDocument = processes.filter(
    (item) => item.sphere === 'criminal' && item.participation === 'document_matched'
  ).length

  if (unknown > 0) {
    warnings.push('Existem processos com esfera não identificada.')
  }

  if (processes.some((item) => item.participation === 'not_verified')) {
    warnings.push(
      'Existem processos sem correspondência de CPF comprovada nos participantes retornados.'
    )
  }

  const complete =
    result.sections.filter((item) => item.dataset === 'lawsuits').length === 1 &&
    section?.present === true &&
    Array.isArray(values) &&
    total !== null &&
    total === processes.length &&
    section.total === total &&
    section.returnedItems === processes.length &&
    !data?.error &&
    !data?.errors &&
    data?.truncated !== true &&
    processes.length <= 100

  if (!complete)
    warnings.push('Resultado judicial incompleto, com erro ou contagem não reconciliada.')
  const doubtful = !hasCpf || processes.some((item) => item.participation === 'not_verified')

  const classification =
    !complete || doubtful
      ? ('INDEFINIDO' as const)
      : criminalWithDocument > 0
        ? ('CONSTA_RESTRICAO' as const)
        : criminal > 0 || unknown > 0
          ? ('INDEFINIDO' as const)
          : ('HA_INFORMACOES' as const)

  const classificationLabel =
    classification === 'CONSTA_RESTRICAO'
      ? 'Sim, Consta Restrições'
      : classification === 'HA_INFORMACOES'
        ? 'Há Informações'
        : 'Revisão necessária'

  return {
    classification,
    classificationLabel,
    queryCode: result.queryCode,
    cpf: hasCpf ? cpf : '',
    totalDeclared: total,
    totalReceived: processes.length,
    criminal,
    criminalWithDocument,
    unknown,
    readyForSubmission: false,
    warnings,
    processes: processes.slice(0, 100),
    truncated: processes.length > 100
  }
}
