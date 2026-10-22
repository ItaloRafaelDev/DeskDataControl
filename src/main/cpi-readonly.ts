import { CpiQueueFilter } from './cpi-filter'
import { CpiResultAdapter } from './cpi-result-adapter'
import { readQueueRows, clickQueueRow, blockAmbiguousRows } from './cpi-queue'
import type { CpiQueueRow } from '../shared/contracts'
import { extractCpiRequestId, CPI_CPF_SELECTOR as CPF_SELECTOR } from './cpi-reference'
import type { CpiOpenedIdentity } from '../shared/contracts'

import { app } from 'electron'
import { join } from 'node:path'
import type { BrowserContext, Page, Frame } from 'playwright'
import type { CpiQueueSnapshot, CpiIdentityCheck } from '../shared/contracts'
import { isValidCpf } from './persons'
import type { AttachmentIdentity, AttachmentTarget } from './cpi-attachment'
import { validateAttachmentIdentity } from './cpi-attachment'
import { CpiUploadAdapter } from './cpi-upload-adapter'
import { CpiControlError } from './cpi-diagnostics'

const HOST = 'adm.cpicentral.com.br'

const QUEUE_URL =
  'https://adm.cpicentral.com.br/zpersEspecial/pesquisas/aguardando/mod_t_aguardando.aspx'

const QUEUE_PATH = '/zpersespecial/pesquisas/aguardando/mod_t_aguardando.aspx'

const DETAIL_PATH = '/zpersespecial/pesquisas/upd_cad/mod_tt_pesq_upd.aspx'

const ROW_SELECTOR =
  'div.row.linhas:has(input[type="checkbox"][id^="pesq_"]):has(i[title="Responder / Atualizar"])'

function isCpiPage(page: Page): boolean {
  try {
    return new URL(page.url()).origin === `https://${HOST}`
  } catch {
    return false
  }
}

function pathOf(value: string): string {
  try {
    return new URL(value).pathname.toLowerCase()
  } catch {
    return ''
  }
}

export function parseQueueTotal(value: string): number | null {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')

  const match = normalized.match(
    /Mostrando:\s*\d+\s*a\s*\d+\s*\(\s*de\s*(\d+)\s*registro(?:s)?\s*\)/i
  )

  if (!match) return null

  const total = Number(match[1])

  return Number.isSafeInteger(total) && total >= 0 ? total : null
}

export class CpiReadOnlySession {
  private context: BrowserContext | null = null
  private readonly filter = new CpiQueueFilter()
  private bound: { frame: Frame; url: string; row: CpiQueueRow } | null = null
  readonly resultAdapter = new CpiResultAdapter(async () => this.boundFrame())

  private boundFrame(): Frame {
    const bound = this.bound
    if (!bound || bound.frame.isDetached() || bound.frame.url() !== bound.url)
      throw new Error('Formulário CPI alterado. Reabra a seleção.')
    if (new URL(bound.url).origin !== `https://${HOST}` || pathOf(bound.url) !== DETAIL_PATH)
      throw new Error('Origem do formulário CPI divergente.')
    return bound.frame
  }

  async validateSubmission(identity: AttachmentIdentity): Promise<void> {
    const bound = this.bound
    this.boundFrame()
    if (
      !bound ||
      bound.row.requestId !== identity.requestId ||
      bound.row.researchId !== identity.researchId
    )
      throw new Error('Pesquisa CPI divergente da linha selecionada.')
    if (
      (await this.readOpenedReference()) !== identity.requestId ||
      !(await this.checkOpenedResearch(identity.cpf)).match
    )
      throw new Error('Solicitação ou CPF divergente da seleção CPI.')
    const rows = (await this.readQueue()).rows.filter(
      (r) => r.requestId === identity.requestId || r.researchId === identity.researchId
    )
    if (
      rows.length !== 1 ||
      rows[0].blockedReason ||
      rows[0].requestId !== identity.requestId ||
      rows[0].researchId !== identity.researchId
    )
      throw new Error('IDs da pesquisa CPI não confirmados na fila.')
  }

  async selectSubmissionPdf(
    review: import('../shared/contracts').CpiPdfReview,
    bytes: Buffer
  ): Promise<void> {
    const adapter = new CpiUploadAdapter(() => [this.boundFrame()], { validatedSelection: true })
    await adapter.selectFile(review.filename, bytes, () => this.validateSubmission(review))
  }

