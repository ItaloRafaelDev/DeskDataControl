import { CpiSubmissionWorkflow } from './cpi-submission'
import { restoreOperation } from './operational-state'
import { readPreferences, updatePreferences } from './local-preferences'
import { savePdfToDirectory } from './pdf-destination'
import { resolveCpiHistory } from './cpi-workflow'
import { app, BrowserWindow, dialog, ipcMain, session, type IpcMainInvokeEvent } from 'electron'
import { mkdirSync } from 'node:fs'
import { writeFile, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type { ActivityItem, DeskDataSnapshot } from '../shared/contracts'

import { isValidCpf, normalizeDatasets, queryPerson } from './persons'
import type { PersonQueryResult } from '../shared/contracts'

import { generatePersonPdf, reviewPersonPdf } from './report-pdf'
import { CpiAttachmentWorkflow } from './cpi-attachment'
import { CpiAttachmentStore } from './cpi-attachment-store'
import { listCpiLinks, saveCpiLink } from './cpi-links'
import { CpiReadOnlySession } from './cpi-readonly'
import {
  saveSavedCredentials,
  readSavedCredentials,
  getSavedAccessInfo,
  deleteSavedCredentials
} from './deskdata-credentials'
import { prepareCpiPreview } from './cpi-preview'
import {
  saveResearch,
  startResearch,
  finishResearch,
  listResearch,
  readResearch,
  historySummary,
  saveRecoveredResearch
} from './research-history'
import { recoverQueryByCode } from './queries-recovery'
import type { RecoverResult } from '../shared/contracts'

const API_ORIGIN = 'https://api.deskdata.com.br'
const DATA_DIRECTORY = 'I:\\DEV\\Data\\DeskDataControl'
const MAX_EVENTS = 20

let mainWindow: BrowserWindow | null = null
let token: string | null = null
let tokenExpiresAt: string | null = null
let balance: number | null = null
let balanceUpdatedAt: string | null = null
let running = false
let latestPdfResult: PersonQueryResult | null = null
const attemptedCpfs = new Set<string>()
let nextEventId = 0

const activity: ActivityItem[] = []

app.setName('DeskData Control')
mkdirSync(DATA_DIRECTORY, { recursive: true })
app.setPath('userData', DATA_DIRECTORY)
const ownsInstance = app.requestSingleInstanceLock()
if (!ownsInstance) app.quit()

function clearSession(): void {
  token = null
  tokenExpiresAt = null
  balance = null
  balanceUpdatedAt = null
  latestPdfResult = null
}

function isConnected(): boolean {
  const expiry = tokenExpiresAt ? Date.parse(tokenExpiresAt) : NaN

  if (token && Number.isFinite(expiry) && expiry > Date.now()) {
    return true
  }

  clearSession()
  return false
}

function snapshot(): DeskDataSnapshot {
  return {
    appVersion: app.getVersion(),
    connected: isConnected(),
    balance,
    balanceUpdatedAt,
    tokenExpiresAt,
    activity: [...activity]
  }
}

function report(level: ActivityItem['level'], message: string): void {
  const entry: ActivityItem = {
    id: ++nextEventId,
    at: new Date().toISOString(),
    level,
    message
  }

  activity.unshift(entry)

  if (activity.length > MAX_EVENTS) {
    activity.length = MAX_EVENTS
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('deskdata:activity', entry)
  }
}

function authorized(event: IpcMainInvokeEvent): void {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error('Origem IPC nÃ£o autorizada.')
  }
}

class DeskdataHttpError extends Error {
  constructor(readonly status: number) {
    const messages: Record<number, string> = {
      400: 'RequisiÃ§Ã£o rejeitada pela DeskData (400).',
      401: 'Credenciais invÃ¡lidas ou sessÃ£o expirada (401).',
      403: 'Acesso negado pela DeskData (403).',
      429: 'Limite de requisiÃ§Ãµes atingido (429).'
    }

    super(messages[status] ?? `DeskData respondeu HTTP ${status}.`)
  }
}

async function requestJson(
  route: '/auth' | '/credits',
  options: {
    method: 'GET' | 'POST'
    payload?: object
    bearer?: string
  }
): Promise<unknown> {
  const response = await fetch(`${API_ORIGIN}${route}`, {
    method: options.method,
    headers: {
      Accept: 'application/json',
      ...(options.payload ? { 'Content-Type': 'application/json' } : {}),
      ...(options.bearer ? { Authorization: `Bearer ${options.bearer}` } : {})
    },
    body: options.payload ? JSON.stringify(options.payload) : undefined,
    redirect: 'error',
    signal: AbortSignal.timeout(15000)
  })

  if (!response.ok) {
    throw new DeskdataHttpError(response.status)
  }

  return response.json() as Promise<unknown>
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Resposta da API fora do formato esperado.')
  }

  return value as Record<string, unknown>
}

