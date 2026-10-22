import type { PersonQueryResult } from '../shared/contracts'

type JsonObject = Record<string, unknown>

function object(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null
}

function pick(value: unknown, ...keys: string[]): unknown {
  let current: unknown = value

  for (const key of keys) {
    current = object(current)?.[key]
    if (current === undefined || current === null) return undefined
  }

  return current
}

function first(...values: unknown[]): unknown {
  return values.find((value) => value !== null && value !== undefined && value !== '')
}

function str(value: unknown): string {
  if (value === null || value === undefined) return ''

  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

function esc(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[c] ?? c
  )
}

function normal(value: unknown): string {
  return str(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
}

function dateBR(value: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(str(value))

  if (!match) return ''

  const [, year, month, day, hour, minute] = match

  if (
    Number(year) < 1900 ||
    Number(month) < 1 ||
    Number(month) > 12 ||
    Number(day) < 1 ||
    Number(day) > 31
  )
    return ''

  const time = hour && minute && (hour !== '00' || minute !== '00') ? ` ${hour}:${minute}` : ''

  return `${day}/${month}/${year}${time}`
}

function text(value: unknown, key = ''): string {
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'

  const original = str(value)
  if (!original) return ''

  if (/date|_at$|last_update/.test(key)) {
    return dateBR(original) || (/^0000-/.test(original) ? '' : original)
  }

  const enums: Record<string, Record<string, string>> = {
    gender: {
      M: 'Masculino',
      F: 'Feminino'
    },
    type: {
      MOBILE: 'Celular',
      LANDLINE: 'Fixo',
      PERSONAL: 'Pessoal',
      WORK: 'Profissional'
    },
    role: {
      ACTIVE: 'Ativo',
      PASSIVE: 'Passivo',
      NEUTRAL: 'Neutro'
    },
    status: {
      REGULAR: 'Regular',
      ACTIVE: 'Ativo',
      INACTIVE: 'Inativo'
    }
  }

  return enums[key]?.[original.toUpperCase()] ?? original
}

function cpfBR(value: unknown): string {
  const raw = str(value)
  const digits = raw.replace(/\D/g, '')

  return /^\d{11}$/.test(digits)
    ? digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
    : raw
}

function documentBR(value: unknown): string {
  const raw = str(value)
  const digits = raw.replace(/\D/g, '')

  if (digits.length === 11) return cpfBR(digits)

  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  }

  return raw
}

function cnjBR(value: unknown): string {
  const raw = str(value)
  const digits = raw.replace(/\D/g, '')

  return /^\d{20}$/.test(digits)
    ? digits.replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, '$1-$2.$3.$4.$5.$6')
    : raw
}

function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value

  const wrapped = object(value)

  return Array.isArray(wrapped?.items) ? wrapped.items : []
}

export function isCriminalProcess(value: unknown): boolean {
  const process = object(value)

  if (!process) return false

  const sphere = normal(process.court_type)

  if (/CRIMIN|\bPENAL\b/.test(sphere)) {
    return true
  }

  if (/CIVEL|TRABALH|FAMILIA|FAZENDA PUBLICA|ELEITORAL/.test(sphere)) {
    return false
  }

  return [
    process.court_branch,
    process.cnj_broad_subject_name,
    process.cnj_procedure_type_name,
    process.type
  ].some((field) =>
    /CRIMIN|\bDIREITO PENAL\b|\bINQUERITO POLICIAL\b|\bACAO PENAL\b|\bTERMO CIRCUNSTANCIADO\b/.test(
      normal(field)
    )
  )
}

function row(label: string, value: unknown, key = ''): string {
  const formatted = text(value, key)
  if (!formatted) return ''

  return `
    <div class="datum">
      <span>${esc(label)}</span>
      <strong>${esc(formatted)}</strong>
    </div>
  `
}

function table(headers: string[], rows: string[][]): string {
  if (!rows.length) {
    return '<p class="empty">Nenhum registro retornado.</p>'
  }

  const head = headers.map((heading) => `<th>${esc(heading)}</th>`).join('')

  const body = rows
    .map(
      (cells) => `
      <tr>
        ${cells.map((cell) => `<td>${esc(cell)}</td>`).join('')}
      </tr>
    `
    )
    .join('')

  return `
    <table>
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  `
}

