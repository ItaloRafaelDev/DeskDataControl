import type { Frame, Locator } from 'playwright'
import { CpiControlError, type CpiErrorCategory } from './cpi-diagnostics'
import { validateGeneratedPdf } from './cpi-attachment'

// Reused from the original cpi-selectors.ts. No guessed endpoint or fallback.
export const CPI_RESEARCH_PDF_UPLOAD_SELECTOR = '#MainPage_FileUpload1'
const ORIGIN = 'https://adm.cpicentral.com.br'
const DETAIL_PATH = '/zpersespecial/pesquisas/upd_cad/mod_tt_pesq_upd.aspx'

export interface CpiUploadInspection {
  category: CpiErrorCategory | null
  message: string
}

export class CpiUploadAdapter {
  constructor(
    private readonly frames: () => Frame[],
    private readonly options: { validatedSelection?: boolean } = {}
  ) {}

  private async control(): Promise<{ frame: Frame; locator: Locator }> {
    const frames = this.frames().filter((frame) => {
      try {
        const url = new URL(frame.url())
        return url.origin === ORIGIN && url.pathname.toLowerCase() === DETAIL_PATH
      } catch {
        return false
      }
    })
    if (frames.length === 0)
      throw new CpiControlError(
        'SESSION_REQUIRED',
        'Sessão expirada ou formulário CPI ausente. Abra a pesquisa e autentique novamente.'
      )
    if (frames.length !== 1)
      throw new CpiControlError(
        'FRAME_AMBIGUOUS',
        'Múltiplos frames CPI de detalhe. Mantenha um único formulário aberto.'
      )
    const locator = frames[0].locator(CPI_RESEARCH_PDF_UPLOAD_SELECTOR)
    const count = await locator.count()
    if (count === 0)
      throw new CpiControlError(
        'CONTROL_MISSING',
        'Anexação bloqueada: controle oficial de upload não identificado (#MainPage_FileUpload1) no frame do formulário atual.'
      )
    if (count !== 1)
      throw new CpiControlError(
        'CONTROL_AMBIGUOUS',
        'Controle oficial de upload duplicado no formulário CPI.'
      )
    if (
      !(await locator.evaluate(
        (element) =>
          element instanceof HTMLInputElement && element.type === 'file' && !element.webkitdirectory
      ))
    )
      throw new CpiControlError(
        'CONTROL_TYPE',
        'Controle oficial CPI não é um input de arquivo PDF individual.'
      )
    if (!(await locator.isEnabled()))
      throw new CpiControlError('CONTROL_DISABLED', 'Controle oficial de upload CPI desabilitado.')
    return { frame: frames[0], locator }
  }

  async inspect(): Promise<CpiUploadInspection> {
    try {
      await this.control()
      return {
        category: null,
        message:
          'Controle oficial identificado. Envio e evidência de persistência ainda exigem validação específica no portal.'
      }
    } catch (error) {
      if (error instanceof CpiControlError)
        return { category: error.category, message: error.message }
      return {
        category: 'FORM_CHANGED',
        message: 'Formulário CPI indisponível ou alterado durante a inspeção.'
      }
    }
  }

  // setInputFiles may trigger page scripts, so selection itself is gated.
  // Main never supplies validatedSelection: true. There is no save command.
  async selectFile(
    filename: string,
    bytes: Buffer,
    revalidate: () => Promise<void>
  ): Promise<{ state: 'ARQUIVO_SELECIONADO'; persisted: false }> {
    bytes = Buffer.from(bytes)
    const initial = await this.control()
    if (this.options.validatedSelection !== true)
      throw new CpiControlError(
        'VALIDATION_REQUIRED',
        'Seleção de arquivo CPI desabilitada até validação específica.'
      )
    if (!/^[a-zA-Z0-9_-]+\.pdf$/.test(filename))
      throw new CpiControlError('PDF_INVALID', 'Nome do PDF inválido.')
    validateGeneratedPdf(bytes)
    // Pin the verified node: a locator could resolve to a replacement form.
    const node = await initial.locator.elementHandle()
    if (!node) throw new CpiControlError('FORM_CHANGED', 'Formulário CPI alterado.')
    try {
      await revalidate()
      const current = await this.control()
      if (
        current.frame !== initial.frame ||
        !(await node.evaluate(
          (element) =>
            element.isConnected && document.querySelector('#MainPage_FileUpload1') === element
        ))
      )
        throw new CpiControlError('FORM_CHANGED', 'Formulário CPI alterado antes da seleção.')
      if (await node.evaluate((element) => (element as HTMLInputElement).files?.length))
        throw new CpiControlError(
          'VALIDATION_REQUIRED',
          'Já existe arquivo selecionado; confira o portal sem repetir preenchimento.'
        )
      await node.setInputFiles(
        { name: filename, mimeType: 'application/pdf', buffer: bytes },
        { timeout: 10000 }
      )
      await revalidate()
      const after = await this.control()
      const selected = await node.evaluate((element) => {
        const input = element as HTMLInputElement
        return {
          connected: input.isConnected,
          count: input.files?.length,
          name: input.files?.item(0)?.name,
          size: input.files?.item(0)?.size
        }
      })
      if (
        after.frame !== initial.frame ||
        !selected.connected ||
        selected.count !== 1 ||
        selected.name !== filename ||
        selected.size !== bytes.length
      )
        throw new CpiControlError(
          'FORM_CHANGED',
          'Seleção do PDF não confirmada no formulário original.'
        )
      return { state: 'ARQUIVO_SELECIONADO', persisted: false }
    } finally {
      await node.dispose()
    }
  }
}
