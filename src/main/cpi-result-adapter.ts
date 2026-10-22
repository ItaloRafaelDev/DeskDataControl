import { createHash } from 'node:crypto'
import type { Frame } from 'playwright'
import type { CpiPdfReview } from '../shared/contracts'
import { extractCpiRequestId, CPI_CPF_SELECTOR } from './cpi-reference'

const fields = [
  ['select[name="id_pesq_status"]', 'Respondida'],
  ['select[name="id_pesquisador"]', 'Desk Data'],
  ['select[name="id_pesquisador_prim"]', 'Desk Data']
] as const
const saveSelector = 'form[name="form_cad"] a.button[onclick*="upd_pesq"]'
const normalize = (s: string): string => s.replace(/\*/g, '').replace(/\s+/g, ' ').trim()

// Based on cpi-research-result-controller and confirmed-save-controller in the ZIP.
export class CpiResultAdapter {
  private context: import('playwright').BrowserContext | null = null
  constructor(private readonly frame: () => Promise<Frame>) {}

  private result(review: CpiPdfReview): { selector: string; label: string } {
    if (review.classification === 'INDEFINIDO') throw new Error('Classificação exige revisão.')
    return review.classification === 'CONSTA_RESTRICAO'
      ? { selector: '#consta3', label: 'Sim, Consta Restrições' }
      : { selector: '#consta2', label: 'Há Informações' }
  }

