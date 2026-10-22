export const CPI_CPF_SELECTOR =
  'xpath=//div[contains(concat(" ", normalize-space(@class), " "), " cell ") and contains(concat(" ", normalize-space(@class), " "), " txt ") and normalize-space(.)="CPF:"]/following-sibling::div[contains(concat(" ", normalize-space(@class), " "), " cell ") and contains(concat(" ", normalize-space(@class), " "), " field ")][1]'

export function extractCpiRequestId(content: string): string {
  const normalized = content
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')

  const pattern = /Dados\s+Solicitacao\s*[:#-]?\s*(\d{1,15})(?=\D|$)/gi

  const references = [...new Set(Array.from(normalized.matchAll(pattern), (match) => match[1]))]

  if (references.length !== 1) {
    throw new Error('Identificador da solicitacao CPI nao identificado de forma unica.')
  }

  return references[0]
}
