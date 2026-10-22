/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'
import { loadTs } from './load-ts.mjs'
import { pdfFixture } from './pdf-fixture.mjs'
const { CpiResultAdapter } = loadTs('src/main/cpi-result-adapter.ts')
const browser = await chromium.launch({ headless: true })
const detailUrl =
  'https://adm.cpicentral.com.br/zpersEspecial/pesquisas/upd_cad/mod_tt_pesq_upd.aspx?fixture=497718'
const bytes = pdfFixture()
const review = {
  requestId: '251870',
  researchId: '497718',
  cpf: '52998224725',
  classification: 'HA_INFORMACOES',
  filename: 'Relatorio_Pesquisa_251870_497718.pdf',
  sha256: createHash('sha256').update(bytes).digest('hex'),
  byteLength: bytes.length
}
let persisted = false
let document = true
let wrongDocument = false
let dialog = 'Deseja realmente alterar esta pesquisa?'
let downloads = 0
try {
  const context = await browser.newContext()
  const html =
    () => `<div>Dados Solicitação: 251870</div><div class="cell txt">CPF:</div><div class="cell field">529.982.247-25</div>
    ${['id_pesquisador', 'id_pesquisador_prim'].map((name) => `<select name="${name}"><option value="0">Escolher</option><option value="1" ${persisted ? 'selected' : ''}>Desk Data</option></select>`).join('')}
    <select name="id_pesq_status"><option value="0">Aguardando</option><option value="1" ${persisted ? 'selected' : ''}>Respondida</option></select>
    <input type="radio" id="consta2" name="result" ${persisted ? 'checked' : ''}><label for="consta2">Há Informações</label>
    <input type="radio" id="consta3" name="result"><label for="consta3">Sim, Consta Restrições</label>
    <input type="file" id="MainPage_FileUpload1">
    <form name="form_cad"><a class="button" onclick="if(confirm('${dialog}')) window.upd_pesq=1">Alterar</a></form>
    ${persisted && document ? `<a href="/fixture-document.pdf">${review.filename}</a>` : ''}`
  await context.route('**/*', (route) =>
    new URL(route.request().url()).pathname.includes('mod_tt_pesq_upd.aspx')
      ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html() })
      : route.abort()
  )
  const page = await context.newPage()
  await page.goto(detailUrl)
  const fakeContext = {
    newPage: () => context.newPage(),
    request: {
      get: async (url) => {
        downloads++
        assert.equal(url, 'https://adm.cpicentral.com.br/fixture-document.pdf')
        return {
          ok: () => true,
          body: async () => (wrongDocument ? Buffer.from('wrong') : bytes),
          dispose: async () => {}
        }
      }
    }
  }
  const wrappedPage = new Proxy(page, {
    get: (target, key) =>
      key === 'context'
        ? () => fakeContext
        : typeof target[key] === 'function'
          ? target[key].bind(target)
          : target[key]
  })
  const frame = page.mainFrame()
  const wrappedFrame = new Proxy(frame, {
    get: (target, key) =>
      key === 'page'
        ? () => wrappedPage
        : typeof target[key] === 'function'
          ? target[key].bind(target)
          : target[key]
  })
  const adapter = new CpiResultAdapter(async () => wrappedFrame)
  await assert.rejects(
    () => adapter.prepare({ ...review, classification: 'INDEFINIDO' }),
    /revisão/
  )
  await adapter.prepare(review)
  await page.locator('label[for="consta2"]').evaluate((label) =>
    label.addEventListener(
      'click',
      () => {
        document.querySelector('[name="id_pesquisador_prim"]').value = '0'
      },
      { once: true }
    )
  )
  await adapter.prepare(review)
  await adapter.check(review)
  await page.locator('#consta2').evaluate((radio) => {
    const label = document.querySelector('label[for="consta2"]')
    const markup = radio.outerHTML + label.outerHTML
    radio.remove()
    label.remove()
    setTimeout(() => document.body.insertAdjacentHTML('beforeend', markup), 150)
  })
  await adapter.prepare(review)
  await page.locator('[name="id_pesquisador"]').selectOption('0')
  await assert.rejects(() => adapter.check(review), /alterados/)
  await adapter.prepare(review)
  await assert.rejects(() => adapter.save(review), /PDF selecionado/)
  await page
    .locator('#MainPage_FileUpload1')
    .setInputFiles({ name: review.filename, mimeType: 'application/pdf', buffer: bytes })
  await adapter.save(review)
  assert.equal(await page.evaluate(() => window.upd_pesq), 1)
  await assert.rejects(() => adapter.verify(review, detailUrl), /alterados/)
  persisted = true
  document = false
  await assert.rejects(() => adapter.verify(review, detailUrl), /Anexo persistido/)
  document = true
  wrongDocument = true
  await assert.rejects(() => adapter.verify(review, detailUrl), /PDF persistido/)
  wrongDocument = false
  await adapter.verify(review, detailUrl)
  assert.equal(downloads, 2)
  dialog = 'Confirmação inesperada'
  persisted = false
  await page.goto(detailUrl)
  await adapter.prepare(review)
  await page
    .locator('#MainPage_FileUpload1')
    .setInputFiles({ name: review.filename, mimeType: 'application/pdf', buffer: bytes })
  await assert.rejects(() => adapter.save(review), /ausente ou divergente/)
  assert.equal(await page.evaluate(() => window.upd_pesq), undefined)
  console.log(
    'PASS: campos reais, revisão indefinida, PDF alterado, diálogo esperado, clique sem persistência, leitura nova e hash documental; rede externa bloqueada'
  )
} finally {
  await browser.close()
}
