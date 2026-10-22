import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

interface Dependencies {
  readDirectory(): Promise<string | null>
  saveDirectory(directory: string): Promise<void>
  chooseDirectory(unavailable: boolean): Promise<string | null>
}

export async function savePdfToDirectory(
  bytes: Buffer,
  deps: Dependencies
): Promise<string | null> {
  let directory = await deps.readDirectory()
  let unavailable = false
  for (;;) {
    if (!directory) {
      directory = await deps.chooseDirectory(unavailable)
      if (!directory) return null
    }
    // Exclusive creation handles collisions atomically, including concurrent exports.
    const stem = `Relatorio_Pesquisa_${new Date().toISOString().slice(0, 10)}`
    let savedPath: string | null = null
    try {
      for (let suffix = 1; ; suffix++) {
        const destination = join(directory, `${stem}${suffix === 1 ? '' : `_${suffix}`}.pdf`)
        try {
          await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 })
          savedPath = destination
          break
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')
            continue
          throw error
        }
      }
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        !['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR', 'EROFS'].includes(String(error.code))
      )
        throw error
      unavailable = true
      directory = null
    }
    if (savedPath && directory) {
      try {
        await deps.saveDirectory(directory)
      } catch (error) {
        throw new Error('PDF salvo, mas não foi possível persistir a preferência de pasta.', {
          cause: error
        })
      }
      return savedPath
    }
  }
}
