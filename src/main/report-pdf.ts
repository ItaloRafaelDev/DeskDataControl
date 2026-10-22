import { BrowserWindow } from 'electron'
import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { PersonQueryResult } from '../shared/contracts'
import { buildPersonReportHtml } from './report-html'

export async function reviewPersonPdf(bytes: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'deskdata-cpi-'))
  const path = join(directory, 'Relatorio.pdf')
  const window = new BrowserWindow({
    title: 'Conferir PDF CPI',
    width: 900,
    height: 900,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  })
  let cleaned = false
  const cleanup = async (): Promise<void> => {
    if (cleaned) return
    cleaned = true
    await rm(path, { force: true })
    await rmdir(directory).catch(() => undefined)
  }
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.on('closed', () => {
    void cleanup().catch(() => undefined)
  })
  try {
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
    await window.loadFile(path)
    window.show()
  } catch {
    window.destroy()
    await cleanup()
    throw new Error('Não foi possível abrir o PDF para conferência.')
  }
}

export async function savePersonPdf(result: PersonQueryResult, destination: string): Promise<void> {
  await writeFile(destination, await generatePersonPdf(result), { flag: 'wx', mode: 0o600 })
}

export async function generatePersonPdf(result: PersonQueryResult): Promise<Buffer> {
  const pdfWindow = new BrowserWindow({
    show: false,
    width: 960,
    height: 1200,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      javascript: false,
      webSecurity: true,
      backgroundThrottling: false
    }
  })

  pdfWindow.webContents.setWindowOpenHandler(() => ({
    action: 'deny'
  }))

  const deadline = setTimeout(() => {
    if (!pdfWindow.isDestroyed()) pdfWindow.destroy()
  }, 45000)
  try {
    const html = buildPersonReportHtml(result)

    await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

    const pdf = await pdfWindow.webContents.printToPDF({
      pageSize: 'A4',
      landscape: false,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="
          width:100%;
          margin:0 14mm;
          text-align:right;
          font:8px Arial,sans-serif;
          color:#64748b
        ">
          Página <span class="pageNumber"></span>
          de <span class="totalPages"></span>
        </div>
      `
    })

    if (pdf.length < 100 || pdf.subarray(0, 4).toString('ascii') !== '%PDF') {
      throw new Error('O Electron não gerou um PDF válido.')
    }

    return pdf
  } finally {
    clearTimeout(deadline)
    if (!pdfWindow.isDestroyed()) {
      pdfWindow.destroy()
    }
  }
}
