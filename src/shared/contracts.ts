export interface ActivityItem {
  id: number
  at: string
  level: 'info' | 'success' | 'error'
  message: string
}

export interface DeskDataSnapshot {
  appVersion: string
  connected: boolean
  balance: number | null
  balanceUpdatedAt: string | null
  tokenExpiresAt: string | null
  activity: ActivityItem[]
}

export type CpiSubmissionState =
  | 'idle'
  | 'processing'
  | 'reviewed'
  | 'selecting_file'
  | 'file_selected'
  | 'saving'
  | 'verifying'
  | 'confirmed'
  | 'uncertain'

export interface DesktopBridge {
  cpiProcessSelected(request: { confirmed: boolean; datasets: PersonDataset[] }): Promise<void>
  cpiReviewResponse(): Promise<CpiPdfReview>
  cpiConfirmSubmission(reviewId: string): Promise<void>
  cpiControl(action: 'pause' | 'resume' | 'cancel'): Promise<void>
  getOperation(): Promise<OperationalSnapshot>
  onOperation(listener: (state: OperationalSnapshot) => void): () => void
  getPdfDirectory(): Promise<string | null>
  changePdfDirectory(): Promise<string | null>
  exportSelectedPdf(): Promise<boolean>
  getSnapshot(): Promise<DeskDataSnapshot>
  connect(credentials: {
    username: string
    password: string
    remember?: boolean
  }): Promise<DeskDataSnapshot>
  getSavedAccess(): Promise<SavedAccessInfo>
  connectSaved(): Promise<DeskDataSnapshot>
  forgetSavedAccess(): Promise<SavedAccessInfo>
  refreshBalance(): Promise<DeskDataSnapshot>
  disconnect(): Promise<DeskDataSnapshot>
  cpiOpenSelected(row: CpiQueueRow): Promise<CpiSelectedResearch>
  cpiFindSelectedHistory(historyId?: string): Promise<CpiSelectedResearch>
  cpiSelectedCpf(): Promise<string>
  cpiPrepareSelectedPdf(): Promise<CpiPdfReview>
  cpiAttachPdf(reviewId: string): Promise<CpiAttachmentState>
  cpiOpen(): Promise<void>
  cpiListLinks(): Promise<CpiLinkRecord[]>
  cpiBindOpened(): Promise<CpiLinkRecord>
  cpiBind(request: CpiLinkRequest): Promise<CpiLinkRecord>
  cpiReadQueue(): Promise<CpiQueueSnapshot>
  cpiReadOpenedIdentity(): Promise<CpiOpenedIdentity>
  cpiCheckIdentity(historyId: string): Promise<CpiIdentityCheck>
  cpiClose(): Promise<void>
  prepareCpi(historyId: string): Promise<CpiPreview>
  listHistory(): Promise<HistoryEntry[]>
  openHistory(id: string): Promise<PersonQueryResult>
  recoverQuery(request: { queryCode: string }): Promise<RecoverResult>
  exportPdf(): Promise<boolean>
  queryPerson(request: {
    cpiContext?: boolean
    cpf: string
    confirmed: boolean
    datasets: PersonDataset[]
  }): Promise<PersonQueryResult>
  onActivity(listener: (entry: ActivityItem) => void): () => void
}
export interface OperationalSnapshot {
  status?:
    | 'idle'
    | 'syncing'
    | 'ready'
    | 'running'
    | 'paused'
    | 'completed'
    | 'failed'
    | 'uncertain'
    | 'disconnected'
  submission?: CpiSubmissionState
  control?: 'active' | 'paused' | 'cancelled'
  connected: boolean
  busy: boolean
  queue: CpiQueueSnapshot | null
  selected: CpiQueueRow | null
  identity: CpiOpenedIdentity | null
  research: CpiSelectedResearch | null
  pdf: CpiPdfReview | null
  attachment: CpiAttachmentState | null
  step: string
  message: string
}
export type PersonDataset = 'basic' | 'phones' | 'addresses' | 'emails' | 'lawsuits'

export interface PersonQuerySection {
  dataset: PersonDataset
  present: boolean
  total: number | null
  returnedItems: number | null
  data: Record<string, unknown> | null
}

export interface PersonQueryResult {
  cpf: string
  queriedAt: string
  queryCode: string | null
  sections: PersonQuerySection[]
}
export type RecoverResult =
  | {
      state: 'processing'
      queryCode: string
    }
  | {
      state: 'completed'
      result: PersonQueryResult
    }
export type HistoryStatus = 'pending' | 'processing' | 'completed' | 'uncertain'

export interface HistoryEntry {
  id: string
  cpf: string
  queryCode: string | null
  createdAt: string
  updatedAt: string
  datasets: PersonDataset[]
  status: HistoryStatus
  source: 'query' | 'recovery'
  hasResult: boolean
}
export interface CpiPreviewProcess {
  number: string
  courtType: string
  situation: string
  sphere: 'criminal' | 'noncriminal' | 'unknown'
  participation: 'document_matched' | 'not_verified'
  roles: string[]
}

export type CpiClassification = 'CONSTA_RESTRICAO' | 'HA_INFORMACOES' | 'INDEFINIDO'

export interface CpiPreview {
  classification: CpiClassification
  classificationLabel: string
  queryCode: string | null
  cpf: string
  totalDeclared: number | null
  totalReceived: number
  criminal: number
  criminalWithDocument: number
  unknown: number
  readyForSubmission: false
  warnings: string[]
  processes: CpiPreviewProcess[]
  truncated: boolean
}
export interface SavedAccessInfo {
  available: boolean
  username: string | null
}

export interface CpiQueueSnapshot {
  state: 'LOGIN_REQUIRED' | 'HAS_RESEARCH' | 'EMPTY' | 'INDETERMINATE'
  rows: CpiQueueRow[]
  visibleRows: number
  declaredTotal: number | null
}

export interface CpiIdentityCheck {
  match: boolean
}

export interface CpiOpenedIdentity {
  cpf: string
  maskedCpf: string
}

export interface CpiLinkRequest {
  cpiReference: string
  historyId: string
}

export interface CpiLinkRecord {
  cpiReference: string
  historyId: string
  cpf: string
  queryCode: string | null
  verifiedAt: string
  status: 'pending_review' | 'submitted'
}
export interface CpiQueueRow {
  requestId: string
  researchId: string
  checkboxId: string
  name: string
  situation: string
  fingerprint: string
  blockedReason: string | null
}
export interface CpiSelectedResearch {
  historyState: 'unique' | 'missing' | 'ambiguous'
  candidates: { id: string; queryCode: string | null; createdAt: string }[]
  requestId: string
  maskedCpf: string
  historyId: string | null
  preview: CpiPreview | null
}

export interface CpiPdfReview {
  classification: CpiPreview['classification']
  reviewId: string
  requestId: string
  researchId: string
  cpf: string
  historyId: string
  filename: string
  sha256: string
  byteLength: number
  requestStatus: string
  blockedReason: string | null
}

export interface CpiAttachmentState {
  state: 'blocked' | 'cancelled' | 'already_present' | 'attached' | 'uncertain'
  message: string
  requestStatus: string
}