async function loadBalance(): Promise<void> {
  if (!isConnected() || !token) {
    throw new Error('Conecte-se antes de consultar o saldo.')
  }

  report('info', 'Consultando saldo de cr\u00E9ditos')

  let result: Record<string, unknown>

  try {
    result = objectValue(
      await requestJson('/credits', {
        method: 'GET',
        bearer: token
      })
    )
  } catch (error) {
    if (error instanceof DeskdataHttpError && (error.status === 401 || error.status === 403)) {
      clearSession()
    }
    throw error
  }

  const data = objectValue(result.data)

  if (typeof data.balance !== 'number' || !Number.isSafeInteger(data.balance) || data.balance < 0) {
    throw new Error('A DeskData retornou um saldo invÃ¡lido.')
  }

  balance = data.balance
  balanceUpdatedAt = new Date().toISOString()

  report('success', 'Saldo consultado com sucesso')
}

async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  if (running) {
    throw new Error('JÃ¡ existe uma operaÃ§Ã£o em andamento.')
  }

  running = true

  try {
    return await operation()
  } catch (error) {
    report('error', 'A operaÃ§Ã£o nÃ£o foi concluÃ­da')
    throw error
  } finally {
    running = false
  }
}

async function connect(credentials: unknown): Promise<DeskDataSnapshot> {
  return exclusive(async () => {
    const data = objectValue(credentials)

    const username = typeof data.username === 'string' ? data.username.trim() : ''

    const password = typeof data.password === 'string' ? data.password : ''

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username) || username.length > 254) {
      throw new Error('Informe um e-mail vÃ¡lido.')
    }

    if (!password || password.length > 256) {
      throw new Error('Informe a senha da DeskData.')
    }

    clearSession()
    report('info', 'Autenticando na DeskData')

    const result = objectValue(
      await requestJson('/auth', {
        method: 'POST',
        payload: {
          username,
          password,
          expires_in: 1
        }
      })
    )

    const auth = objectValue(result.data)

    if (typeof auth.access_token !== 'string' || !auth.access_token) {
      throw new Error('Token nÃ£o encontrado na resposta.')
    }

    if (
      typeof auth.expires_at !== 'string' ||
      !Number.isFinite(Date.parse(auth.expires_at)) ||
      Date.parse(auth.expires_at) <= Date.now()
    ) {
      throw new Error('ExpiraÃ§Ã£o do token invÃ¡lida.')
    }

    token = auth.access_token
    tokenExpiresAt = auth.expires_at

    if (data.remember === true) {
      try {
        await saveSavedCredentials(username, password)
      } catch {
        clearSession()
        throw new Error(
          'A autenticacao foi aceita, mas nao foi possivel salvar o acesso com seguranca.'
        )
      }
    }

    report('success', 'Autentica\u00E7\u00E3o conclu\u00EDda')

    await loadBalance()

    return snapshot()
  })
}

async function refreshBalance(): Promise<DeskDataSnapshot> {
  return exclusive(async () => {
    await loadBalance()
    return snapshot()
  })
}

async function searchPerson(input: unknown): Promise<PersonQueryResult> {
  return exclusive(async () => {
    const data = objectValue(input)

    if (data.confirmed !== true) {
      throw new Error('Confirme a autorização antes da consulta.')
    }

    const cpf = typeof data.cpf === 'string' ? data.cpf.replace(/\D/g, '') : ''

    const datasets = normalizeDatasets(data.datasets)

    if (!isValidCpf(cpf)) {
      throw new Error('CPF inválido. Verifique os dígitos.')
    }

    if (!isConnected() || !token) {
      throw new Error('Conecte-se à DeskData.')
    }

    if (attemptedCpfs.has(cpf)) {
      throw new Error(
        'Este CPF já foi consultado ou teve uma tentativa nesta sessão. Não será enviado novamente.'
      )
    }

    if (balance === 0) {
      throw new Error('Saldo informado é zero. Atualize os créditos.')
    }

    latestPdfResult = null
    const research = await startResearch(cpf, datasets)
    attemptedCpfs.add(cpf)
    report('info', 'Consulta judicial enviada à DeskData')

    let result: PersonQueryResult

    try {
      result = await queryPerson(cpf, token, datasets)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''

      const code = message.match(/Q-[A-F0-9]{10}/)?.[0] ?? null

      try {
        await finishResearch(research, 'uncertain', null, code)
      } catch {
        report('error', 'Não foi possível atualizar o histórico da tentativa')
      }

      throw error
    }

    try {
      await finishResearch(research, 'completed', result, result.queryCode)
    } catch {
      report('error', 'Consulta concluída, mas o histórico não pôde ser salvo')
      throw new Error(
        'Consulta recebida, mas não persistida. Recupere pelo código da consulta antes de continuar.'
      )
    }
    latestPdfResult = result

    report('success', 'Consulta judicial concluída com resposta da API')

    try {
      await loadBalance()
    } catch {
      report('error', 'Consulta concluída, mas o saldo não pôde ser atualizado')
    }

    return {
      ...result,
      sections: result.sections.map((section) => ({
        ...section,
        data:
          section.data && Array.isArray(section.data.items)
            ? {
                ...section.data,
                items: section.data.items.slice(0, 100)
              }
            : section.data
      }))
    }
  })
}

