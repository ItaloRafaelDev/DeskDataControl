import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { CpiLinkRecord } from '../shared/contracts'

function storagePath(): string {
  return join(app.getPath('userData'), 'cpi-links.bin')
}

function requireEncryption(): void {
  if (process.platform !== 'win32' || !safeStorage.isEncryptionAvailable()) {
    throw new Error('Criptografia local indisponível.')
  }
}

export async function listCpiLinks(): Promise<CpiLinkRecord[]> {
  requireEncryption()

  let encrypted: Buffer

  try {
    encrypted = await readFile(storagePath())
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return []
    }

    throw new Error('Falha ao ler vínculos CPI.', {
      cause: error
    })
  }

  try {
    const value: unknown = JSON.parse(safeStorage.decryptString(encrypted))

    if (!Array.isArray(value)) {
      throw new Error('Formato inválido.')
    }

    for (const item of value) {
      if (
        !item ||
        typeof item !== 'object' ||
        typeof item.cpiReference !== 'string' ||
        typeof item.historyId !== 'string' ||
        typeof item.cpf !== 'string' ||
        typeof item.verifiedAt !== 'string' ||
        !['pending_review', 'submitted'].includes(item.status)
      ) {
        throw new Error('Registro inválido.')
      }
    }

    return value as CpiLinkRecord[]
  } catch (error) {
    throw new Error('Não foi possível descriptografar os vínculos CPI.', { cause: error })
  }
}

export async function saveCpiLink(candidate: CpiLinkRecord): Promise<CpiLinkRecord> {
  requireEncryption()

  const records = await listCpiLinks()

  const existing = records.find((item) => item.cpiReference === candidate.cpiReference)

  if (existing) {
    if (existing.historyId !== candidate.historyId || existing.cpf !== candidate.cpf) {
      throw new Error('Esta referência CPI já está vinculada a outra pesquisa.')
    }

    if (existing.status === 'submitted' || candidate.status !== 'submitted') return existing
  }

  const destination = storagePath()
  const temporary = `${destination}.${randomUUID()}.tmp`

  await mkdir(dirname(destination), { recursive: true })

  const updated = existing
    ? records.map((record) => (record.cpiReference === candidate.cpiReference ? candidate : record))
    : [candidate, ...records]
  const encrypted = safeStorage.encryptString(JSON.stringify(updated))

  try {
    await writeFile(temporary, encrypted, {
      flag: 'wx',
      mode: 0o600
    })

    await rename(temporary, destination)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }

  return candidate
}
