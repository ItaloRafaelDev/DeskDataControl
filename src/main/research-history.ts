import { app, safeStorage } from 'electron'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type {
  HistoryEntry,
  PersonDataset,
  PersonQueryResult,
  HistoryStatus
} from '../shared/contracts'

export interface StoredResearch extends Omit<HistoryEntry, 'hasResult'> {
  result: PersonQueryResult | null
  cpiSubmissions?: { requestId: string; researchId: string; sha256: string; confirmedAt: string }[]
}

function directory(): string {
  return join(app.getPath('userData'), 'research-history')
}

function verifyEncryption(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('A criptografia local do Windows não está disponível.')
  }
}

function filePath(id: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new Error('Identificador de histórico inválido.')
  }

  return join(directory(), `${id}.bin`)
}

export async function saveResearch(record: StoredResearch): Promise<void> {
  verifyEncryption()

  await mkdir(directory(), { recursive: true })

  const destination = filePath(record.id)
  const temporary = join(directory(), `.${record.id}-${randomUUID()}.tmp`)

  const encrypted = safeStorage.encryptString(JSON.stringify(record))

  try {
    await writeFile(temporary, encrypted, {
      flag: 'wx',
      mode: 0o600
    })

    await rename(temporary, destination)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}

export async function readResearch(id: string): Promise<StoredResearch> {
  verifyEncryption()

  const encrypted = await readFile(filePath(id))
  const plaintext = safeStorage.decryptString(encrypted)
  const parsed: unknown = JSON.parse(plaintext)

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    (parsed as StoredResearch).id !== id
  ) {
    throw new Error('Registro de histórico inválido.')
  }

  return parsed as StoredResearch
}

export async function listResearch(): Promise<StoredResearch[]> {
  verifyEncryption()
  await mkdir(directory(), { recursive: true })

  const files = (await readdir(directory())).filter((name) => /^[0-9a-f-]{36}\.bin$/i.test(name))

  const records: StoredResearch[] = []

  for (const file of files) {
    try {
      records.push(await readResearch(file.replace(/\.bin$/i, '')))
    } catch {
      throw new Error(`Não foi possível ler um registro do histórico: ${file}`)
    }
  }

  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function historySummary(record: StoredResearch): HistoryEntry {
  const { result, ...metadata } = record

  return {
    ...metadata,
    hasResult: result !== null
  }
}

export async function startResearch(
  cpf: string,
  datasets: PersonDataset[]
): Promise<StoredResearch> {
  const previous = await listResearch()

  const unresolved = previous.find(
    (item) =>
      item.cpf === cpf &&
      item.result === null &&
      ['pending', 'processing', 'uncertain'].includes(item.status)
  )

  if (unresolved) {
    throw new Error(
      'Existe uma tentativa anterior sem resultado confirmado para este CPF. Consulte o histórico antes de realizar outra pesquisa.'
    )
  }

  const now = new Date().toISOString()

  const record: StoredResearch = {
    id: randomUUID(),
    cpf,
    queryCode: null,
    createdAt: now,
    updatedAt: now,
    datasets: [...datasets],
    status: 'pending',
    source: 'query',
    result: null
  }

  await saveResearch(record)

  return record
}

export async function finishResearch(
  original: StoredResearch,
  status: HistoryStatus,
  result: PersonQueryResult | null,
  queryCode: string | null
): Promise<void> {
  await saveResearch({
    ...original,
    status,
    queryCode,
    updatedAt: new Date().toISOString(),
    result
  })
}

export async function saveRecoveredResearch(
  code: string,
  result: PersonQueryResult | null
): Promise<void> {
  const records = await listResearch()

  const existing = records.find((record) => record.queryCode === code)

  const now = new Date().toISOString()

  const record: StoredResearch = existing ?? {
    id: randomUUID(),
    cpf: '',
    queryCode: code,
    createdAt: now,
    updatedAt: now,
    datasets: [],
    status: 'processing',
    source: 'recovery',
    result: null
  }

  await saveResearch({
    ...record,
    cpf: result?.cpf || record.cpf,
    queryCode: code,
    updatedAt: now,
    datasets: result ? result.sections.map((section) => section.dataset) : record.datasets,
    status: result ? 'completed' : 'processing',
    result: result ?? record.result
  })
}
