import type { PersonDataset, PersonQueryResult, RecoverResult } from '../shared/contracts'

const API = 'https://api.deskdata.com.br/queries'

const DATASETS: readonly PersonDataset[] = ['basic', 'phones', 'addresses', 'emails', 'lawsuits']

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function recoveredCpf(payload: Record<string, unknown>, data: Record<string, unknown>): string {
  const basic = asRecord(data.basic)
  const taxId = asRecord(basic?.tax_id)
  const query = asRecord(payload.query)

  const candidates = [taxId?.number, basic?.cpf, query?.key_value, payload.key_value]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' || typeof candidate === 'number') {
      const digits = String(candidate).replace(/\D/g, '')

      if (digits.length === 11) {
        return digits
      }
    }
  }

  return ''
}

export async function recoverQueryByCode(
  rawCode: string,
  accessToken: string
): Promise<RecoverResult> {
  const queryCode = rawCode.trim().toUpperCase()

  if (!/^Q-[A-F0-9]{10}$/.test(queryCode)) {
    throw new Error('Código inválido. Utilize Q- seguido de 10 caracteres hexadecimais.')
  }

  let response: Response

  try {
    response = await fetch(`${API}/${queryCode}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      redirect: 'error',
      signal: AbortSignal.timeout(20000)
    })
  } catch {
    throw new Error(
      'Falha de comunicação ao recuperar a pesquisa. Nenhuma nova consulta foi enviada.'
    )
  }

  let parsed: unknown

  try {
    parsed = await response.json()
  } catch {
    throw new Error('A recuperação retornou uma resposta que não é JSON válido.')
  }

  const payload = asRecord(parsed)

  if (!payload) {
    throw new Error('Formato inesperado na recuperação.')
  }

  const code = asRecord(payload.status)?.code

  if (response.status === 202 && code === 4008) {
    return {
      state: 'processing',
      queryCode
    }
  }

  if (response.status === 404 || code === 4009) {
    throw new Error('Código de pesquisa não encontrado na DeskData.')
  }

  if (response.status === 401) {
    throw new Error('A sessão da DeskData expirou. Conecte novamente.')
  }

  if (!response.ok || code !== 4000) {
    throw new Error(`Não foi possível recuperar a consulta (HTTP ${response.status}).`)
  }

  const data = asRecord(payload.data)

  if (!data) {
    throw new Error('A API não retornou dados para esta consulta.')
  }

  const sections: PersonQueryResult['sections'] = DATASETS.filter((dataset) =>
    Object.hasOwn(data, dataset)
  ).map((dataset) => {
    const section = asRecord(data[dataset])

    const items = Array.isArray(section?.items) ? section.items : null

    const total = section?.total

    return {
      dataset,
      present: section !== null,
      total: typeof total === 'number' && Number.isSafeInteger(total) && total >= 0 ? total : null,
      returnedItems: items?.length ?? null,
      data: section
    }
  })

  if (sections.length === 0) {
    throw new Error('Consulta concluída, mas sem conjuntos de pessoa reconhecidos.')
  }

  return {
    state: 'completed',
    result: {
      cpf: recoveredCpf(payload, data),
      queriedAt: new Date().toISOString(),
      queryCode,
      sections
    }
  }
}
