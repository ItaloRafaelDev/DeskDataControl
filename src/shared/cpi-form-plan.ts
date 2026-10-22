import type { CpiPreview } from './contracts'

export interface CpiFormPlan {
  resultLabel: 'Sim, Consta Restrições' | 'Há Informações' | null
  resultSelector: '#consta3' | '#consta2' | null
  statusLabel: 'Respondida'
  researcherLabel: 'Desk Data'
  primaryResearcherLabel: 'Desk Data'
  readyForReview: boolean
  issues: string[]
}

export function buildCpiFormPlan(preview: CpiPreview): CpiFormPlan {
  const issues: string[] = []

  if (
    preview.totalDeclared === null ||
    preview.totalDeclared !== preview.totalReceived ||
    preview.truncated
  ) {
    issues.push('Quantidade de processos não reconciliada com a resposta da API.')
  }

  if (preview.unknown > 0) {
    issues.push('Existem processos com esfera não identificada.')
  }

  if (preview.classification === 'INDEFINIDO') {
    issues.push('A classificação depende de revisão humana.')
  }

  if (preview.classification === 'CONSTA_RESTRICAO' && preview.criminalWithDocument === 0) {
    issues.push('Nenhum processo criminal possui correspondência documental confirmada.')
  }

  const resultSelector =
    preview.classification === 'CONSTA_RESTRICAO'
      ? '#consta3'
      : preview.classification === 'HA_INFORMACOES'
        ? '#consta2'
        : null

  const resultLabel =
    preview.classification === 'CONSTA_RESTRICAO'
      ? 'Sim, Consta Restrições'
      : preview.classification === 'HA_INFORMACOES'
        ? 'Há Informações'
        : null

  return {
    resultSelector,
    resultLabel,
    statusLabel: 'Respondida',
    researcherLabel: 'Desk Data',
    primaryResearcherLabel: 'Desk Data',
    readyForReview: issues.length === 0 && resultSelector !== null,
    issues
  }
}