  async verifySubmission(review: import('../shared/contracts').CpiPdfReview): Promise<void> {
    if (!this.bound) throw new Error('Vínculo CPI indisponível.')
    await this.resultAdapter.verify(review, this.bound.url)
  }
  constructor(private readonly onClosed: () => void = () => undefined) {}

  async isActive(): Promise<boolean> {
    if (!this.context) return false
    try {
      const pages = this.context.pages().filter(isCpiPage)
      if (!pages.length) return false
      const queue = await this.readQueue(false, false)
      return queue.state === 'HAS_RESEARCH' || queue.state === 'EMPTY'
    } catch {
      return false
    }
  }

  async inspectAttachmentTarget(identity: AttachmentIdentity): Promise<AttachmentTarget> {
    if ((await this.readOpenedReference()) !== identity.requestId)
      throw new CpiControlError(
        'IDENTITY_MISMATCH',
        'ID da solicitação CPI divergente. Anexação bloqueada.'
      )
    if (!(await this.checkOpenedResearch(identity.cpf)).match)
      throw new CpiControlError('IDENTITY_MISMATCH', 'CPF CPI divergente. Anexação bloqueada.')
    const queue = await this.readQueue()
    const rows = queue.rows.filter(
      (row) => row.requestId === identity.requestId && row.researchId === identity.researchId
    )
    if (rows.length !== 1 || rows[0].blockedReason)
      throw new CpiControlError(
        'IDENTITY_MISMATCH',
        'IDs da solicitação/pesquisa não confirmados na fila CPI.'
      )
    const frames = this.requireContext()
      .pages()
      .filter(isCpiPage)
      .flatMap((page) => page.frames())
      .filter((frame) => pathOf(frame.url()) === DETAIL_PATH)
    if (frames.length !== 1 || new URL(frames[0].url()).origin !== `https://${HOST}`)
      throw new Error('Origem do formulário CPI não confirmada.')
    const inspection = await this.uploadAdapter().inspect()
    return {
      ...identity,
      requestStatus: rows[0].situation || 'Não identificado na fila CPI',
      blockedReason: inspection.message,
      blockedCategory: inspection.category ?? 'VALIDATION_REQUIRED'
    }
  }

  private uploadAdapter(): CpiUploadAdapter {
    return new CpiUploadAdapter(() =>
      this.requireContext()
        .pages()
        .filter(isCpiPage)
        .flatMap((page) => page.frames())
    )
  }

  async selectAttachmentFile(
    identity: AttachmentIdentity,
    filename: string,
    bytes: Buffer
  ): Promise<void> {
    // Default capability is disabled, including file selection; page scripts
    // could otherwise transmit the PDF before an explicit save action.
    await this.uploadAdapter().selectFile(filename, bytes, async () => {
      validateAttachmentIdentity(identity, await this.inspectAttachmentTarget(identity))
    })
  }