function renderBasic(data: JsonObject): string {
  const tax = object(data.tax_id)

  const fields: Array<[string, unknown, string?]> = [
    ['Nascimento', data.birth_date, 'birth_date'],
    ['Idade', data.age],
    ['Sexo', data.gender, 'gender'],
    ['Nome da mãe', data.mother_name],
    ['Nome do pai', data.father_name],
    ['Nacionalidade', data.nationality],
    ['Situação do CPF', tax?.status, 'status'],
    ['Região fiscal', tax?.fiscal_region],
    ['Data de inscrição', tax?.registration_date, 'registration_date'],
    ['PIS', first(pick(data.pis, 'number'), data.pis_number)]
  ]

  return `
    <div class="facts">
      ${fields.map(([name, value, key]) => row(name, value, key)).join('')}
    </div>
  `
}

function phone(value: JsonObject): string {
  const cc = str(value.country_code)
  const area = str(value.area_code)
  const number = str(value.number)

  const formatted =
    number.length === 9
      ? `${number.slice(0, 5)}-${number.slice(5)}`
      : number.length === 8
        ? `${number.slice(0, 4)}-${number.slice(4)}`
        : number

  return `${cc ? '+' + cc + ' ' : ''}${area ? '(' + area + ') ' : ''}${formatted}`.trim()
}

function renderContacts(dataset: 'phones' | 'addresses' | 'emails', data: JsonObject): string {
  const items = list(data.items)

  if (dataset === 'phones') {
    return table(
      ['Telefone', 'Tipo', 'Operadora', 'Principal'],
      items.map((value) => {
        const item = object(value) ?? {}

        return [phone(item), text(item.type, 'type'), str(item.carrier), text(item.is_main)]
      })
    )
  }

  if (dataset === 'emails') {
    return table(
      ['E-mail', 'Tipo', 'Principal'],
      items.map((value) => {
        const item = object(value) ?? {}

        return [str(first(item.email, item.address)), text(item.type, 'type'), text(item.is_main)]
      })
    )
  }

  return table(
    ['Endereço', 'Cidade / UF', 'CEP'],
    items.map((value) => {
      const item = object(value) ?? {}

      const street = [item.street, item.street_name, item.address].map(str).find(Boolean) ?? ''

      const address = [
        street,
        str(first(item.street_number, item.number)),
        str(item.complement),
        str(first(item.district, item.neighborhood))
      ]
        .filter(Boolean)
        .join(', ')

      return [
        address || str(item.full_address),
        [str(item.city), str(item.state)].filter(Boolean).join(' / '),
        str(first(item.zip_code, item.postal_code))
      ]
    })
  )
}

function renderParties(process: JsonObject): string {
  const participants = list(first(process.parties, process.participants))

  if (!participants.length) return ''

  const rows = participants.map((value) => {
    const participant = object(value) ?? {}
    const details = object(participant.details)

    const role = text(
      first(participant.role, participant.pole, participant.side, participant.participation),
      'role'
    )

    const oab = [
      str(first(details?.oab_number, participant.oab_number)),
      str(first(details?.oab_state, participant.oab_state))
    ]
      .filter(Boolean)
      .join(' / ')

    return [
      str(participant.name),
      documentBR(first(participant.doc, participant.document, participant.tax_id)),
      role,
      str(first(details?.type, participant.type)),
      oab
    ]
  })

  return `
    <h4>Partes e participantes (${rows.length})</h4>
    ${table(['Nome', 'Documento', 'Polo', 'Participação', 'OAB'], rows)}
  `
}

function renderEvents(process: JsonObject): string {
  const events = list(first(process.events, process.movements, process.last_events))

  if (!events.length) return ''

  const rows = events.map((value) => {
    const event = object(value) ?? {}

    return [
      text(first(event.date, event.event_date), 'event_date'),
      str(first(event.content, event.description, event.text))
    ]
  })

  return `
    <h4>Movimentações retornadas (${rows.length})</h4>
    ${table(['Data', 'Movimentação'], rows)}
  `
}