async function recoverExistingQuery(input: unknown): Promise<RecoverResult> {
  return exclusive(async () => {
    const data = objectValue(input)
    const code = typeof data.queryCode === 'string' ? data.queryCode : ''

    if (!isConnected() || !token) {
      throw new Error('Conecte-se à DeskData.')
    }

    latestPdfResult = null

    report('info', 'Recuperando pesquisa existente')

    const response = await recoverQueryByCode(code, token)

    if (response.state === 'processing') {
      try {
        await saveRecoveredResearch(code, null)
      } catch {
        report('error', 'Não foi possível registrar a consulta pendente')
      }

      report('info', 'Pesquisa ainda em processamento')
      return response
    }

    latestPdfResult = response.result

    try {
      await saveRecoveredResearch(response.result.queryCode || code, response.result)
    } catch {
      report('error', 'Resultado recuperado, mas não foi possível salvar no histórico')
    }

    report('success', 'Pesquisa recuperada com sucesso')

    return {
      state: 'completed',
      result: {
        ...response.result,
        sections: response.result.sections.map((section) => ({
          ...section,
          data:
            section.data && Array.isArray(section.data.items)
              ? {
                  ...section.data,
                  items: section.data.items.slice(0, 100)
                }
              : section.data
        }))
      }
    }
  })
}

async function exportReport(): Promise<boolean> {
  return exclusive(async () => {
    if (!latestPdfResult || !mainWindow) {
      throw new Error('Nenhuma pesquisa disponível para exportação.')
    }

    const saved = await saveReport(latestPdfResult)
    if (!saved) return false

    report('success', 'Relatório PDF salvo com sucesso')

    return true
  })
}

async function choosePdfDirectory(unavailable = false): Promise<string | null> {
  if (!mainWindow) throw new Error('Janela principal indisponível.')
  const answer = await dialog.showOpenDialog(mainWindow, {
    title: unavailable
      ? 'Pasta indisponível ou sem permissão. Escolha outro destino'
      : 'Escolher pasta dos relatórios PDF',
    properties: ['openDirectory'],
    defaultPath: (await readPreferences()).pdfDirectory ?? app.getPath('documents'),
    buttonLabel: 'Usar esta pasta'
  })
  return answer.canceled ? null : (answer.filePaths[0] ?? null)
}

