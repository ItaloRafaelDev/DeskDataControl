import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { loadTs } from './load-ts.mjs'
const { queryPerson } = loadTs('src/main/persons.ts')
const { prepareCpiPreview } = loadTs('src/main/cpi-preview.ts')
const originalFetch = globalThis.fetch
const directory = await mkdtemp(join(tmpdir(), 'deskdata-history-'))
// OS encryption is an external boundary. Exercise the actual history module
// with a local authenticated cipher, without claiming to validate Windows DPAPI.
const key = randomBytes(32)
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => {
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, nonce)
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
    return Buffer.concat([nonce, cipher.getAuthTag(), encrypted])
  },
  decryptString: (bytes) => {
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
    decipher.setAuthTag(bytes.subarray(12, 28))
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')
  }
}
const history = loadTs('src/main/research-history.ts', {
  electron: { app: { getPath: () => directory }, safeStorage }
})
try {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return new Response(
      JSON.stringify({
        status: { code: 4000 },
        query_code: 'Q-ABCDEF0123',
        data: { lawsuits: { total: 0, items: [] } }
      }),
      { status: 200 }
    )
  }
  const cpf = '52998224725'
  const started = await history.startResearch(cpf, ['lawsuits'])
  await assert.rejects(() => history.startResearch(cpf, ['lawsuits']), /tentativa anterior/)
  const result = await queryPerson(cpf, 'synthetic-token', ['lawsuits'])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.deskdata.com.br/queries')
  assert.equal(calls[0].options.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    type: 'persons',
    key_type: 'cpf',
    key_value: cpf,
    datasets: ['lawsuits']
  })
  await history.finishResearch(started, 'completed', result, result.queryCode)
  const restored = await history.readResearch(started.id)
  assert.deepEqual(restored.result, result)
  assert.equal((await history.listResearch()).length, 1)
  assert.equal(prepareCpiPreview(restored.result).classification, 'HA_INFORMACOES')
  assert.equal(calls.length, 1)
  const [filename] = await readdir(join(directory, 'research-history'))
  assert.equal(
    (await readFile(join(directory, 'research-history', filename))).includes(Buffer.from(cpf)),
    false
  )
  console.log(
    'PASS: API simulada mantém POST único, histórico local recuperável e classificação sem nova consulta'
  )
  globalThis.fetch = async () => {
    calls.push('failed')
    throw new Error('synthetic network interruption')
  }
  await assert.rejects(
    () => queryPerson(cpf, 'synthetic-token', ['lawsuits']),
    /Não repita automaticamente/
  )
  assert.equal(calls.length, 2)
  console.log('PASS: falha de rede na API não repete consulta automaticamente')
} finally {
  globalThis.fetch = originalFetch
  await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