  async prepare(review: CpiPdfReview): Promise<void> {
    const result = this.result(review)
    const frame = await this.frame()
    for (let attempt = 0; attempt < 3; attempt++) {
      for (const [selector, label] of fields) {
        const control = frame.locator(selector)
        await control.waitFor({ state: 'attached', timeout: 10000 })
        await control
          .locator('option')
          .filter({ hasText: label })
          .waitFor({ state: 'attached', timeout: 10000 })
        if ((await control.count()) !== 1)
          throw new Error('Campo obrigatório CPI ausente ou duplicado.')
        const options = control.locator('option')
        const matching = (await options.allTextContents()).filter((s) => normalize(s) === label)
        if (matching.length !== 1) throw new Error('Opção CPI não confirmada no portal.')
        const value = await options.evaluateAll((elements, expected) => {
          const option = elements.find(
            (e) => (e.textContent || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim() === expected
          )
          return (option as HTMLOptionElement | undefined)?.value
        }, label)
        if (!value) throw new Error('Valor de opção CPI inválido.')
        await control.selectOption(value, { timeout: 10000 })
      }
      const radio = frame.locator(result.selector)
      await radio.waitFor({ state: 'attached', timeout: 10000 })
      const label = frame.locator(`label[for="${result.selector.slice(1)}"]`)
      if (
        (await radio.count()) !== 1 ||
        (await label.count()) !== 1 ||
        normalize(await label.innerText()) !== result.label
      )
        throw new Error('Classificação CPI não confirmada no formulário.')
      await label.click({ timeout: 10000 })
      try {
        await this.check(review)
        await frame.page().waitForTimeout(250)
        await this.check(review)
        return
      } catch (error) {
        if (attempt === 2) throw error
      }
    }
  }

  async check(review: CpiPdfReview, frame?: Frame): Promise<void> {
    frame ??= await this.frame()
    for (const [selector, label] of fields) {
      const selected = frame.locator(`${selector} option:checked`)
      if (
        (await selected.count()) !== 1 ||
        normalize(await selected.innerText({ timeout: 5000 })) !== label
      )
        throw new Error('Campos CPI alterados após revisão.')
    }
    const result = this.result(review)
    const radio = frame.locator(result.selector)
    const label = frame.locator(`label[for="${result.selector.slice(1)}"]`)
    if (
      (await radio.count()) !== 1 ||
      !(await radio.isChecked()) ||
      (await label.count()) !== 1 ||
      normalize(await label.innerText()) !== result.label
    )
      throw new Error('Classificação CPI divergente.')
  }

  async save(review: CpiPdfReview): Promise<void> {
    const frame = await this.frame()
    await this.check(review, frame)
    const upload = frame.locator('#MainPage_FileUpload1')
    if ((await upload.count()) !== 1) throw new Error('Controle oficial de PDF alterado.')
    const selected = await upload.evaluate(async (element) => {
      const input = element as HTMLInputElement
      const file = input.files?.item(0)
      if (input.type !== 'file' || input.files?.length !== 1 || !file) return null
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
      return {
        name: file.name,
        size: file.size,
        hash: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
      }
    })
    if (
      !selected ||
      selected.name !== review.filename ||
      selected.size !== review.byteLength ||
      selected.hash !== review.sha256
    )
      throw new Error('PDF selecionado divergente do documento revisado.')
    const control = frame.locator(saveSelector)
    if ((await control.count()) !== 1)
      throw new Error('Ação Alterar não confirmada de forma única.')
    const page = frame.page()
    this.context = page.context()
    let accepted = false
    let unexpected = false
    // Install before click; a handler also dismisses unexpected dialogs safely.
    const handler = async (dialog: import('playwright').Dialog): Promise<void> => {
      if (
        !accepted &&
        dialog.type() === 'confirm' &&
        /deseja\s+realmente\s+alterar\s+esta\s+pesquisa/i.test(dialog.message())
      ) {
        accepted = true
        await dialog.accept()
      } else {
        unexpected = true
        await dialog.dismiss()
      }
    }
    page.on('dialog', handler)
    try {
      await control.click({ timeout: 10000 })
      if (!accepted || unexpected)
        throw new Error('Confirmação esperada da CPI ausente ou divergente.')
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 })
    } finally {
      page.off('dialog', handler)
    }
  }

  async verify(review: CpiPdfReview, detailUrl: string): Promise<void> {
    // Fresh authenticated GET of the exact detail URL bound when the selected row opened.
    // Do not trust the pre-submit DOM, queue disappearance or success text.
    const context = this.context
    if (!context) throw new Error('Contexto da grava��o CPI indispon�vel.')
    const page = await context.newPage()
    try {
      await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
      if (page.url() !== detailUrl) throw new Error('Sessão CPI não confirmada após gravação.')
      const frame = page.mainFrame()
      if (extractCpiRequestId(await frame.locator('body').innerText()) !== review.requestId)
        throw new Error('Solicitação divergente após gravação.')
      const cpf = frame.locator(CPI_CPF_SELECTOR)
      if ((await cpf.count()) !== 1 || (await cpf.innerText()).replace(/\D/g, '') !== review.cpf)
        throw new Error('CPF divergente após gravação.')
      await this.check(review, frame)
      // Discover the document through the portal, never synthesize an upload/download endpoint.
      const links = await frame
        .locator('a[href]')
        .evaluateAll(
          (elements, filename) =>
            elements
              .filter(
                (e) =>
                  (e.textContent || '').trim() === filename ||
                  e.getAttribute('download') === filename
              )
              .map((e) => (e as HTMLAnchorElement).href),
          review.filename
        )
      if (links.length !== 1) throw new Error('Anexo persistido não identificado de forma única.')
      const url = new URL(links[0])
      if (url.origin !== 'https://adm.cpicentral.com.br')
        throw new Error('Origem documental CPI divergente.')
      const response = await context.request.get(url.href, { timeout: 15000, maxRedirects: 0 })
      try {
        if (!response.ok()) throw new Error('Documento CPI indisponível.')
        const bytes = await response.body()
        if (
          bytes.length !== review.byteLength ||
          createHash('sha256').update(bytes).digest('hex') !== review.sha256
        )
          throw new Error('PDF persistido divergente do documento revisado.')
      } finally {
        await response.dispose()
      }
    } finally {
      await page.close()
    }
  }
}