async function saveReport(result: PersonQueryResult): Promise<boolean> {
  return !!(await savePdfToDirectory(await generatePersonPdf(result), {
    readDirectory: async () => (await readPreferences()).pdfDirectory,
    saveDirectory: (pdfDirectory) => updatePreferences({ pdfDirectory }),
    chooseDirectory: choosePdfDirectory
  }))
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 840,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f7f8fa',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({
    action: 'deny'
  }))

  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  if (!ownsInstance) return
  electronApp.setAppUserModelId('br.deskdata.control')

  session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false))

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('deskdata:snapshot', (event) => {
    authorized(event)
    return snapshot()
  })

  ipcMain.handle('deskdata:connect', (event, credentials: unknown) => {
    authorized(event)
    return connect(credentials)
  })

  ipcMain.handle('deskdata:balance', (event) => {
    authorized(event)
    return refreshBalance()
  })

  ipcMain.handle('deskdata:person-query', (event, request: unknown) => {
    authorized(event)
    return runCpi(async () => {
      const input = objectValue(request)
      const useCpi = input.cpiContext === true || selectedIdentity() !== null
      if (useCpi) {
        const selectedCpi = selectedIdentity()
        if (!selectedCpi || String(input.cpf).replace(/\D/g, '') !== selectedCpi.cpf)
          throw new Error('CPF divergente da seleção CPI.')
        const existing = await selectedHistory(operation.research?.historyId ?? undefined)
        if (existing.historyState !== 'missing')
          throw new Error('Reutilize ou revise o resultado do histórico local.')
        operation.step = 'Consulta DeskData pendente'
        await persistOperation()
      }
      checkpoint()
      const result = await searchPerson(request)
      if (useCpi) {
        try {
          await selectedHistory()
        } catch {
          operation.message =
            'Resultado salvo no histórico. Revalide o formulário CPI para continuar.'
        }
      }
      return result
    })
  })

  ipcMain.handle('deskdata:recover', (event, request: unknown) => {
    authorized(event)
    return runCpi(async () => {
      const result = await recoverExistingQuery(request)
      if (selectedIdentity()) {
        try {
          await selectedHistory(operation.research?.historyId ?? undefined)
        } catch {
          operation.message = 'Recuperação concluída. Revalide o formulário CPI para continuar.'
        }
      }
      return result
    })
  })

  ipcMain.handle('deskdata:history-list', async (event) => {
    authorized(event)

    const records = await listResearch()
    return records.map(historySummary)
  })

  ipcMain.handle('deskdata:history-open', async (event, id: unknown) => {
    authorized(event)

    if (cpiBusy) throw new Error('Aguarde a operação CPI atual.')
    return exclusive(async () => {
      if (typeof id !== 'string') {
        throw new Error('Identificador inválido.')
      }

      const record = await readResearch(id)

      if (!record.result) {
        throw new Error('Esta consulta ainda não possui resultado armazenado.')
      }

      latestPdfResult = record.result

      return {
        ...record.result,
        sections: record.result.sections.map((section) => ({
          ...section,
          data:
            section.data && Array.isArray(section.data.items)
              ? {
                  ...section.data,
                  items: section.data.items.slice(0, 100)
                }
              : section.data
        }))
      }
    })
  })

  ipcMain.handle('deskdata:cpi-preview', async (event, id: unknown) => {
    authorized(event)

    if (running) {
      throw new Error('Aguarde a conclusão da operação atual.')
    }

    if (typeof id !== 'string') {
      throw new Error('Identificador de pesquisa inválido.')
    }

    const research = await readResearch(id)

    if (!research.result) {
      throw new Error('A pesquisa selecionada não possui resultado armazenado.')
    }

    return prepareCpiPreview(research.result)
  })

  const cpiSession = new CpiReadOnlySession(() => {
    invalidateSelection('Sessão encerrada. Reconecte e atualize a fila.')
    operation.connected = false
    operation.status = 'disconnected'
    operation.queue = null
    publishOperation()
    void persistOperation().catch(() => report('error', 'Não foi possível persistir o estado CPI'))
  })
  let operation = restoreOperation()
  let selectionToRevalidate: import('../shared/contracts').CpiQueueRow | null = null
  try {
    const saved = (await readPreferences()).operation
    selectionToRevalidate = saved?.selected ?? null
    operation = restoreOperation(saved ?? undefined)
  } catch {
    operation.message =
      'Não foi possível recuperar o estado local. Verifique o armazenamento nas configurações.'
  }
  function selectedIdentity():
    (import('./cpi-workflow').CpiSelection & { researchId: string }) | null {
    return operation.selected && operation.identity
      ? {
          requestId: operation.selected.requestId,
          researchId: operation.selected.researchId,
          ...operation.identity
        }
      : null
  }
  let cpiBusy = false

  function publishOperation(): void {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('cpi:state', operation)
  }
  async function persistOperation(): Promise<void> {
    await updatePreferences({ operation: structuredClone(operation) })
    publishOperation()
  }
  function invalidateSelection(message: string): void {
    operation.selected = null
    operation.identity = null
    operation.pdf = null
    operation.message = message
    // Research, attachments and durable stores remain available for review.
  }
  async function inspectSession(): Promise<void> {
    operation.connected = await cpiSession.isActive()
    if (!operation.connected) {
      operation.queue = null
      invalidateSelection('Sessão CPI desconectada ou expirada. Conecte e atualize a fila.')
      operation.status = 'disconnected'
    }
  }
  async function synchronizeQueue(): Promise<import('../shared/contracts').CpiQueueSnapshot> {
    const previous = operation.selected ?? selectionToRevalidate
    selectionToRevalidate = null
    operation.status = 'syncing'
    operation.queue = null
    publishOperation()
    try {
      const queue = await cpiSession.readQueue(true)
      operation.connected = ['HAS_RESEARCH', 'EMPTY'].includes(queue.state)
      operation.queue = queue
      if (!operation.connected) {
        invalidateSelection('Sessão ou fila CPI não confirmada. Faça login e atualize a fila.')
        operation.status = queue.state === 'LOGIN_REQUIRED' ? 'disconnected' : 'uncertain'
        return queue
      }
      if (previous) {
        const matches = queue.rows.filter(
          (row) => row.requestId === previous.requestId || row.researchId === previous.researchId
        )
        if (
          matches.length === 1 &&
          !matches[0].blockedReason &&
          matches[0].requestId === previous.requestId &&
          matches[0].researchId === previous.researchId
        ) {
          operation.selected = matches[0]
          operation.identity = null
          operation.pdf = null
        } else {
          invalidateSelection(
            'Não encontrada na fila atual. Histórico, PDF e vínculo preservados. Selecione uma solicitação após atualizar a fila.'
          )
        }
      }
      operation.status = 'ready'
      return queue
    } catch (error) {
      invalidateSelection('Falha na sincronização. Atualize a fila antes de abrir.')
      operation.connected = false
      throw error
    }
  }
  ipcMain.handle('cpi:snapshot', async (event) => {
    authorized(event)
    if (!cpiBusy) await inspectSession()
    return { ...operation, busy: cpiBusy || operation.busy }
  })
  ipcMain.handle('deskdata:pdf-directory', async (event) => {
    authorized(event)
    return (await readPreferences()).pdfDirectory
  })
  ipcMain.handle('deskdata:change-pdf-directory', (event) => {
    authorized(event)
    return exclusive(async () => {
      let unavailable = false
      for (;;) {
        const directory = await choosePdfDirectory(unavailable)
        if (!directory) break
        const probe = join(directory, `.relatorio-${randomUUID()}.tmp`)
        try {
          await writeFile(probe, '', { flag: 'wx', mode: 0o600 })
        } catch (error) {
          if (
            !error ||
            typeof error !== 'object' ||
            !('code' in error) ||
            !['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR', 'EROFS'].includes(String(error.code))
          )
            throw error
          unavailable = true
          continue
        }
        await rm(probe)
        await updatePreferences({ pdfDirectory: directory })
        break
      }
      return (await readPreferences()).pdfDirectory
    })
  })
  ipcMain.handle('cpi:export-pdf', (event) => {
    authorized(event)
    return runCpi(async () => {
      const selectedCpi = selectedIdentity()
      const selectedHistoryId = operation.research?.historyId
      if (!selectedCpi || !selectedHistoryId) throw new Error('Selecione um resultado local.')
      const record = await readResearch(selectedHistoryId)
      if (!record.result || record.result.cpf.replace(/\D/g, '') !== selectedCpi.cpf)
        throw new Error('CPF do resultado local divergente.')
      return saveReport(record.result)
    })
  })

  async function runCpi<T>(action: () => Promise<T>): Promise<T> {
    if (cpiBusy || running) {
      throw new Error('Existe outra operação em andamento.')
    }

    cpiBusy = true
    operation.busy = true
    operation.status = 'running'
    operation.message = ''
    try {
      await persistOperation()
      const result = await action()
      if (operation.status === 'running')
        operation.status =
          operation.submission === 'uncertain'
            ? 'uncertain'
            : operation.connected
              ? 'completed'
              : 'disconnected'
      if (!operation.message) operation.message = 'Operação concluída.'
      return result
    } catch (error) {
      operation.status = 'failed'
      operation.message =
        (error instanceof Error ? error.message : 'Falha na operação CPI.') +
        ' Revalide a sessão e atualize a fila antes de tentar novamente.'
      if (/Linha modificada|ausente|duplicada|Controle CPI/.test(operation.message)) {
        invalidateSelection(operation.message)
        operation.queue = null
      }
      throw error
    } finally {
      try {
        operation.busy = false
        await persistOperation()
      } finally {
        operation.busy = false
        cpiBusy = false
        publishOperation()
      }
    }
  }
  async function selectedHistory(
    historyId?: string
  ): Promise<import('../shared/contracts').CpiSelectedResearch> {
    const selectedCpi = selectedIdentity()
    if (!selectedCpi) throw new Error('Abra uma solicitação selecionada primeiro.')
    const resolved = await resolveCpiHistory(
      selectedCpi,
      {
        readOpenedReference: () => cpiSession.readOpenedReference(),
        checkOpenedResearch: (cpf) => cpiSession.checkOpenedResearch(cpf),
        listLinks: listCpiLinks,
        listResearch,
        readResearch,
        preparePreview: prepareCpiPreview
      },
      historyId ?? operation.research?.historyId ?? undefined
    )
    const previous = operation.research
    operation.research = resolved
    if (
      previous?.historyId !== resolved.historyId ||
      previous?.historyState !== resolved.historyState
    ) {
      operation.step = resolved.historyId
        ? 'Classificar e preparar PDF'
        : 'Consultar ou recuperar DeskData'
    }
    if (resolved.historyId) {
      await saveCpiLink({
        cpiReference: selectedCpi.requestId,
        historyId: resolved.historyId,
        cpf: selectedCpi.cpf,
        queryCode: resolved.preview?.queryCode ?? null,
        verifiedAt: new Date().toISOString(),
        status: 'pending_review'
      })
    }
    return resolved
  }
  const attachmentStore = new CpiAttachmentStore(join(app.getPath('userData'), 'cpi-attachments'))
  const attachments = new CpiAttachmentWorkflow({
    resolve: async () => {
      const selectedCpi = selectedIdentity()
      const selectedHistoryId = operation.research?.historyId
      if (!selectedCpi || !selectedHistoryId)
        throw new Error('Selecione o histórico da pesquisa CPI primeiro.')
      const selected = await selectedHistory(selectedHistoryId)
      if (!selected.historyId || selected.historyState !== 'unique')
        throw new Error('Histórico CPI não confirmado.')
      const stored = await readResearch(selected.historyId)
      if (
        !stored.result ||
        stored.status !== 'completed' ||
        stored.cpf.replace(/\D/g, '') !== selectedCpi.cpf
      )
        throw new Error('CPF ou resultado local divergente.')
      // Persist the operator-selected association; never use latestPdfResult.
      await saveCpiLink({
        cpiReference: selectedCpi.requestId,
        historyId: stored.id,
        cpf: selectedCpi.cpf,
        queryCode: stored.result.queryCode,
        verifiedAt: new Date().toISOString(),
        status: 'pending_review'
      })
      return {
        identity: {
          requestId: selectedCpi.requestId,
          researchId: selectedCpi.researchId,
          cpf: selectedCpi.cpf,
          historyId: stored.id
        },
        result: stored.result
      }
    },
    inspect: (identity) => cpiSession.inspectAttachmentTarget(identity),
    generate: generatePersonPdf,
    review: reviewPersonPdf,
    confirm: async (review) => {
      if (!mainWindow) throw new Error('Janela principal indisponível.')
      const answer = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: 'Confirmar anexação CPI',
        message: 'Conferiu o PDF e confirma sua anexação a esta pesquisa?',
        detail: `Solicitação: ${review.requestId}\nPesquisa: ${review.researchId}\nCPF completo: ${review.cpf}\nHistórico: ${review.historyId}\nClassificação: ${review.classification}\nArquivo: ${review.filename}\nSHA-256: ${review.sha256}\nNenhum comando de finalização será acionado.`,
        buttons: ['Cancelar', 'Conferi o PDF e confirmo anexar'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      return answer.response === 1
    },
    // No upload adapter is enabled until the real official control, research
    // binding, destination and persisted-document evidence have been validated.
    hasDocument: async () => {
      throw new Error('Confirmação documental no portal ainda não validada.')
    },
    upload: (target, filename, bytes) => cpiSession.selectAttachmentFile(target, filename, bytes),
    store: attachmentStore,
    diagnose: (event) => console.info('[CPI]', JSON.stringify(event))
  })

  function checkpoint(): void {
    if (operation.control === 'paused') throw new Error('Workflow pausado. Retome para continuar.')
    if (operation.control === 'cancelled')
      throw new Error('Workflow cancelado. Reabra a seleção para revisar novamente.')
  }
  let stageStarted = performance.now()
  const submission = new CpiSubmissionWorkflow({
    resolve: async () => {
      const selected = await selectedHistory()
      const identity = selectedIdentity()
      if (!identity || !selected.historyId || selected.historyState !== 'unique')
        throw new Error('Selecione um resultado local único antes de revisar.')
      const record = await readResearch(selected.historyId)
      if (!record.result || (record.cpf && record.cpf.replace(/\D/g, '') !== identity.cpf))
        throw new Error('Resultado local ou CPF do histórico divergente.')
      return { identity: { ...identity, historyId: record.id }, result: record.result }
    },
    validate: (identity) => cpiSession.validateSubmission(identity),
    generate: generatePersonPdf,
    review: reviewPersonPdf,
    prepareForm: (review) => cpiSession.resultAdapter.prepare(review),
    checkForm: (review) => cpiSession.resultAdapter.check(review),
    select: (review, bytes) => cpiSession.selectSubmissionPdf(review, bytes),
    save: async (review) => {
      await cpiSession.validateSubmission(review)
      await cpiSession.resultAdapter.save(review)
    },
    verify: (review) => cpiSession.verifySubmission(review),
    record: async (review) => {
      const record = await readResearch(review.historyId)
      if (record.result?.cpf.replace(/\D/g, '') !== review.cpf)
        throw new Error('CPF do histórico divergente após gravação.')
      await saveResearch({
        ...record,
        updatedAt: new Date().toISOString(),
        cpiSubmissions: [
          ...(record.cpiSubmissions ?? []),
          {
            requestId: review.requestId,
            researchId: review.researchId,
            sha256: review.sha256,
            confirmedAt: new Date().toISOString()
          }
        ]
      })
      await saveCpiLink({
        cpiReference: review.requestId,
        historyId: review.historyId,
        cpf: review.cpf,
        queryCode: record.queryCode,
        verifiedAt: new Date().toISOString(),
        status: 'submitted'
      })
    },
    store: attachmentStore,
    checkpoint,
    stage: async (state) => {
      operation.submission = state
      const labels = {
        idle: 'Selecionar CPI',
        processing: 'Processando pesquisa selecionada',
        reviewed: 'Revisar resposta e confirmar envio',
        selecting_file: 'Selecionando PDF',
        file_selected: 'Arquivo selecionado — persistência pendente',
        saving: 'Gravando resposta CPI',
        verifying: 'Verificando persistência no portal',
        confirmed: 'Resposta e PDF confirmados no portal',
        uncertain: 'Resposta incerta — reconciliação manual necessária'
      }
      operation.step = labels[state]
      operation.message = labels[state]
      console.info(
        '[CPI]',
        JSON.stringify({ stage: state, durationMs: Math.max(0, performance.now() - stageStarted) })
      )
      stageStarted = performance.now()
      await persistOperation()
    }
  })
  ipcMain.handle('cpi:control', async (event, action: unknown) => {
    authorized(event)
    if (typeof action !== 'string' || !['pause', 'resume', 'cancel'].includes(action))
      throw new Error('Controle inválido.')
    if (action === 'resume' && ['uncertain', 'confirmed'].includes(operation.submission ?? ''))
      throw new Error('Envio bloqueado. Confira a persistência no portal; não repita a gravação.')
    operation.control = action === 'pause' ? 'paused' : action === 'cancel' ? 'cancelled' : 'active'
    operation.status =
      action === 'pause' ? 'paused' : operation.connected ? 'ready' : 'disconnected'
    operation.message =
      action === 'pause'
        ? 'Pausa solicitada; a etapa em andamento será preservada.'
        : action === 'cancel'
          ? 'Cancelamento solicitado; efeitos já enviados serão verificados.'
          : 'Workflow retomado. Revalide a resposta antes de enviar.'
    if (action !== 'pause') {
      submission.clear()
      operation.pdf = null
    }
    await persistOperation()
  })
  ipcMain.handle('cpi:process-selected', (event, request: unknown) => {
    authorized(event)
    return runCpi(async () => {
      checkpoint()
      if (['confirmed', 'uncertain'].includes(operation.submission ?? ''))
        throw new Error(
          'Resposta concluída ou incerta; repetição bloqueada. Confira o portal e o histórico.'
        )
      const input = objectValue(request)
      const selected = await selectedHistory()
      if (selected.historyState === 'ambiguous')
        throw new Error('Selecione o histórico correto antes de continuar.')
      operation.submission = 'processing'
      operation.step = 'Processando pesquisa selecionada'
      await persistOperation()
      if (selected.historyState === 'missing') {
        const identity = selectedIdentity()
        if (!identity) throw new Error('Seleção CPI ausente.')
        checkpoint()
        await searchPerson({
          cpf: identity.cpf,
          confirmed: input.confirmed,
          datasets: input.datasets
        })
        await selectedHistory()
      }
      checkpoint()
      operation.pdf = null
      operation.pdf = await submission.prepare()
    })
  })
  ipcMain.handle('cpi:review-response', (event) => {
    authorized(event)
    return runCpi(async () => {
      checkpoint()
      if (['confirmed', 'uncertain'].includes(operation.submission ?? ''))
        throw new Error(
          'Resposta concluída ou incerta; repetição bloqueada. Confira o portal e o histórico.'
        )
      operation.pdf = null
      operation.pdf = await submission.prepare()
      return operation.pdf
    })
  })
  ipcMain.handle('cpi:confirm-submission', (event, id: unknown) => {
    authorized(event)
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Revisão inválida.')
    return runCpi(async () => {
      checkpoint()
      await submission.confirm(id)
      operation.pdf = null
      operation.attachment = {
        state: 'attached',
        requestStatus: 'Respondida',
        message: 'Resposta e PDF confirmados por nova leitura autenticada do portal.'
      }
    })
  })

  ipcMain.handle('cpi:prepare-selected-pdf', (event) => {
    authorized(event)
    return runCpi(async () => {
      operation.step = 'Preparar PDF'
      operation.pdf = null
      operation.pdf = await attachments.prepare()
      operation.step = 'Revisar PDF e anexar'
      return operation.pdf
    })
  })
  ipcMain.handle('cpi:attach-pdf', (event, reviewId: unknown) => {
    authorized(event)
    if (typeof reviewId !== 'string' || !/^[0-9a-f-]{36}$/i.test(reviewId))
      throw new Error('Identificador de conferência inválido.')
    return runCpi(async () => {
      operation.step = 'Anexando PDF — aguarde confirmação'
      const result = await attachments.attach(reviewId)
      operation.attachment = result
      operation.message = result.message
      operation.step =
        result.state === 'uncertain' ? 'Anexação incerta — revisão manual' : 'Revisar anexação'
      return result
    })
  })
  ipcMain.handle('cpi:open-selected', (event, input: unknown) => {
    authorized(event)
    return runCpi(async () => {
      if (!input || typeof input !== 'object') throw new Error('Seleção inválida.')
      const row = input as import('../shared/contracts').CpiQueueRow
      if (
        typeof row.requestId !== 'string' ||
        typeof row.researchId !== 'string' ||
        typeof row.fingerprint !== 'string' ||
        row.checkboxId !== `pesq_${row.researchId}`
      )
        throw new Error('Seleção inválida.')
      await inspectSession()
      if (!operation.connected) throw new Error('CPI desconectada. Conecte e atualize a fila.')
      const current =
        operation.queue?.rows.filter(
          (candidate) =>
            candidate.requestId === row.requestId || candidate.researchId === row.researchId
        ) ?? []
      if (
        current.length !== 1 ||
        current[0].blockedReason ||
        current[0].requestId !== row.requestId ||
        current[0].researchId !== row.researchId ||
        current[0].fingerprint !== row.fingerprint
      )
        throw new Error('Linha modificada ou ausente. Atualize a fila antes de abrir.')
      // Opening is read-only, but clear obsolete review before changing the portal.
      attachments.clear()
      submission.clear()
      operation.control = 'active'
      operation.submission = 'idle'
      operation.selected = row
      operation.identity = null
      operation.research = null
      operation.pdf = null
      operation.attachment = null
      operation.step = 'Identificar CPF'
      await persistOperation()
      const identity = await cpiSession.openSelected(row)
      operation.identity = identity
      return selectedHistory()
    })
  })
  ipcMain.handle('cpi:find-selected-history', (event, id: unknown) => {
    authorized(event)
    if (id !== undefined && (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)))
      throw new Error('Histórico inválido.')
    return runCpi(() => selectedHistory(id as string | undefined))
  })

  ipcMain.handle('cpi:selected-cpf', (event) => {
    authorized(event)
    return runCpi(async () => {
      const result = await selectedHistory()
      const selectedCpi = selectedIdentity()
      if (result.historyState !== 'missing' || !selectedCpi)
        throw new Error('Revise o histórico local antes de encaminhar o CPF.')
      return selectedCpi.cpf
    })
  })

  ipcMain.handle('cpi:open', (event) => {
    authorized(event)
    return runCpi(async () => {
      await cpiSession.open()
      await synchronizeQueue()
    })
  })

  ipcMain.handle('cpi:opened-identity', (event) => {
    authorized(event)

    return runCpi(() => cpiSession.inspectOpenedResearch())
  })

  ipcMain.handle('cpi:links', (event) => {
    authorized(event)
    return listCpiLinks()
  })

  ipcMain.handle('cpi:bind-opened', (event) => {
    authorized(event)

    return runCpi(async () => {
      const opened = await cpiSession.inspectOpenedResearch()
      const reference = await cpiSession.readOpenedReference()

      const inQueue = await cpiSession.hasQueueReference(reference)

      if (!inQueue) {
        throw new Error('Solicitacao nao localizada de forma unica na fila CPI.')
      }

      const records = await listResearch()

      const matches = records.filter(
        (record) =>
          record.status === 'completed' &&
          record.result !== null &&
          record.result.cpf.replace(/\D/g, '') === opened.cpf
      )

      if (matches.length === 0) {
        throw new Error('Nao existe pesquisa concluida para este CPF no historico.')
      }

      if (matches.length > 1) {
        throw new Error(
          'Existem varias pesquisas para este CPF. Selecione o registro correto e use o vinculo manual.'
        )
      }

      const research = matches[0]
      const result = research.result

      if (!result) {
        throw new Error('Resultado local indisponivel.')
      }

      if (research.cpf && research.cpf.replace(/\D/g, '') !== opened.cpf) {
        throw new Error('Inconsistencia entre CPF do historico e resultado.')
      }

      return saveCpiLink({
        cpiReference: reference,
        historyId: research.id,
        cpf: opened.cpf,
        queryCode: result.queryCode ?? null,
        verifiedAt: new Date().toISOString(),
        status: 'pending_review'
      })
    })
  })

  ipcMain.handle('cpi:bind', (event, input: unknown) => {
    authorized(event)

    return runCpi(async () => {
      if (input === null || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Dados do vínculo inválidos.')
      }

      const request = input as Record<string, unknown>
      const cpiReference = request.cpiReference
      const historyId = request.historyId

      if (
        typeof cpiReference !== 'string' ||
        !/^\d{1,15}$/.test(cpiReference) ||
        typeof historyId !== 'string'
      ) {
        throw new Error('Referência ou histórico inválido.')
      }

      const research = await readResearch(historyId)

      if (!research.result) {
        throw new Error('O registro selecionado não possui resultado salvo.')
      }

      const cpf = research.result.cpf

      if (!isValidCpf(cpf) || (research.cpf && research.cpf !== cpf)) {
        throw new Error('CPF inconsistente no histórico local.')
      }

      if ((await cpiSession.readOpenedReference()) !== cpiReference)
        throw new Error('Solicitação do formulário diferente da referência.')
      const referenceFound = await cpiSession.hasQueueReference(cpiReference)

      if (!referenceFound) {
        throw new Error('Referência não identificada de forma única na fila CPI.')
      }

      const identity = await cpiSession.checkOpenedResearch(cpf)

      if (!identity.match) {
        throw new Error('CPF da CPI diferente do histórico. Vínculo bloqueado.')
      }

      return saveCpiLink({
        cpiReference,
        historyId,
        cpf,
        queryCode: research.result.queryCode,
        verifiedAt: new Date().toISOString(),
        status: 'pending_review'
      })
    })
  })

  ipcMain.handle('cpi:queue', (event) => {
    authorized(event)
    return runCpi(async () => {
      return synchronizeQueue()
    })
  })

  ipcMain.handle('cpi:identity', (event, historyId: unknown) => {
    authorized(event)

    return runCpi(async () => {
      if (typeof historyId !== 'string') {
        throw new Error('Histórico inválido.')
      }

      const research = await readResearch(historyId)

      if (!research.result) {
        throw new Error('A pesquisa não contém resultado armazenado.')
      }

      return cpiSession.checkOpenedResearch(research.result.cpf)
    })
  })

  ipcMain.handle('cpi:close', (event) => {
    authorized(event)
    return runCpi(async () => {
      attachments.clear()
      operation.pdf = null
      invalidateSelection('Sessão encerrada. Histórico preservado. Reconecte e atualize a fila.')
      operation.queue = null
      operation.connected = false
      operation.status = 'disconnected'
      await cpiSession.close()
    })
  })

  app.on('before-quit', () => {
    void cpiSession.close().catch(() => undefined)
  })

  ipcMain.handle('deskdata:export-pdf', (event) => {
    authorized(event)
    return runCpi(() => exportReport())
  })

  ipcMain.handle('deskdata:saved-access', async (event) => {
    authorized(event)
    return getSavedAccessInfo()
  })

  ipcMain.handle('deskdata:connect-saved', async (event) => {
    authorized(event)

    const saved = await readSavedCredentials()

    if (!saved) {
      throw new Error('Nenhum acesso salvo foi encontrado.')
    }

    return connect({
      username: saved.username,
      password: saved.password,
      remember: false
    })
  })

  ipcMain.handle('deskdata:forget-saved-access', async (event) => {
    authorized(event)

    if (running) {
      throw new Error('Aguarde a operacao atual.')
    }

    await deleteSavedCredentials()
    return getSavedAccessInfo()
  })

  ipcMain.handle('deskdata:disconnect', (event) => {
    authorized(event)

    if (running) {
      throw new Error('Aguarde a conclusÃ£o da operaÃ§Ã£o atual.')
    }

    clearSession()
    report('info', 'SessÃ£o encerrada localmente')

    return snapshot()
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
