/* JavaScript fixture factories have no TypeScript return annotation. */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { loadTs as loadWithDependencies } from './load-ts.mjs'
const require = createRequire(import.meta.url)
const ts = require('typescript')
const source = readFileSync('src/main/cpi-queue.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText
const mod = { exports: {} }
new Function('exports', 'require', 'module', compiled)(mod.exports, require, mod)
const { readQueueRows, clickQueueRow } = mod.exports
const { chromium } = require('playwright')
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CPI_TEST_BROWSER || undefined
})
try {
  const page = await browser.newPage()
  await page.route('**/*', (route) => route.abort())
  const row = (request = '262119', research = '515516') =>
    `<div class="row linhas"><div data-label="ID Solicit.">${request}</div><div data-label="ID Pesquisa">${research}</div><div data-label="Nome">Pessoa fictícia</div><div data-label="Situação">Aguardando</div><input type="checkbox" id="pesq_${research}"><i title="Responder / Atualizar" onclick="document.body.dataset.clicked='yes'">Abrir</i></div>`
  await page.setContent(
    `<div><div class="row"><div>ID\n Solicit.</div><div>Nome</div><div>Seleção</div><div>Ação</div></div><div class="row linhas"><div>251870</div><div>Fictício</div><input type="checkbox" id="pesq_497718"><i title="Responder / Atualizar"></i></div></div>`
  )
  const [portalRow] = await readQueueRows(page.mainFrame())
  assert.equal(portalRow.requestId, '251870')
  assert.equal(portalRow.researchId, '497718')
  assert.equal(portalRow.blockedReason, null)
  console.log('PASS: divs com ID Solicit. 251870 e pesquisa 497718 na mesma linha')
  for (const [name, html, expected, blocked] of [
    ['uma solicitação válida', row(), 1, false],
    ['duas solicitações válidas', row() + row('262120', '515517'), 2, false],
    ['IDs duplicados', row() + row(), 2, true],
    [
      'rótulos de pesquisa duplicados',
      row().replace(
        '<div data-label="Nome">',
        '<div data-label="ID Pesquisa">515516</div><div data-label="Nome">'
      ),
      1,
      true
    ],
    ['IDs ausentes', row(''), 1, true],
    ['pesquisa ausente', row().replace('<input type="checkbox" id="pesq_515516">', ''), 1, true],
    [
      'dois controles na mesma linha',
      row().replace('<i title=', '<input type="checkbox" id="pesq_999"><i title='),
      1,
      true
    ],
    ['identificadores divergentes', row().replace('pesq_515516', 'pesq_999'), 1, true]
  ]) {
    await page.setContent(html)
    const rows = await readQueueRows(page.mainFrame())
    assert.equal(rows.length, expected)
    if (blocked) await assert.rejects(() => clickQueueRow([page.mainFrame()], rows[0]))
    else {
      assert.equal(rows[0].requestId, '262119')
      assert.equal(rows[0].researchId, '515516')
      await clickQueueRow([page.mainFrame()], rows[0])
      assert.equal(await page.locator('body').getAttribute('data-clicked'), 'yes')
    }
    console.log(`PASS: ${name}`)
  }
  await page.setContent(
    row() + row('262120', '515517').replace("dataset.clicked='yes'", "dataset.clicked='second'")
  )
  const multiple = await readQueueRows(page.mainFrame())
  const second = multiple.find(
    (item) => item.requestId === '262120' && item.researchId === '515517'
  )
  await clickQueueRow([page.mainFrame()], second)
  assert.equal(await page.locator('body').getAttribute('data-clicked'), 'second')
  console.log('PASS: seleção da segunda linha pelos IDs, sem abrir a primeira')
  await page.setContent(row())
  const [selected] = await readQueueRows(page.mainFrame())
  await page.setContent(row('262119', '999'))
  await assert.rejects(() => clickQueueRow([page.mainFrame()], selected))
  await page.setContent(row().replace('Pessoa fictícia', 'Outra pessoa fictícia'))
  await assert.rejects(() => clickQueueRow([page.mainFrame()], selected))
  assert.equal(await page.locator('body').getAttribute('data-clicked'), null)
  console.log('PASS: linha modificada entre leitura e clique')
  await page.setContent(
    row('251870', '497718').replace('<input type="checkbox" id="pesq_497718">', '') +
      row('', '497718')
  )
  const unrelated = await readQueueRows(page.mainFrame())
  assert.ok(unrelated.every((row) => row.blockedReason))
  await assert.rejects(() => clickQueueRow([page.mainFrame()], unrelated[0]))
  assert.equal(await page.locator('body').getAttribute('data-clicked'), null)
  console.log('PASS: IDs e controles em linhas distintas não são associados')
  await page.setContent(row('251870', '497718') + row('251871', '497719'))
  const queueSelection = (await readQueueRows(page.mainFrame()))[0]
  const { EventEmitter } = require('node:events')
  const fakePage = new EventEmitter()
  const frame = {
    url: () => 'https://adm.cpicentral.com.br/zpersEspecial/pesquisas/upd_cad/mod_tt_pesq_upd.aspx',
    page: () => fakePage,
    locator: (...args) => page.mainFrame().locator(...args),
    waitForLoadState: async () => {}
  }
  let detailOpen = false
  fakePage.url = () =>
    'https://adm.cpicentral.com.br/zpersEspecial/pesquisas/aguardando/mod_t_aguardando.aspx'
  fakePage.frames = () => (detailOpen ? [frame] : [])
  const context = new EventEmitter()
  context.pages = () => [fakePage]
  let openedRequest = '251870'
  const { CpiReadOnlySession } = loadTs('src/main/cpi-readonly.ts', {
    electron: {},
    './persons': loadTs('src/main/persons.ts'),
    './cpi-reference': loadTs('src/main/cpi-reference.ts'),
    './cpi-queue': {
      ...mod.exports,
      clickQueueRow: async () => {
        await page.setContent(
          `<h2>Dados Solicitação ${openedRequest}</h2><div class="cell txt">CPF:</div><div class="cell field">529.982.247-25</div>`
        )
        detailOpen = true
        fakePage.emit('framenavigated', frame)
      }
    }
  })
  const session = new CpiReadOnlySession()
  assert.equal(await session.isActive(), false)
  session.context = context
  const readQueue = session.readQueue.bind(session)
  session.readQueue = async () => ({ state: 'HAS_RESEARCH' })
  assert.equal(await session.isActive(), true)
  session.readQueue = async () => ({ state: 'LOGIN_REQUIRED' })
  assert.equal(await session.isActive(), false)
  session.readQueue = readQueue
  assert.equal((await session.openSelected(queueSelection)).cpf, '52998224725')
  assert.equal((await session.checkOpenedResearch('11144477735')).match, false)
  assert.equal(fakePage.listenerCount('framenavigated'), 0)
  detailOpen = false
  openedRequest = '251871'
  await assert.rejects(() => session.openSelected(queueSelection), /divergente/)
  assert.equal(context.listenerCount('page'), 0)
  await page.setContent(
    '<div class="cell txt">CPF:</div><div class="cell field">***.982.247-25</div>'
  )
  await assert.rejects(() => session.inspectOpenedResearch(), /invalido/)
  console.log(
    'PASS: abertura supervisionada, ID revalidado, CPF completo validado e divergente bloqueado em DOM fictício'
  )
  await page.setContent(
    '<h2>Dados Solicitação 251870</h2><div class="cell txt">CPF:</div><div class="cell field">529.982.247-25</div>'
  )
  session.readQueue = async () => ({ rows: [queueSelection] })
  const attachmentIdentity = {
    requestId: '251870',
    researchId: '497718',
    cpf: '52998224725',
    historyId: 'local'
  }
  assert.match(
    (await session.inspectAttachmentTarget(attachmentIdentity)).blockedReason,
    /controle oficial de upload não identificado/
  )
  await page.locator('body').evaluate((body) => {
    body.insertAdjacentHTML('beforeend', '<input type="file"><button>Alterar</button>')
  })
  assert.match(
    (await session.inspectAttachmentTarget(attachmentIdentity)).blockedReason,
    /controle oficial de upload não identificado/
  )
  await assert.rejects(
    () => session.inspectAttachmentTarget({ ...attachmentIdentity, researchId: '999' }),
    /IDs/
  )
  await assert.rejects(
    () => session.inspectAttachmentTarget({ ...attachmentIdentity, cpf: '11144477735' }),
    /CPF/
  )
  assert.equal(await page.locator('input[type="file"]').inputValue(), '')
  await page.locator('body').evaluate((body) => {
    body.insertAdjacentHTML('beforeend', '<input id="MainPage_FileUpload1" type="file">')
  })
  assert.match(
    (await session.inspectAttachmentTarget(attachmentIdentity)).blockedReason,
    /validação específica/
  )
  assert.equal(await page.locator('#MainPage_FileUpload1').inputValue(), '')
  await page.locator('body').evaluate((body) => {
    body.insertAdjacentHTML(
      'beforeend',
      '<div class="cell txt">CPF:</div><div class="cell field">111.444.777-35</div>'
    )
  })
  await assert.rejects(() => session.inspectOpenedResearch(), /Campo CPF/)
  await assert.rejects(() => session.checkOpenedResearch(attachmentIdentity.cpf), /Campo CPF/)
  detailOpen = false
  await assert.rejects(
    () => session.inspectAttachmentTarget(attachmentIdentity),
    (error) => error.category === 'SESSION_REQUIRED'
  )
  detailOpen = true
  const queuePage = await browser.newPage()
  await queuePage.setContent(row('251870', '497718'))
  const reusable = (await readQueueRows(queuePage.mainFrame()))[0]
  await page.setContent(
    '<h2>Dados Solicitação 251870</h2><div class="cell txt">CPF:</div><div class="cell field">529.982.247-25</div>'
  )
  fakePage.frames = () => [queuePage.mainFrame(), frame]
  assert.equal((await session.openSelected(reusable)).cpf, '52998224725')
  await assert.rejects(() => session.openSelected({ ...reusable, requestId: '999' }), /manualmente/)
  assert.equal(fakePage.listenerCount('framenavigated'), 0)
  console.log(
    'PASS: formulário do mesmo registro reutilizado; outro formulário exige fechamento manual'
  )
  console.log(
    'PASS: seletor oficial encontrado mantém envio bloqueado; CPF duplicado nunca usa first()'
  )
  console.log(
    'PASS: inspeção real do adaptador bloqueia upload ausente ou não validado, IDs/CPF divergentes; nenhum arquivo selecionado'
  )
} finally {
  await browser.close()
}

