import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { loadTs } from './load-ts.mjs'
const { CpiQueueFilter } = loadTs('src/main/cpi-filter.ts')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.route('**/*', (route) => route.abort())
  await page.setContent(`<a class="link" onclick="window.opens=(window.opens||0)+1"><i title="Filtros Avançados">Filtrar</i></a>
    <a class="link" onclick="document.querySelector('#id_tipo_pesq_29').checked=false"><i title="Mostrar Tudo">Atualizar</i></a>
    <input type="checkbox" name="id_tipo_pesq" id="id_tipo_pesq_29">
    <input type="checkbox" name="id_tipo_pesq" id="id_tipo_pesq_1" checked>
    <div class="pa ac"><a class="button" onclick="window.applies=(window.applies||0)+1">Selecionar</a></div>`)
  const filter = new CpiQueueFilter()
  await Promise.all([filter.ensure(page), filter.ensure(page)])
  assert.equal(await page.locator('#id_tipo_pesq_29').isChecked(), true)
  assert.equal(await page.locator('#id_tipo_pesq_1').isChecked(), false)
  await filter.ensure(page)
  assert.equal(await page.evaluate(() => window.applies), 1)
  await page.locator('#id_tipo_pesq_29').uncheck()
  await filter.ensure(page)
  assert.equal(await page.evaluate(() => window.applies), 2)
  await filter.refresh(page)
  assert.equal(await page.evaluate(() => window.applies), 3)
  filter.reset(page)
  await filter.ensure(page)
  assert.equal(await page.evaluate(() => window.applies), 4)
  const context = await browser.newContext()
  let authenticated = false
  await context.route('**/*', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: authenticated
        ? `
    <a class="link" onclick="window.applies=(window.applies||0)+1"><i title="Filtros Avançados">Filtrar</i></a>
    <input type="checkbox" name="id_tipo_pesq" id="id_tipo_pesq_29">
    <div class="pa ac"><a class="button">Selecionar</a></div>
    <div>Mostrando: 0 a 0 (de 0 registros)</div>`
        : '<div>Login necessário</div>'
    })
  )
  const sessionPage = await context.newPage()
  const { CpiReadOnlySession } = loadTs('src/main/cpi-readonly.ts', {
    electron: { app: { getPath: () => '.' } },
    playwright: { chromium: { launchPersistentContext: async () => context } }
  })
  const session = new CpiReadOnlySession()
  await session.open()
  authenticated = true
  await sessionPage.reload()
  await session.readQueue()
  await sessionPage.waitForFunction(() => window.applies === 1)
  await session.readQueue()
  await session.isActive()
  assert.equal(await sessionPage.evaluate(() => window.applies), 1)
  await session.close()
  console.log(
    'PASS: filtro automático exclusivo, uma vez por sessão, perda detectada, Mostrar Tudo e nova sessão'
  )
} finally {
  await browser.close()
}
