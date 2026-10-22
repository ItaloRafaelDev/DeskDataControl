import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadTs } from './load-ts.mjs'
const { savePdfToDirectory } = loadTs('src/main/pdf-destination.ts')
const root = await mkdtemp(join(tmpdir(), 'pdf-destination-'))
try {
  const first = join(root, 'first')
  const second = join(root, 'second')
  await mkdir(first)
  await mkdir(second)
  let directory = null
  let choices = 0
  let chosen = first
  const deps = {
    readDirectory: async () => directory,
    saveDirectory: async (path) => {
      directory = path
    },
    chooseDirectory: async () => {
      choices++
      return chosen
    }
  }
  const bytes = Buffer.from('%PDF fixture')
  const a = await savePdfToDirectory(bytes, deps)
  assert.equal(directory, first)
  assert.equal(choices, 1)
  assert.equal((await readFile(a)).toString(), '%PDF fixture')
  const b = await savePdfToDirectory(Buffer.from('second'), deps)
  assert.notEqual(a, b)
  assert.equal(choices, 1)
  assert.equal((await readFile(a)).toString(), '%PDF fixture')
  const concurrent = await Promise.all(
    Array.from({ length: 5 }, () => savePdfToDirectory(bytes, deps))
  )
  assert.equal(new Set(concurrent).size, 5)
  assert.ok(concurrent.every((path) => !/DeskData|52998224725/.test(path)))
  await rm(first, { recursive: true })
  chosen = null
  assert.equal(await savePdfToDirectory(bytes, deps), null)
  assert.equal(directory, first, 'Cancelar preserva a preferência indisponível')
  chosen = second
  assert.ok((await savePdfToDirectory(bytes, deps)).startsWith(second))
  assert.equal(directory, second)
  directory = null
  chosen = null
  assert.equal(await savePdfToDirectory(bytes, deps), null)
  assert.equal(directory, null)
  const file = join(root, 'file')
  await writeFile(file, 'not a directory')
  directory = file
  chosen = second
  assert.ok((await savePdfToDirectory(bytes, deps)).startsWith(second))
  for (const code of ['EACCES', 'EPERM', 'EROFS']) {
    let attempts = 0
    const { savePdfToDirectory: restrictedSave } = loadTs('src/main/pdf-destination.ts', {
      'node:fs/promises': {
        writeFile: async () => {
          if (++attempts === 1) throw Object.assign(new Error(code), { code })
        }
      }
    })
    directory = first
    let unavailable = false
    await restrictedSave(bytes, {
      ...deps,
      chooseDirectory: async (reason) => {
        unavailable = reason
        return second
      }
    })
    assert.equal(unavailable, true)
    assert.equal(directory, second)
  }
  let preferenceChoices = 0
  await assert.rejects(
    () =>
      savePdfToDirectory(bytes, {
        readDirectory: async () => second,
        saveDirectory: async () => {
          throw Object.assign(new Error('Preferência inacessível'), { code: 'EACCES' })
        },
        chooseDirectory: async () => {
          preferenceChoices++
          return null
        }
      }),
    /Preferência|preferência/
  )
  assert.equal(
    preferenceChoices,
    0,
    'Falha na configuração não deve solicitar outro destino ou salvar outra cópia'
  )
  console.log(
    'PASS: primeira pasta, reuso, cancelamento, pasta removida, sem permissão, colisões e concorrência sem sobrescrita'
  )
} finally {
  await rm(root, { recursive: true, force: true })
}
