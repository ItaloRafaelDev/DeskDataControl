import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { SavedAccessInfo } from '../shared/contracts'

interface StoredCredentials {
  version: 1
  username: string
  password: string
}

function credentialsPath(): string {
  return join(app.getPath('userData'), 'deskdata-credentials.bin')
}

function assertEncryption(): void {
  if (process.platform !== 'win32' || !safeStorage.isEncryptionAvailable()) {
    throw new Error('Armazenamento seguro indisponivel neste ambiente.')
  }
}

export async function saveSavedCredentials(username: string, password: string): Promise<void> {
  assertEncryption()

  const data: StoredCredentials = {
    version: 1,
    username,
    password
  }

  const destination = credentialsPath()
  const temporary = `${destination}.${randomUUID()}.tmp`

  await mkdir(dirname(destination), { recursive: true })

  const encrypted = safeStorage.encryptString(JSON.stringify(data))

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

export async function readSavedCredentials(): Promise<StoredCredentials | null> {
  let encrypted: Buffer

  try {
    encrypted = await readFile(credentialsPath())
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null
    }

    throw new Error('Falha ao acessar as credenciais armazenadas.', {
      cause: error
    })
  }

  assertEncryption()

  try {
    const parsed: unknown = JSON.parse(safeStorage.decryptString(encrypted))

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Formato invalido')
    }

    const data = parsed as Record<string, unknown>

    if (
      data.version !== 1 ||
      typeof data.username !== 'string' ||
      typeof data.password !== 'string' ||
      !data.username ||
      !data.password
    ) {
      throw new Error('Credenciais invalidas')
    }

    return {
      version: 1,
      username: data.username,
      password: data.password
    }
  } catch {
    throw new Error(
      'Nao foi possivel abrir o acesso salvo. Use Esquecer acesso e autentique novamente.'
    )
  }
}

export async function getSavedAccessInfo(): Promise<SavedAccessInfo> {
  try {
    const credentials = await readSavedCredentials()

    return {
      available: credentials !== null,
      username: credentials?.username ?? null
    }
  } catch {
    return {
      available: true,
      username: null
    }
  }
}

export async function deleteSavedCredentials(): Promise<void> {
  await rm(credentialsPath(), { force: true })
}
