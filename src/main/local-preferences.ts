import { app, safeStorage } from 'electron'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { OperationalSnapshot } from '../shared/contracts'

interface Preferences {
  pdfDirectory: string | null
  operation: OperationalSnapshot | null
}
let cached: Preferences | null = null
let writes = Promise.resolve()

export async function readPreferences(): Promise<Preferences> {
  if (cached) return cached
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Criptografia local indisponível.')
  try {
    const parsed = JSON.parse(
      safeStorage.decryptString(await readFile(join(app.getPath('userData'), 'preferences.bin')))
    ) as Preferences
    if (
      !parsed ||
      (parsed.pdfDirectory !== null && typeof parsed.pdfDirectory !== 'string') ||
      (parsed.operation !== null && typeof parsed.operation !== 'object')
    )
      throw new Error('Preferências inválidas.')
    cached = parsed
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT')
      throw error
    cached = { pdfDirectory: null, operation: null }
  }
  return cached
}

export function updatePreferences(patch: Partial<Preferences>): Promise<void> {
  const next = writes
    .catch(() => undefined)
    .then(async () => {
      const updated = { ...(await readPreferences()), ...patch }
      const directory = app.getPath('userData')
      await mkdir(directory, { recursive: true })
      const destination = join(directory, 'preferences.bin')
      const temporary = `${destination}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, safeStorage.encryptString(JSON.stringify(updated)), {
          flag: 'wx',
          mode: 0o600
        })
        await rename(temporary, destination)
        cached = updated
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined)
      }
    })
  writes = next
  return next
}
