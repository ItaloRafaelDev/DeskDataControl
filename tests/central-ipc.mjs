/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function, @typescript-eslint/no-this-alias */
// Exercise real IPC handlers and encrypted stores. No Electron, portal or paid API.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { loadTs } from './load-ts.mjs'
import { pdfFixture } from './pdf-fixture.mjs'
const root = await mkdtemp(join(tmpdir(), 'central-ipc-'))
const key = randomBytes(32)
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => {
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, nonce)
    const bytes = Buffer.concat([cipher.update(text), cipher.final()])
    return Buffer.concat([nonce, cipher.getAuthTag(), bytes])
  },
  decryptString: (bytes) => {
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
    decipher.setAuthTag(bytes.subarray(12, 28))
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString()
  }
}
const row = {
  requestId: '251870',
  researchId: '497718',
  checkboxId: 'pesq_497718',
  name: 'Pessoa fictícia',
  situation: 'Aguardando',
  fingerprint: 'fixture',
  blockedReason: null
}
let queueRows = [row]
let openError = null
let active = false
let reference = row.requestId
let match = true
let sessionCount = 0
let chosen = root
let dialogs = 0
let choiceOptions
let saves = 0
let verifies = 0
class CpiSession {
  resultAdapter = {
    prepare: async () => {},
    check: async () => {},
    save: async () => {
      saves++
    }
  }
  async validateSubmission() {
    if (!match) throw Error('CPF divergente')
  }
  async selectSubmissionPdf() {}
  async verifySubmission() {
    verifies++
  }
  constructor() {
    sessionCount++
  }
  async isActive() {
    return active
  }
  async open() {
    active = true
  }
  async close() {
    active = false
  }
  async readQueue() {
    return { state: active ? 'HAS_RESEARCH' : 'LOGIN_REQUIRED', rows: queueRows }
  }
  async openSelected() {
    if (openError) throw new Error(openError)
    return { cpf: '52998224725', maskedCpf: '***.***.***-25' }
  }
  async readOpenedReference() {
    return reference
  }
  async checkOpenedResearch() {
    return { match }
  }
}
async function boot() {
  let ready
  let window
  const handlers = new Map()
  const app = new EventEmitter()
  Object.assign(app, {
    requestSingleInstanceLock: () => true,
    setName() {},
    setPath() {},
    getPath: () => root,
    getVersion: () => 'test',
    whenReady: () => ({
      then: (fn) => {
        ready = Promise.resolve().then(fn)
        return ready
      }
    })
  })
  class Window extends EventEmitter {
    constructor() {
      super()
      window = this
      this.webContents = new EventEmitter()
      Object.assign(this.webContents, { mainFrame: {}, send() {}, setWindowOpenHandler() {} })
    }
    isDestroyed() {
      return false
    }
    loadFile() {}
  }
  const overrides = {
    electron: {
      app,
      safeStorage,
      BrowserWindow: Window,
      ipcMain: {
        handle: (name, handler) => {
          assert.equal(handlers.has(name), false)
          handlers.set(name, handler)
        }
      },
      session: { defaultSession: { setPermissionRequestHandler() {} } },
      dialog: {
        showOpenDialog: async (_window, options) => {
          dialogs++
          choiceOptions = options
          return { canceled: !chosen, filePaths: chosen ? [chosen] : [] }
        }
      }
    },
    'node:fs': { mkdirSync() {} },
    '@electron-toolkit/utils': {
      electronApp: { setAppUserModelId() {} },
      optimizer: {},
      is: { dev: false }
    },
    './cpi-readonly': { CpiReadOnlySession: CpiSession },
    './report-pdf': {
      generatePersonPdf: async () => pdfFixture(),
      reviewPersonPdf: async () => {}
    }
  }
  const cache = new Map()
  loadTs('src/main/index.ts', overrides, cache)
  await ready
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
  return {
    invoke: async (name, ...args) => structuredClone(await handlers.get(name)(event, ...args)),
    history: loadTs('src/main/research-history.ts', overrides, cache),
    preferences: loadTs('src/main/local-preferences.ts', overrides, cache)
  }
}
const originalFetch = globalThis.fetch
let networkCalls = 0
globalThis.fetch = async () => {
  networkCalls++
  throw new Error('Network forbidden')
}
try {
  let app = await boot()
  await app.invoke('cpi:open')
  await app.invoke('cpi:queue')
  const record = await app.history.startResearch('52998224725', ['lawsuits'])
  await app.history.finishResearch(
    record,
    'completed',
    {
      cpf: record.cpf,
      queriedAt: '2026-01-01',
      queryCode: 'Q-ABCDEF0123',
      sections: [
        {
          dataset: 'lawsuits',
          present: true,
          total: 0,
          returnedItems: 0,
          data: { total: 0, items: [] }
        }
      ]
    },
    'Q-ABCDEF0123'
  )
  await app.invoke('cpi:open-selected', row)
  const before = await app.invoke('cpi:snapshot')
  assert.equal(before.research.historyId, record.id)
  await app.invoke('deskdata:history-open', record.id)
  const after = await app.invoke('cpi:snapshot')
  assert.deepEqual(after.selected, before.selected)
  assert.deepEqual(after.research, before.research)
  assert.equal(sessionCount, 1)
  await assert.rejects(
    () =>
      app.invoke('deskdata:person-query', {
        cpf: '52998224725',
        confirmed: true,
        datasets: ['lawsuits']
      }),
    /Reutilize/
  )
  await assert.rejects(
    () =>
      app.invoke('deskdata:person-query', {
        cpf: '11144477735',
        confirmed: true,
        datasets: ['lawsuits']
      }),
    /CPF divergente/
  )
  await app.invoke('cpi:queue')
  assert.equal((await app.invoke('cpi:snapshot')).research.historyId, record.id)
  const pending = await app.history.startResearch('11144477735', ['lawsuits'])
  await app.preferences.updatePreferences({
    operation: {
      ...after,
      busy: true,
      step: 'Anexando',
      pdf: { reviewId: 'obsolete' },
      attachment: { state: 'uncertain' }
    }
  })
  active = false
  app = await boot()
  const restored = await app.invoke('cpi:snapshot')
  assert.equal(restored.connected, false)
  assert.equal(restored.busy, false)
  assert.equal(restored.pdf, null)
  assert.equal(restored.research.historyId, record.id)
  assert.equal(restored.attachment.state, 'uncertain')
  assert.equal((await app.history.readResearch(pending.id)).status, 'pending')
  await assert.rejects(
    () => app.history.startResearch('11144477735', ['lawsuits']),
    /tentativa anterior/
  )
  assert.equal(networkCalls, 0)
  assert.equal(restored.selected, null)
  await assert.rejects(() => app.invoke('cpi:open-selected', row), /desconectada/)
  await app.invoke('cpi:open')
  await app.invoke('cpi:open-selected', row)
  queueRows = []
  await app.invoke('cpi:queue')
  const removed = await app.invoke('cpi:snapshot')
  assert.equal(removed.selected, null)
  assert.match(removed.message, /Não encontrada na fila atual/)
  assert.equal((await app.history.readResearch(record.id)).status, 'completed')
  queueRows = [{ ...row, researchId: '998', checkboxId: 'pesq_998' }]
  await app.invoke('cpi:queue')
  await assert.rejects(() => app.invoke('cpi:open-selected', row), /modificada/)
  queueRows = [row]
  await app.invoke('cpi:queue')
  openError = 'Falha simulada ao abrir'
  await assert.rejects(() => app.invoke('cpi:open-selected', row), /Falha simulada/)
  const failure = await app.invoke('cpi:snapshot')
  assert.equal(failure.status, 'failed')
  assert.doesNotMatch(failure.message, /Operação concluída/)
  openError = null
  await app.invoke('cpi:open-selected', row)
  assert.equal(await app.invoke('cpi:export-pdf'), true)
  assert.deepEqual(choiceOptions.properties, ['openDirectory'])
  assert.equal(dialogs, 1)
  assert.equal(await app.invoke('cpi:export-pdf'), true)
  assert.equal(dialogs, 1)
  const files = (await readdir(root)).filter((name) => name.endsWith('.pdf'))
  assert.equal(files.length, 2)
  chosen = null
  assert.equal(await app.invoke('deskdata:change-pdf-directory'), root)
  const other = await mkdtemp(join(root, 'other-'))
  chosen = other
  await app.invoke('deskdata:change-pdf-directory')
  app = await boot()
  assert.equal(await app.invoke('deskdata:pdf-directory'), other)
  assert.equal(
    (await readFile(join(root, 'preferences.bin'))).includes(Buffer.from('52998224725')),
    false
  )
  active = true
  await app.invoke('cpi:queue')
  await app.invoke('cpi:open-selected', row)
  reference = '999'
  await assert.rejects(() => app.invoke('cpi:find-selected-history'), /divergente/)
  reference = row.requestId
  match = false
  await assert.rejects(() => app.invoke('cpi:find-selected-history'), /divergente/)
  match = true
  active = false
  assert.equal((await app.invoke('cpi:snapshot')).connected, false)
  active = true
  await app.invoke('cpi:queue')
  await app.invoke('cpi:open-selected', row)
  await app.invoke('cpi:control', 'pause')
  await assert.rejects(
    () => app.invoke('cpi:process-selected', { confirmed: false, datasets: ['lawsuits'] }),
    /pausado/
  )
  await app.invoke('cpi:control', 'resume')
  await app.invoke('cpi:process-selected', { confirmed: false, datasets: ['lawsuits'] })
  const reviewed = await app.invoke('cpi:snapshot')
  assert.equal(reviewed.submission, 'reviewed')
  assert.equal(reviewed.pdf.historyId, record.id)
  await app.invoke('cpi:confirm-submission', reviewed.pdf.reviewId)
  assert.equal(saves, 1)
  assert.equal(verifies, 1)
  assert.equal((await app.invoke('cpi:snapshot')).submission, 'confirmed')
  assert.equal(
    (await app.history.readResearch(record.id)).cpiSubmissions[0].researchId,
    row.researchId
  )
  await assert.rejects(
    () => app.invoke('cpi:confirm-submission', reviewed.pdf.reviewId),
    /Revise novamente/
  )
  app = await boot()
  await assert.rejects(() => app.invoke('cpi:review-response'), /repetição bloqueada/)
  assert.equal(saves, 1)
  assert.equal(networkCalls, 0)
  console.log(
    'PASS: IPC real, navegação de histórico, restauração criptografada, tentativa pendente, IDs/CPF, sessão expirada, pasta nativa persistida e zero chamadas externas'
  )
} finally {
  globalThis.fetch = originalFetch
  await rm(root, { recursive: true, force: true })
}
