/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { loadTs } from './load-ts.mjs'
import { pdfFixture } from './pdf-fixture.mjs'
const { CpiUploadAdapter } = loadTs('src/main/cpi-upload-adapter.ts')
const browser = await chromium.launch({ headless: true })
const url = 'https://adm.cpicentral.com.br/zpersEspecial/pesquisas/upd_cad/mod_tt_pesq_upd.aspx'
const bytes = pdfFixture()
try {
  const page = await browser.newPage()
  await page.route('**/*', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<body></body>' })
  )
  await page.goto(url)
  const frames = () => page.frames()
  const adapter = new CpiUploadAdapter(frames)
  const control = '<input id="MainPage_FileUpload1" type="file">'
  for (const [name, html, code] of [
    ['ausente', '<input type="file">', 'CONTROL_MISSING'],
    ['duplicado', control + control, 'CONTROL_AMBIGUOUS'],
    ['tipo incorreto', '<input id="MainPage_FileUpload1" type="text">', 'CONTROL_TYPE'],
    ['desabilitado', control.replace('type=', 'disabled type='), 'CONTROL_DISABLED']
  ]) {
    await page.setContent(html)
    assert.equal((await adapter.inspect()).category, code)
    await assert.rejects(() => adapter.selectFile('report.pdf', bytes, async () => {}))
    console.log(`PASS: controle ${name} bloqueia seleção`)
  }
  await page.goto('https://adm.cpicentral.com.br/login.aspx')
  await page.setContent(control)
  assert.equal((await adapter.inspect()).category, 'SESSION_REQUIRED')
  console.log('PASS: sessão expirada bloqueia controle mesmo com ID conhecido')
  await page.goto(url)
  await page.setContent(control)
  await assert.rejects(
    () => adapter.selectFile('report.pdf', bytes, async () => {}),
    /desabilitada/
  )
  assert.equal(await page.locator('#MainPage_FileUpload1').inputValue(), '')
  console.log('PASS: gate de produção desabilitado por padrão')
  // Capability is supplied only by this isolated, network-mocked integration.
  const enabled = new CpiUploadAdapter(frames, { validatedSelection: true })
  const selection = await enabled.selectFile('report.pdf', bytes, async () => {})
  assert.equal(selection.state, 'ARQUIVO_SELECIONADO')
  assert.equal(selection.persisted, false)
  assert.equal(
    await page.locator('#MainPage_FileUpload1').evaluate((input) => input.files[0].size),
    bytes.length
  )
  await assert.rejects(() => enabled.selectFile('other.pdf', bytes, async () => {}), /selecionado/)
  console.log(
    'PASS: setInputFiles usa PDF em memória; seleção não confirma upload; não substitui seleção existente'
  )
  await page.setContent(control)
  await assert.rejects(
    () => enabled.selectFile('report.pdf', Buffer.from('invalid'), async () => {}),
    /PDF/
  )
  let checks = 0
  await assert.rejects(
    () =>
      enabled.selectFile('report.pdf', bytes, async () => {
        checks++
        if (checks === 1) await page.setContent(control)
      }),
    /alterado/
  )
  assert.equal(await page.locator('#MainPage_FileUpload1').inputValue(), '')
  console.log('PASS: formulário substituído durante revalidação não recebe arquivo')
  await page.setContent(control + '<iframe src="' + url + '"></iframe>')
  await page.locator('iframe').waitFor()
  await page.frames()[1].waitForLoadState()
  assert.equal((await adapter.inspect()).category, 'FRAME_AMBIGUOUS')
  console.log('PASS: múltiplos frames de detalhe bloqueiam seleção')
} finally {
  await browser.close()
}
