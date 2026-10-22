/* eslint-disable @typescript-eslint/explicit-function-return-type */
// Browser plugin not available. Electron's Windows ACL prevents startup here.
// Exercise the existing generator with an Electron double and local Chromium.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { loadTs } from './load-ts.mjs'
const require = createRequire(import.meta.url)
const ts = require('typescript')
function load(path, overrides = {}) {
  const mod = { exports: {} }
  new Function(
    'exports',
    'require',
    'module',
    ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText
  )(mod.exports, (id) => overrides[id] ?? require(id), mod)
  return mod.exports
}
const browser = await chromium.launch({ headless: true })
let lastPage
class BrowserWindowDouble {
  destroyed = false
  webContents = {
    setWindowOpenHandler: () => {},
    printToPDF: async (options) => {
      assert.equal(options.pageSize, 'A4')
      assert.equal(options.printBackground, true)
      assert.equal(options.landscape, false)
      assert.ok((await lastPage.locator('body').innerText()).includes('529.982.247-25'))
      return lastPage.pdf({ ...options, format: options.pageSize })
    }
  }
  async loadURL(url) {
    assert.ok(url.startsWith('data:text/html;charset=utf-8,'))
    lastPage = await browser.newPage({ javaScriptEnabled: false })
    await lastPage.route('**/*', (route) => route.abort())
    await lastPage.goto(url)
  }
  isDestroyed() {
    return this.destroyed
  }
  destroy() {
    this.destroyed = true
  }
}
try {
  const html = load('src/main/report-html.ts')
  const { generatePersonPdf } = load('src/main/report-pdf.ts', {
    electron: { BrowserWindow: BrowserWindowDouble },
    './report-html': html
  })
  const { validateGeneratedPdf } = loadTs('src/main/cpi-attachment.ts')
  const result = {
    cpf: '52998224725',
    queriedAt: '2026-01-01T12:00:00Z',
    queryCode: null,
    sections: [
      {
        dataset: 'lawsuits',
        present: true,
        total: 0,
        returnedItems: 0,
        data: { total: 0, items: [] }
      }
    ]
  }
  const pdf = await generatePersonPdf(result)
  validateGeneratedPdf(pdf)
  console.log(
    'PASS: gerador existente com Electron simulado e bytes reais Chromium em A4; CPF completo no documento renderizado'
  )
} finally {
  await browser.close()
}
