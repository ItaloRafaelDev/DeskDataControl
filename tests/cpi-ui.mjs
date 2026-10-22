/* eslint-disable @typescript-eslint/explicit-function-return-type */
// Browser plugin not available. Local Playwright with mocked IPC; no external services.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const root = resolve('out/renderer')
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + (req.url === '/' ? '/index.html' : req.url))
  if (!path.startsWith(root)) {
    res.writeHead(403).end()
    return
  }
  try {
    res.setHeader(
      'Content-Type',
      { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[extname(path)] ||
        'application/octet-stream'
    )
    res.end(await readFile(path))
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/*', (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()
  )
  await page.addInitScript(() => {
    const row = {
      requestId: '251870',
      researchId: '497718',
      checkboxId: 'pesq_497718',
      name: 'Pessoa fictícia',
      situation: 'Aguardando',
      fingerprint: 'fixture',
      blockedReason: null
    }
    const unique = {
      requestId: row.requestId,
      maskedCpf: '***.***.***-25',
      historyId: 'local',
      historyState: 'unique',
      candidates: [],
      preview: {
        classificationLabel: 'Há Informações',
        totalReceived: 0,
        totalDeclared: 0,
        criminal: 0,
        criminalWithDocument: 0,
        warnings: [],
        processes: []
      }
    }
    const state = JSON.parse(localStorage.getItem('fixture-state') || 'null') || {
      connected: false,
      busy: false,
      queue: null,
      selected: null,
      identity: null,
      research: null,
      pdf: null,
      attachment: null,
      message: '',
      step: 'Selecionar CPI'
    }
    window.fixture = { mode: 'unique', opens: 0, lookups: 0, queries: 0, pdfs: 0, listeners: 0 }
    let listener
    function publish() {
      localStorage.setItem('fixture-state', JSON.stringify(state))
      listener?.(structuredClone(state))
    }
    window.deskdata = {
      onActivity: () => () => {},
      getSavedAccess: async () => ({ available: false, username: null }),
      getSnapshot: async () => ({ appVersion: 'test', connected: true, balance: 10, activity: [] }),
      getOperation: async () => structuredClone(state),
      onOperation: (fn) => {
        listener = fn
        window.fixture.listeners++
        return () => {
          listener = null
          window.fixture.listeners--
        }
      },
      getPdfDirectory: async () => 'C:\\Relatorios',
      changePdfDirectory: async () => 'C:\\Relatorios',
      exportSelectedPdf: async () => true,
      listHistory: async () => [
        {
          id: 'local',
          cpf: '52998224725',
          createdAt: '2026-01-01',
          status: 'completed',
          datasets: [],
          hasResult: true
        }
      ],
      cpiListLinks: async () => [],
      cpiOpen: async () => {
        state.connected = true
        publish()
      },
      cpiClose: async () => {
        state.connected = false
        publish()
      },
      cpiReadQueue: async () => {
        state.queue = { state: 'HAS_RESEARCH', visibleRows: 1, declaredTotal: 1, rows: [row] }
        publish()
        return state.queue
      },
      cpiOpenSelected: async () => {
        window.fixture.opens++
        state.selected = row
        state.identity = { cpf: '52998224725', maskedCpf: '***.***.***-25' }
        state.pdf = null
        state.attachment = null
        state.research =
          window.fixture.mode === 'unique'
            ? unique
            : {
                ...unique,
                preview: null,
                historyId: null,
                historyState: window.fixture.mode,
                candidates:
                  window.fixture.mode === 'ambiguous'
                    ? [
                        { id: 'one', queryCode: 'A', createdAt: '2026-01-01' },
                        { id: 'two', queryCode: 'B', createdAt: '2026-02-01' }
                      ]
                    : []
              }
        state.step = 'Classificar e preparar PDF'
        publish()
        return state.research
      },
      cpiFindSelectedHistory: async () => {
        window.fixture.lookups++
        state.research = unique
        publish()
        return unique
      },
      cpiSelectedCpf: async () => '52998224725',
      cpiReviewResponse: async () => {
        window.fixture.pdfs++
        state.submission = 'reviewed'
        state.pdf = {
          reviewId: 'review',
          requestId: row.requestId,
          researchId: row.researchId,
          cpf: '52998224725',
          historyId: 'local',
          filename: 'Relatorio_Pesquisa_251870_497718.pdf',
          byteLength: 1024,
          requestStatus: 'Aguardando',
          blockedReason: 'Controle oficial de upload não identificado.'
        }
        publish()
        return state.pdf
      },
      cpiConfirmSubmission: async () => {
        state.submission = 'uncertain'
        state.attachment = {
          state: 'uncertain',
          message: 'Anexação incerta. Conferência manual necessária.',
          requestStatus: 'Aguardando'
        }
        publish()
        return state.attachment
      },
      queryPerson: async () => {
        window.fixture.queries++
        throw new Error('Consulta proibida no teste')
      },
      openHistory: async () => ({
        cpf: '52998224725',
        queriedAt: '2026-01-01',
        queryCode: 'Q-ABCDEF0123',
        sections: []
      }),
      exportPdf: async () => true
    }
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('heading', { name: 'Central de Pesquisas', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Conectar CPI', exact: true }).click()
  await page.getByRole('button', { name: 'Atualizar fila', exact: true }).click()
  await page.getByRole('button', { name: /Solicitação 251870/ }).click()
  await page.getByText('Resultado local recuperado e CPF conferido.').waitFor()
  assert.equal(await page.evaluate(() => window.fixture.opens), 1)
  assert.equal(await page.getByLabel('CPF', { exact: true }).inputValue(), '52998224725')
  await page.getByRole('button', { name: 'Configurações', exact: true }).click()
  await page.getByText('Diagnóstico e vínculos CPI', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Central de Pesquisas', exact: true }).click()
  await page.getByText('Resultado local recuperado e CPF conferido.').waitFor()
  assert.equal(await page.evaluate(() => window.fixture.listeners), 1)
  await page.locator('.central-history > summary').click()
  await page.getByRole('button', { name: 'Abrir', exact: true }).click()
  await page.getByText('Resultado local recuperado e CPF conferido.').waitFor()
  assert.equal(await page.evaluate(() => window.fixture.opens), 1)
  await page.getByRole('button', { name: 'Revisar resposta', exact: true }).click()
  await page.getByText(/PDF disponível: Relatorio_Pesquisa_/).waitFor()
  await page.getByRole('button', { name: 'Confirmar envio', exact: true }).click()
  await page.getByText('Anexação incerta. Conferência manual necessária.').waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Confirmar envio', exact: true }).isDisabled(),
    true
  )
  await page.getByRole('button', { name: 'Configurações', exact: true }).click()
  await page.getByRole('button', { name: 'Central de Pesquisas', exact: true }).click()
  assert.equal(
    await page.getByRole('button', { name: 'Confirmar envio', exact: true }).isDisabled(),
    true
  )
  await page.reload()
  await page.getByText('Resultado local recuperado e CPF conferido.').waitFor()
  assert.equal(await page.evaluate(() => window.fixture.queries), 0)
  assert.equal(await page.evaluate(() => window.fixture.listeners), 1)
  const heading = await page
    .getByRole('heading', { name: 'Central de Pesquisas', exact: true })
    .boundingBox()
  const header = await page.locator('.app-header').boundingBox()
  assert.ok(heading.y >= header.y + header.height)
  const left = await page.locator('.cpi-queue-area').boundingBox()
  const right = await page.locator('.cpi-selected-area').boundingBox()
  assert.ok(right.x > left.x)
  assert.equal(await page.title(), 'DeskData Control')
  await page.screenshot({ path: process.env.TEMP + '/deskdata-central-desktop.png' })
  await page.setViewportSize({ width: 600, height: 900 })
  const narrowLeft = await page.locator('.cpi-queue-area').boundingBox()
  const narrowRight = await page.locator('.cpi-selected-area').boundingBox()
  assert.ok(narrowRight.y >= narrowLeft.y + narrowLeft.height)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: process.env.TEMP + '/deskdata-central-responsive.png' })
  await page.evaluate(() => {
    window.fixture.mode = 'ambiguous'
  })
  await page.getByRole('button', { name: /Solicitação 251870/ }).click()
  await page.getByText('Mais de um resultado local. Selecione o resultado para revisar.').waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Revisar resposta', exact: true }).isDisabled(),
    true
  )
  await page.getByRole('button', { name: /Selecionar resultado A/ }).click()
  await page.getByText('Resultado local recuperado e CPF conferido.').waitFor()
  await page.evaluate(() => {
    window.fixture.mode = 'missing'
  })
  await page.getByRole('button', { name: /Solicitação 251870/ }).click()
  await page.getByText('Nenhum resultado local encontrado para este CPF.').waitFor()
  assert.equal(await page.getByLabel('CPF', { exact: true }).inputValue(), '52998224725')
  assert.equal(
    await page.getByRole('checkbox', { name: /Confirmo que a pesquisa/ }).isChecked(),
    false
  )
  assert.equal(
    await page.getByRole('button', { name: 'Executar pesquisa', exact: true }).isDisabled(),
    true
  )
  assert.equal(await page.evaluate(() => window.fixture.queries), 0)
  assert.deepEqual(errors, [])
  console.log(
    'PASS: central única, seleção automática, navegação por configurações e histórico, restauração sem consultas, um listener, anexação incerta bloqueada, desktop e responsivo sem erros'
  )
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