  async open(): Promise<void> {
    if (this.context) {
      const existing = this.context.pages()[0]
      if (existing) await existing.bringToFront()
      return
    }

    process.env.PLAYWRIGHT_BROWSERS_PATH = 'I:\\DEV\\Cache\\Playwright'

    const { chromium } = await import('playwright')

    const profile = join(app.getPath('userData'), 'cpi-browser-profile')

    const context = await chromium.launchPersistentContext(profile, {
      headless: false,
      acceptDownloads: false,
      viewport: {
        width: 1280,
        height: 800
      }
    })

    this.context = context

    context.on('close', () => {
      if (this.context === context) {
        this.context = null
        this.bound = null
        this.onClosed()
      }
    })

    try {
      const page = context.pages()[0] ?? (await context.newPage())

      await page.goto(QUEUE_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 45000
      })
    } catch (error) {
      await this.close()

      throw new Error('Não foi possível abrir a página CPI.', { cause: error })
    }
  }

  async readQueue(refresh = false, applyFilter = true): Promise<CpiQueueSnapshot> {
    const context = this.requireContext()

    const page = context
      .pages()
      .find((candidate) => isCpiPage(candidate) && pathOf(candidate.url()) === QUEUE_PATH)

    if (!page) {
      return {
        state: 'LOGIN_REQUIRED',
        rows: [],
        visibleRows: 0,
        declaredTotal: null
      }
    }

    // The advanced-filter control on the authenticated queue is the readiness signal.
    const authenticated =
      (
        await Promise.all(
          page
            .frames()
            .map((frame) => frame.locator('a.link:has(i[title="Filtros Avançados"])').count())
        )
      ).reduce((a, b) => a + b, 0) === 1
    if (authenticated) {
      if (refresh) await this.filter.refresh(page)
      else if (applyFilter) await this.filter.ensure(page)
    } else {
      this.filter.reset(page)
      this.bound = null
      return { state: 'LOGIN_REQUIRED', rows: [], visibleRows: 0, declaredTotal: null }
    }

    const rows: CpiQueueRow[] = []
    let visibleRows = 0
    let declaredTotal: number | null = null

    for (const frame of page.frames().slice(0, 12)) {
      rows.push(...(await readQueueRows(frame)))
      visibleRows += await frame
        .locator(ROW_SELECTOR)
        .count()
        .catch(() => 0)

      if (declaredTotal !== null) continue

      const content = await frame
        .locator('body')
        .innerText({ timeout: 3000 })
        .catch(() => '')

      declaredTotal = parseQueueTotal(content)
    }

    const state = visibleRows > 0 ? 'HAS_RESEARCH' : declaredTotal === 0 ? 'EMPTY' : 'INDETERMINATE'

    return {
      state,
      rows: blockAmbiguousRows(rows),
      visibleRows,
      declaredTotal
    }
  }

  async openSelected(selected: CpiQueueRow): Promise<CpiOpenedIdentity> {
    const pages = this.requireContext()
      .pages()
      .filter((page) => isCpiPage(page) && pathOf(page.url()) === QUEUE_PATH)
    if (pages.length !== 1) throw new Error('Mantenha uma única fila CPI aberta.')
    const existing = this.requireContext()
      .pages()
      .flatMap((page) => page.frames())
      .filter((frame) => pathOf(frame.url()) === DETAIL_PATH)
    if (existing.length) {
      if (existing.length !== 1 || (await this.readOpenedReference()) !== selected.requestId)
        throw new Error(
          'Feche manualmente o formulário anterior antes de abrir outra solicitação. Alterações não salvas serão preservadas.'
        )
      const rows: CpiQueueRow[] = []
      for (const frame of pages[0].frames()) rows.push(...(await readQueueRows(frame)))
      const matches = blockAmbiguousRows(rows).filter(
        (row) => row.requestId === selected.requestId || row.researchId === selected.researchId
      )
      if (
        matches.length !== 1 ||
        matches[0].blockedReason ||
        matches[0].requestId !== selected.requestId ||
        matches[0].researchId !== selected.researchId ||
        matches[0].fingerprint !== selected.fingerprint
      )
        throw new Error('Linha modificada. Atualize a fila antes de abrir.')
      this.bound = { frame: existing[0], url: existing[0].url(), row: structuredClone(selected) }
      return this.inspectOpenedResearch()
    }
    const context = this.requireContext()
    const watched = new Set<Page>()
    let timer: ReturnType<typeof setTimeout> | undefined
    let onPage: (page: Page) => void = () => {}
    let onNavigation: (frame: Frame) => void = () => {}
    const opened = new Promise<void>((resolve, reject) => {
      onNavigation = (frame): void => {
        if (isCpiPage(frame.page()) && pathOf(frame.url()) === DETAIL_PATH) resolve()
      }
      onPage = (page): void => {
        watched.add(page)
        page.on('framenavigated', onNavigation)
        page.frames().forEach(onNavigation)
      }
      context.on('page', onPage)
      context.pages().forEach(onPage)
      timer = setTimeout(
        () => reject(new Error('Formulário CPI não confirmado no prazo esperado.')),
        10000
      )
    })
    try {
      // Subscribe before the single controlled click; no polling or retry clicks.
      await Promise.all([opened, clickQueueRow(pages[0].frames(), selected)])
      const frames = context
        .pages()
        .filter(isCpiPage)
        .flatMap((page) => page.frames())
        .filter((frame) => pathOf(frame.url()) === DETAIL_PATH)
      if (frames.length !== 1) throw new Error('Mantenha um único formulário CPI aberto.')
      await frames[0].waitForLoadState('domcontentloaded')
      if ((await this.readOpenedReference()) !== selected.requestId)
        throw new Error('Solicitação do formulário divergente. Operação bloqueada.')
      this.bound = { frame: frames[0], url: frames[0].url(), row: structuredClone(selected) }
      return await this.inspectOpenedResearch()
    } finally {
      clearTimeout(timer)
      context.off('page', onPage)
      watched.forEach((page) => page.off('framenavigated', onNavigation))
    }
  }

  async inspectOpenedResearch(): Promise<CpiOpenedIdentity> {
    const context = this.requireContext()

    const frames = context
      .pages()
      .filter(isCpiPage)
      .flatMap((page) => page.frames())
      .filter((frame) => pathOf(frame.url()) === DETAIL_PATH)

    if (frames.length !== 1) {
      throw new CpiControlError(
        frames.length === 0 ? 'SESSION_REQUIRED' : 'FRAME_AMBIGUOUS',
        'Abra manualmente uma unica pesquisa na CPI.'
      )
    }

    const locator = frames[0].locator(CPF_SELECTOR)

    if ((await locator.count()) !== 1) {
      throw new Error('Campo CPF nao encontrado no formulario CPI.')
    }

    const raw = await locator.innerText({
      timeout: 5000
    })

    const cpf = raw.replace(/\D/g, '')

    if (!isValidCpf(cpf)) {
      throw new Error('CPF invalido ou incompleto no formulario CPI.')
    }

    return {
      cpf,
      maskedCpf: `${cpf.slice(0, 3)}.***.***-${cpf.slice(-2)}`
    }
  }

  async hasQueueReference(reference: string): Promise<boolean> {
    if (!/^\d{1,15}$/.test(reference)) {
      throw new Error('Referência CPI inválida.')
    }

    const context = this.requireContext()

    const page = context
      .pages()
      .find((candidate) => isCpiPage(candidate) && pathOf(candidate.url()) === QUEUE_PATH)

    if (!page) {
      throw new Error('Mantenha a fila CPI aberta para conferir a referência.')
    }

    const rows: CpiQueueRow[] = []
    for (const frame of page.frames()) rows.push(...(await readQueueRows(frame)))
    const matches = rows.filter((row) => row.requestId === reference)
    return matches.length === 1 && !matches[0].blockedReason
  }

  async readOpenedReference(): Promise<string> {
    const context = this.requireContext()

    const frames = context
      .pages()
      .filter(isCpiPage)
      .flatMap((page) => page.frames())
      .filter((frame) => pathOf(frame.url()) === DETAIL_PATH)

    if (frames.length !== 1) {
      throw new CpiControlError(
        frames.length === 0 ? 'SESSION_REQUIRED' : 'FRAME_AMBIGUOUS',
        'Abra uma unica solicitacao no formulario CPI.'
      )
    }

    const content = await frames[0].locator('body').innerText({ timeout: 5000 })

    return extractCpiRequestId(content)
  }

  async checkOpenedResearch(expectedCpf: string): Promise<CpiIdentityCheck> {
    if (!isValidCpf(expectedCpf)) {
      throw new Error('O histórico selecionado não contém CPF válido.')
    }

    const context = this.requireContext()

    const frames = context
      .pages()
      .filter(isCpiPage)
      .flatMap((page) => page.frames())
      .filter((frame) => pathOf(frame.url()) === DETAIL_PATH)

    if (frames.length !== 1) {
      throw new CpiControlError(
        frames.length === 0 ? 'SESSION_REQUIRED' : 'FRAME_AMBIGUOUS',
        'Abra manualmente uma única pesquisa na CPI antes de conferir o CPF.'
      )
    }

    const locator = frames[0].locator(CPF_SELECTOR)

    if ((await locator.count()) !== 1) {
      throw new Error('Campo CPF não identificado no formulário da CPI.')
    }

    const raw = await locator.innerText({
      timeout: 5000
    })

    const cpf = raw.replace(/\D/g, '')

    if (!isValidCpf(cpf)) {
      throw new Error('A CPI apresentou um CPF inválido ou incompleto.')
    }

    return {
      match: cpf === expectedCpf
    }
  }

  async close(): Promise<void> {
    const context = this.context
    this.context = null
    this.bound = null

    if (context) {
      await context.close()
    }
  }

  private requireContext(): BrowserContext {
    if (!this.context) {
      throw new CpiControlError('SESSION_REQUIRED', 'A sessão CPI não está aberta.')
    }

    return this.context
  }
}