function renderOtherList(process: JsonObject, key: string, heading: string): string {
  const items = list(process[key])
  if (!items.length) return ''

  const rows = items.map((value) => {
    const record = object(value)

    if (!record) return [str(value)]

    const description = Object.entries(record)
      .filter(([, item]) => item === null || typeof item !== 'object')
      .map(([name, item]) => `${name.replace(/_/g, ' ')}: ${text(item, name)}`)
      .filter((item) => !item.endsWith(': '))
      .join(' | ')

    return [description]
  })

  return `
    <h4>${esc(heading)} (${rows.length})</h4>
    ${table(['Informações retornadas'], rows)}
  `
}

function renderProcess(value: unknown, index: number): string {
  const process = object(value) ?? {}
  const criminal = isCriminalProcess(process)

  const number = cnjBR(first(process.number, process.process_number))

  const fields: Array<[string, unknown, string?]> = [
    ['Tipo de processo', process.type],
    ['Assunto principal', process.primary_subject],
    ['Esfera', process.court_type],
    ['Tribunal', first(process.court_name, process.court)],
    ['Vara / Unidade', process.court_branch],
    ['Comarca', process.court_district],
    ['Situação', process.status, 'status'],
    ['Classe CNJ', process.cnj_procedure_type_name],
    ['Área do direito', process.cnj_broad_subject_name],
    ['Última movimentação', process.last_event_date, 'last_event_date'],
    ['Última atualização', process.last_update_date, 'last_update_date']
  ]

  return `
    <article class="process ${criminal ? 'criminal' : 'ordinary'}">
      <div class="process-title">
        <h3>Processo ${index + 1} · ${esc(number)}</h3>
        <span>
          ${criminal ? 'ESFERA CRIMINAL' : esc(str(process.court_type) || 'Esfera não informada')}
        </span>
      </div>

      <div class="facts">
        ${fields.map(([name, value, key]) => row(name, value, key)).join('')}
      </div>

      ${renderParties(process)}
      ${renderEvents(process)}
      ${renderOtherList(process, 'petitions', 'Petições retornadas')}
      ${renderOtherList(process, 'decisions', 'Decisões retornadas')}
    </article>
  `
}

