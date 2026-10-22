import type { PersonDataset, PersonQueryResult } from '../shared/contracts'

const API_BASE = 'https://api.deskdata.com.br/queries'

const AVAILABLE: readonly PersonDataset[] = ['basic', 'phones', 'addresses', 'emails', 'lawsuits']

const POLL_INTERVAL_MS = 4000
const POLL_ATTEMPTS = 12

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function normalizeDatasets(value: unknown): PersonDataset[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > AVAILABLE.length) {
    throw new Error('Selecione entre um e cinco conjuntos de dados.')
  }

  const unique = new Set<PersonDataset>()

  for (const dataset of value) {
    if (typeof dataset !== 'string' || !AVAILABLE.includes(dataset as PersonDataset)) {
      throw new Error('Conjunto de dados não autorizado.')
    }

    unique.add(dataset as PersonDataset)
  }

  return [...unique]
}

export function isValidCpf(value: string): boolean {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) {
    return false
  }

  for (const length of [9, 10]) {
    let sum = 0

    for (let i = 0; i < length; i += 1) {
      sum += Number(value[i]) * (length + 1 - i)
    }

    const remainder = (sum * 10) % 11

    if ((remainder === 10 ? 0 : remainder) !== Number(value[length])) {
      return false
    }
  }

  return true
}

function apiError(httpStatus: number, code: unknown): Error {
  if (code === 4003) {
    return new Error('Créditos insuficientes na DeskData.')
  }

  if (code === 4004) {
    return new Error('Consulta bloqueada pela DeskData.')
  }

  if (code === 4005) {
    return new Error('Validação de data de nascimento requerida pela API.')
  }

  if (httpStatus === 401) {
    return new Error('Autenticação expirada ou não autorizada.')
  }

  if (httpStatus === 429) {
    return new Error('Limite de requisições atingido (429).')
  }

  return new Error(`A consulta não foi concluída (HTTP ${httpStatus}).`)
}

function queryCode(payload: Record<string, unknown>): string | null {
  const data = record(payload.data)
  const code = payload.query_code ?? data?.query_code

  return typeof code === 'string' && /^Q-[A-F0-9]{10}$/.test(code) ? code : null
}

async function callApi(
  method: 'POST' | 'GET',
  url: string,
  token: string,
  body?: object
): Promise<{
  httpStatus: number
  payload: Record<string, unknown>
}> {
  let response: Response

  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(method === 'POST' ? 45000 : 15000)
    })
  } catch {
    throw new Error(
      method === 'POST'
        ? 'Falha de comunicação: o envio pode ter sido processado. Não repita automaticamente.'
        : 'Falha ao acompanhar a consulta existente. Não envie um novo POST.'
    )
  }

  let parsed: unknown

  try {
    parsed = await response.json()
  } catch {
    throw new Error('A API retornou uma resposta não JSON. Não repita a consulta automaticamente.')
  }

  const payload = record(parsed)

  if (!payload) {
    throw new Error('A API retornou um JSON inesperado.')
  }

  return {
    httpStatus: response.status,
    payload
  }
}

function responseCode(payload: Record<string, unknown>): unknown {
  return record(payload.status)?.code
}

async function awaitResult(
  initial: {
    httpStatus: number
    payload: Record<string, unknown>
  },
  token: string
): Promise<{
  payload: Record<string, unknown>
  code: string | null
}> {
  const initialCode = responseCode(initial.payload)

  if (initial.httpStatus !== 202 && initialCode !== 4008) {
    if (initial.httpStatus >= 400 || initialCode !== 4000) {
      throw apiError(initial.httpStatus, initialCode)
    }

    return {
      payload: initial.payload,
      code: queryCode(initial.payload)
    }
  }

  const code = queryCode(initial.payload)

  if (!code) {
    throw new Error('A consulta está pendente, mas a API não forneceu query_code.')
  }

  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))

    let next: {
      httpStatus: number
      payload: Record<string, unknown>
    }

    try {
      next = await callApi('GET', `${API_BASE}/${code}`, token)
    } catch {
      throw new Error(`Não foi possível acompanhar ${code}. Não reenvie a consulta.`)
    }

    const statusCode = responseCode(next.payload)

    if (next.httpStatus === 202 || statusCode === 4008) {
      continue
    }

    if (next.httpStatus >= 400 || statusCode !== 4000) {
      throw apiError(next.httpStatus, statusCode)
    }

    return {
      payload: next.payload,
      code
    }
  }

  throw new Error(`Consulta ${code} ainda em processamento. Não reenvie o CPF.`)
}

export async function queryPerson(
  cpf: string,
  accessToken: string,
  datasets: PersonDataset[]
): Promise<PersonQueryResult> {
  if (!isValidCpf(cpf)) {
    throw new Error('CPF inválido.')
  }

  const selected = normalizeDatasets(datasets)

  const start = await callApi('POST', API_BASE, accessToken, {
    type: 'persons',
    key_type: 'cpf',
    key_value: cpf,
    datasets: selected
  })

  const completed = await awaitResult(start, accessToken)

  const data = record(completed.payload.data)

  if (!data) {
    throw new Error('A resposta não contém objeto data válido.')
  }

  return {
    cpf,
    queriedAt: new Date().toISOString(),
    queryCode: completed.code,
    sections: selected.map((dataset) => {
      const original = record(data[dataset])
      const items = Array.isArray(original?.items) ? original.items : null

      const total = original?.total

      return {
        dataset,
        present: original !== null,
        total:
          typeof total === 'number' && Number.isSafeInteger(total) && total >= 0 ? total : null,
        returnedItems: items?.length ?? null,
        data: original
          ? {
              ...original,
              ...(items
                ? {
                    items
                  }
                : {})
            }
          : null
      }
    })
  }
}
