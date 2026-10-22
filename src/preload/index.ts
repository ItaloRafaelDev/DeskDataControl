import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ActivityItem, DesktopBridge } from '../shared/contracts'

const api: DesktopBridge = {
  cpiProcessSelected: (request) => ipcRenderer.invoke('cpi:process-selected', request),
  cpiReviewResponse: () => ipcRenderer.invoke('cpi:review-response'),
  cpiConfirmSubmission: (id) => ipcRenderer.invoke('cpi:confirm-submission', id),
  cpiControl: (action) => ipcRenderer.invoke('cpi:control', action),
  getOperation: () => ipcRenderer.invoke('cpi:snapshot'),
  getPdfDirectory: () => ipcRenderer.invoke('deskdata:pdf-directory'),
  changePdfDirectory: () => ipcRenderer.invoke('deskdata:change-pdf-directory'),
  exportSelectedPdf: () => ipcRenderer.invoke('cpi:export-pdf'),
  onOperation: (listener) => {
    const handler = (
      _event: IpcRendererEvent,
      state: import('../shared/contracts').OperationalSnapshot
    ): void => listener(state)
    ipcRenderer.on('cpi:state', handler)
    return () => ipcRenderer.removeListener('cpi:state', handler)
  },
  getSnapshot: () => ipcRenderer.invoke('deskdata:snapshot'),

  connect: (credentials) => ipcRenderer.invoke('deskdata:connect', credentials),

  refreshBalance: () => ipcRenderer.invoke('deskdata:balance'),

  getSavedAccess: () => ipcRenderer.invoke('deskdata:saved-access'),

  connectSaved: () => ipcRenderer.invoke('deskdata:connect-saved'),

  forgetSavedAccess: () => ipcRenderer.invoke('deskdata:forget-saved-access'),

  disconnect: () => ipcRenderer.invoke('deskdata:disconnect'),

  recoverQuery: (request) => ipcRenderer.invoke('deskdata:recover', request),

  cpiOpenSelected: (row) => ipcRenderer.invoke('cpi:open-selected', row),
  cpiFindSelectedHistory: (id) => ipcRenderer.invoke('cpi:find-selected-history', id),
  cpiSelectedCpf: () => ipcRenderer.invoke('cpi:selected-cpf'),
  cpiPrepareSelectedPdf: () => ipcRenderer.invoke('cpi:prepare-selected-pdf'),
  cpiAttachPdf: (reviewId) => ipcRenderer.invoke('cpi:attach-pdf', reviewId),
  cpiOpen: () => ipcRenderer.invoke('cpi:open'),

  cpiListLinks: () => ipcRenderer.invoke('cpi:links'),

  cpiBindOpened: () => ipcRenderer.invoke('cpi:bind-opened'),

  cpiBind: (request) => ipcRenderer.invoke('cpi:bind', request),

  cpiReadOpenedIdentity: () => ipcRenderer.invoke('cpi:opened-identity'),

  cpiReadQueue: () => ipcRenderer.invoke('cpi:queue'),

  cpiCheckIdentity: (id) => ipcRenderer.invoke('cpi:identity', id),

  cpiClose: () => ipcRenderer.invoke('cpi:close'),

  prepareCpi: (id) => ipcRenderer.invoke('deskdata:cpi-preview', id),

  listHistory: () => ipcRenderer.invoke('deskdata:history-list'),

  openHistory: (id) => ipcRenderer.invoke('deskdata:history-open', id),

  exportPdf: () => ipcRenderer.invoke('deskdata:export-pdf'),

  queryPerson: (request) => ipcRenderer.invoke('deskdata:person-query', request),

  onActivity: (listener) => {
    const handler = (_event: IpcRendererEvent, entry: ActivityItem): void => listener(entry)

    ipcRenderer.on('deskdata:activity', handler)

    return () => ipcRenderer.removeListener('deskdata:activity', handler)
  }
}

contextBridge.exposeInMainWorld('deskdata', api)