export function buildPersonReportHtml(result: PersonQueryResult): string {
  const findData = (dataset: string): JsonObject | null =>
    object(result.sections.find((section) => section.dataset === dataset)?.data)

  const basic = findData('basic')
  const name = first(pick(basic, 'name', 'full_name'), basic?.name, 'Não informado')

  const personName = typeof name === 'string' ? name : 'Não informado'

  const cpf = cpfBR(first(result.cpf, pick(basic, 'tax_id', 'number'), 'Não informado'))

  const processes = list(findData('lawsuits')?.items)

  const criminalCount = processes.filter(isCriminalProcess).length

  const total = first(findData('lawsuits')?.total, processes.length)

  const queryDate = new Date(result.queriedAt)

  const consultedAt = Number.isFinite(queryDate.getTime())
    ? queryDate.toLocaleString('pt-BR')
    : 'Não informado'

  const sections = result.sections
    .map((section) => {
      const data = object(section.data)

      if (!data) {
        return `
        <section class="group">
          <h2>${esc(section.dataset)}</h2>
          <p class="empty">Conjunto sem dados retornados.</p>
        </section>
      `
      }

      if (section.dataset === 'basic') {
        return `
        <section class="group">
          <h2>Identificação e situação cadastral</h2>
          ${renderBasic(data)}
        </section>
      `
      }

      if (section.dataset === 'lawsuits') {
        return `
        <section class="group">
          <h2>Processos judiciais</h2>
          <p class="overview">
            Total informado pela API: ${esc(total)}
            · Identificados como criminais: ${criminalCount}
          </p>

          ${
            processes.length
              ? processes.map(renderProcess).join('')
              : '<p class="empty">Nenhum processo retornado.</p>'
          }
        </section>
      `
      }

      const titles: Record<string, string> = {
        phones: 'Telefones',
        addresses: 'Endereços',
        emails: 'E-mails'
      }

      return `
      <section class="group">
        <h2>${esc(titles[section.dataset] ?? section.dataset)}</h2>
        ${renderContacts(section.dataset as 'phones' | 'addresses' | 'emails', data)}
      </section>
    `
    })
    .join('')

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"
  >
  <title>Relatório de pesquisa</title>
  <style>
    @page {
      size: A4;
      margin: 14mm 12mm 17mm;
    }

    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    body {
      margin: 0;
      color: #233044;
      font: 9pt/1.38 Arial, 'Segoe UI', sans-serif;
    }

    h1 {
      font-size: 17pt;
      letter-spacing: -.3px;
      margin: 0 0 2mm;
      color: #17324f;
    }

    .head {
      border-bottom: 2px solid #1f456c;
      padding-bottom: 5mm;
      margin-bottom: 5mm;
    }

    .subtitle {
      font-size: 8pt;
      color: #66758a;
    }

    .ident {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 3mm 6mm;
      margin-top: 4mm;
    }

    .ident div {
      min-width: 0;
    }

    .ident small {
      display: block;
      color: #65748a;
      font-size: 7.5pt;
    }

    .ident strong {
      font-size: 10pt;
      overflow-wrap: anywhere;
    }

    h2 {
      font-size: 11pt;
      color: #173a5e;
      background: #eef3f8;
      padding: 2.3mm 3mm;
      border-left: 3px solid #315d89;
      margin: 6mm 0 2mm;
      break-after: avoid;
    }

    h3 {
      font-size: 10pt;
      margin: 0;
    }

    h4 {
      font-size: 8.6pt;
      margin: 3mm 0 1mm;
      break-after: avoid;
    }

    .facts {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0 5mm;
    }

    .datum {
      padding: 1.6mm 0;
      border-bottom: 1px solid #e4eaf0;
      display: flex;
      align-items: start;
      gap: 3mm;
      break-inside: avoid;
      min-width: 0;
    }

    .datum span {
      width: 38%;
      flex: none;
      color: #647287;
    }

    .datum strong {
      font-weight: 500;
      overflow-wrap: anywhere;
      min-width: 0;
    }

    .group {
      break-inside: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8pt;
      table-layout: fixed;
    }

    thead {
      display: table-header-group;
    }

    th {
      text-align: left;
      background: #f2f5f9;
      color: #40536d;
    }

    th, td {
      padding: 1.6mm 1.5mm;
      border-bottom: 1px solid #e6ebf1;
      vertical-align: top;
      overflow-wrap: anywhere;
    }

    tr {
      break-inside: avoid;
    }

    .process {
      border: 1px solid #dce4ee;
      border-left: 3px solid #7d93aa;
      margin: 3.5mm 0;
      padding: 3mm;
      break-inside: auto;
      -webkit-box-decoration-break: clone;
      box-decoration-break: clone;
    }

    .process-title {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 4mm;
      border-bottom: 1px solid #e1e8f1;
      padding-bottom: 2mm;
      margin-bottom: 2mm;
      break-after: avoid;
    }

    .process-title span {
      font-size: 7.5pt;
      white-space: nowrap;
    }

    .process .datum {
      padding: 1.2mm 0;
    }

    .process.criminal {
      background: #fff3f3;
      border-color: #d14b4b;
    }

    .process.criminal,
    .process.criminal * {
      color: #a01818 !important;
      border-color: #e39a9a !important;
    }

    .process.criminal th {
      background: #ffe1e1 !important;
    }

    .process.criminal .process-title {
      background: #ffe5e5 !important;
      padding: 1.7mm 2mm;
    }

    .overview {
      margin: 2mm 0;
      font-size: 8.3pt;
      font-weight: 600;
    }

    .empty {
      font-size: 8.5pt;
      color: #6f7a88;
      font-style: italic;
      margin: 2mm 0;
    }
  </style>
</head>
<body>
  <header class="head">
    <h1>RELATÓRIO DE PESQUISA</h1>
    <div class="subtitle">Informações cadastrais e judiciais</div>

    <div class="ident">
      <div>
        <small>Nome</small>
        <strong>${esc(personName)}</strong>
      </div>

      <div>
        <small>CPF consultado</small>
        <strong>${esc(cpf)}</strong>
      </div>

      <div>
        <small>Data da consulta</small>
        <strong>${esc(consultedAt)}</strong>
      </div>


    </div>
  </header>

  ${sections}
</body>
</html>`
}
