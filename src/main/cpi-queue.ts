import { createHash } from 'node:crypto'
import type { Frame } from 'playwright'
import type { CpiQueueRow } from '../shared/contracts'

// Fail closed unless columns explicitly identify their semantics.
export async function readQueueRows(frame: Frame): Promise<CpiQueueRow[]> {
  return frame
    .locator('div.row.linhas')
    .evaluateAll((elements) => {
      const normalize = (s: string): string =>
        s
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
      const redact = (s: string): string =>
        s.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '***.***.***-**').slice(0, 200)
      return elements.map((element) => {
        const field = (labels: string[]): string => {
          const values = Array.from(element.querySelectorAll('[data-label], [aria-label]'))
            .filter((e) =>
              labels.includes(
                normalize(e.getAttribute('data-label') || e.getAttribute('aria-label') || '')
              )
            )
            .map((e) => (e.textContent || '').trim())
          // Also support explicit table-like header/cell correspondence, never guessed indexes.
          if (!values.length && element.parentElement) {
            const headers = element.parentElement.querySelectorAll(':scope > .row:not(.linhas)')
            const header = headers.length === 1 ? headers[0] : null
            if (header && header.children.length === element.children.length) {
              Array.from(header.children).forEach((h, i) => {
                if (labels.includes(normalize(h.textContent || '')))
                  values.push((element.children[i].textContent || '').trim())
              })
            }
          }
          return values.length === 1 ? values[0] || '?' : values.length > 1 ? '?' : ''
        }
        const requestId = field(['idsolicit', 'idsolicitacao'])
        const labeledResearchId = field(['idpesquisa', 'idpesq', 'pesquisa'])
        const checks = Array.from(element.querySelectorAll('input[type="checkbox"][id^="pesq_"]'))
        const checkboxId = checks.length === 1 ? checks[0].id : ''
        // The existing portal locator identifies research by pesq_<ID>, within this row only.
        const researchId = labeledResearchId || /^pesq_(\d{1,15})$/.exec(checkboxId)?.[1] || ''
        const valid =
          /^\d{1,15}$/.test(requestId) &&
          /^\d{1,15}$/.test(researchId) &&
          checkboxId === `pesq_${researchId}` &&
          element.querySelectorAll('i[title="Responder / Atualizar"]').length === 1
        return {
          requestId,
          researchId,
          checkboxId,
          name: redact(field(['nome', 'pesquisado', 'nomedopesquisado'])),
          situation: redact(field(['situacao', 'status'])),
          fingerprint: JSON.stringify([requestId, researchId, checkboxId, element.innerHTML]),
          blockedReason: valid
            ? null
            : `Identificadores ou controle não confirmados (células: ${element.children.length}; controles de pesquisa: ${checks.length}).`
        }
      })
    })
    .then((rows) =>
      blockAmbiguousRows(rows.map((row) => ({ ...row, fingerprint: hash(row.fingerprint) })))
    )
}

export function blockAmbiguousRows(rows: CpiQueueRow[]): CpiQueueRow[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const key of ['requestId', 'researchId', 'checkboxId'] as const) {
      if (row[key]) {
        const token = `${key}:${row[key]}`
        counts.set(token, (counts.get(token) ?? 0) + 1)
      }
    }
  }
  return rows.map((row) => ({
    ...row,
    blockedReason: ['requestId', 'researchId', 'checkboxId'].some((key) => {
      const value = row[key as 'requestId' | 'researchId' | 'checkboxId']
      return value && (counts.get(`${key}:${value}`) ?? 0) > 1
    })
      ? 'Identificadores duplicados. Atualize e revise a fila.'
      : row.blockedReason
  }))
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export async function clickQueueRow(frames: Frame[], selected: CpiQueueRow): Promise<void> {
  if (
    !selected ||
    selected.blockedReason ||
    !/^\d{1,15}$/.test(selected.requestId) ||
    !/^\d{1,15}$/.test(selected.researchId)
  )
    throw new Error('Seleção CPI inválida ou ambígua.')
  const candidates: { frame: Frame; row: CpiQueueRow }[] = []
  for (const frame of frames) {
    for (const row of await readQueueRows(frame)) {
      if (
        row.requestId === selected.requestId ||
        row.researchId === selected.researchId ||
        row.checkboxId === selected.checkboxId
      )
        candidates.push({ frame, row })
    }
  }
  if (candidates.length !== 1) throw new Error('Solicitação ausente ou duplicada. Atualize a fila.')
  const candidate = candidates[0]
  if (
    candidate.row.blockedReason ||
    candidate.row.requestId !== selected.requestId ||
    candidate.row.researchId !== selected.researchId ||
    candidate.row.fingerprint !== selected.fingerprint
  )
    throw new Error('Linha modificada. Atualize a fila antes de abrir.')
  const row = candidate.frame
    .locator('div.row.linhas')
    .filter({ has: candidate.frame.locator(`input[id="${selected.checkboxId}"]`) })
  const control = row.locator('i[title="Responder / Atualizar"]')
  if ((await row.count()) !== 1 || (await control.count()) !== 1)
    throw new Error('Controle CPI ambíguo.')
  const html = await row.innerHTML()
  if (
    hash(JSON.stringify([selected.requestId, selected.researchId, selected.checkboxId, html])) !==
    selected.fingerprint
  )
    throw new Error('Linha modificada. Atualize a fila antes de abrir.')
  // Validate and dispatch in one DOM turn, so a replaced row cannot receive the click.
  await row.evaluate(
    (element, expected) => {
      if (
        element.innerHTML !== expected.html ||
        element.ownerDocument.querySelectorAll(`input[id="${expected.checkboxId}"]`).length !== 1
      )
        throw new Error('Linha modificada. Atualize a fila antes de abrir.')
      const controls = element.querySelectorAll<HTMLElement>('i[title="Responder / Atualizar"]')
      if (controls.length !== 1) throw new Error('Controle CPI ambíguo.')
      controls[0].click()
    },
    { html, checkboxId: selected.checkboxId }
  )
}