// Load the real main-process workflow with in-memory persistence, never a portal.
function loadTs(path, overrides = {}) {
  return loadWithDependencies(path, overrides)
}
const { resolveCpiHistory } = loadTs('src/main/cpi-workflow.ts')
const selection = { requestId: '251870', cpf: '52998224725', maskedCpf: '529.***.***-25' }
const record = {
  id: 'local',
  status: 'completed',
  result: { cpf: selection.cpf },
  queryCode: 'test',
  createdAt: '2026-01-01'
}
const deps = {
  readOpenedReference: async () => selection.requestId,
  checkOpenedResearch: async () => ({ match: true }),
  listLinks: async () => [],
  listResearch: async () => [record],
  readResearch: async () => record,
  preparePreview: () => ({ classificationLabel: 'INDEFINIDO' })
}
assert.equal((await resolveCpiHistory(selection, deps)).historyId, 'local')
assert.equal(
  (await resolveCpiHistory(selection, { ...deps, listResearch: async () => [] })).historyState,
  'missing'
)
const ambiguous = await resolveCpiHistory(selection, {
  ...deps,
  listResearch: async () => [record, { ...record, id: 'other' }]
})
assert.equal(ambiguous.historyState, 'ambiguous')
assert.equal(ambiguous.historyId, null)
assert.equal(ambiguous.preview, null)
assert.equal(
  (
    await resolveCpiHistory(
      selection,
      { ...deps, listResearch: async () => [record, { ...record, id: 'other' }] },
      'local'
    )
  ).historyId,
  'local'
)
await assert.rejects(() =>
  resolveCpiHistory(selection, { ...deps, readOpenedReference: async () => '999' })
)
await assert.rejects(() =>
  resolveCpiHistory(selection, { ...deps, checkOpenedResearch: async () => ({ match: false }) })
)
await assert.rejects(() =>
  resolveCpiHistory(selection, {
    ...deps,
    readResearch: async () => ({ ...record, result: { cpf: '11144477735' } })
  })
)
console.log(
  'PASS: histórico único, inexistente e ambíguo; seleção humana; divergências de solicitação e CPF'
)
