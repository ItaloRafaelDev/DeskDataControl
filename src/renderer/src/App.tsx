import CpiOperationalQueue from './components/CpiOperationalQueue'
import CpiLinkPanel from './components/CpiLinkPanel'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  FluentProvider,
  webLightTheme,
  Button,
  Field,
  Input,
  Spinner
} from '@fluentui/react-components'
import {
  Home24Regular,
  Settings24Regular,
  ArrowClockwise20Regular,
  SignOut20Regular,
  Dismiss20Regular
} from '@fluentui/react-icons'
import type { ActivityItem, DeskDataSnapshot, OperationalSnapshot } from '../../shared/contracts'
import type {
  PersonQueryResult,
  PersonDataset,
  HistoryEntry,
  CpiPreview
} from '../../shared/contracts'
import { buildCpiFormPlan } from '../../shared/cpi-form-plan'
import type { SavedAccessInfo } from '../../shared/contracts'
import './assets/main.css'

type Page = 'operation' | 'deskdata'
type Action = 'connect' | 'balance' | 'disconnect' | 'query' | 'pdf' | 'recover' | 'history' | null

function formattedDate(value: string): string {
  return new Date(value).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  })
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Falha na operação.'
}

function App(): React.JSX.Element {
  const [operation, setOperation] = useState<OperationalSnapshot | null>(null)
  const [pdfDirectory, setPdfDirectory] = useState<string | null>(null)
  const [page, setPage] = useState<Page>('operation')
  const [snapshot, setSnapshot] = useState<DeskDataSnapshot | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberAccess, setRememberAccess] = useState(false)
  const [savedAccess, setSavedAccess] = useState<SavedAccessInfo | null>(null)
  const [manualLogin, setManualLogin] = useState(false)
  const [action, setAction] = useState<Action>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [cpf, setCpf] = useState('')
  const selectionKey = useRef('')
  const loadedHistoryId = useRef('')
  const selectedCpf = operation?.identity?.cpf ?? cpf
  const [confirmed, setConfirmed] = useState(false)
  const [queryResult, setQueryResult] = useState<PersonQueryResult | null>(null)
  const [showJson, setShowJson] = useState(false)
  const [recoveryCode, setRecoveryCode] = useState('')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [cpiSelectedId, setCpiSelectedId] = useState('')
  const [cpiPreview, setCpiPreview] = useState<CpiPreview | null>(null)
  const [cpiBusy, setCpiBusy] = useState(false)
  const cpiSessionOpen = operation?.connected ?? false
  const [cpiBrowserBusy, setCpiBrowserBusy] = useState(false)
  const [cpiCaptured, setCpiCaptured] = useState<Awaited<
    ReturnType<typeof window.deskdata.cpiReadOpenedIdentity>
  > | null>(null)
  const [cpiQueueInfo, setCpiQueueInfo] = useState<Awaited<
    ReturnType<typeof window.deskdata.cpiReadQueue>
  > | null>(null)
  const [cpiIdentityInfo, setCpiIdentityInfo] = useState<Awaited<
    ReturnType<typeof window.deskdata.cpiCheckIdentity>
  > | null>(null)
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null)
  const [selectedDatasets, setSelectedDatasets] = useState<PersonDataset[]>([
    'basic',
    'phones',
    'addresses',
    'emails',
    'lawsuits'
  ])

  useEffect(() => {
    document.title = 'DeskData Control'
    let mounted = true

    const unsubscribe = window.deskdata.onActivity((event: ActivityItem) => {
      if (!mounted) return

      setSnapshot((previous) =>
        previous
          ? {
              ...previous,
              activity: [event, ...previous.activity.filter((item) => item.id !== event.id)].slice(
                0,
                20
              )
            }
          : previous
      )
    })

    void window.deskdata
      .getSavedAccess()
      .then((saved) => {
        if (!mounted) return

        setSavedAccess(saved)

        if (saved.username) {
          setEmail(saved.username)
        }
      })
      .catch((reason: unknown) => {
        if (mounted) setError(errorText(reason))
      })

    void window.deskdata
      .getSnapshot()
      .then((result) => {
        if (mounted) setSnapshot(result)
      })
      .catch((reason: unknown) => {
        if (mounted) setError(errorText(reason))
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    const receiveOperation = (state: OperationalSnapshot): void => {
      if (!mounted) return
      const key = `${state.selected?.requestId ?? ''}:${state.selected?.researchId ?? ''}:${state.identity?.cpf ?? ''}`
      if (key !== selectionKey.current) {
        selectionKey.current = key
        setConfirmed(false)
        setQueryResult(null)
      }
      setOperation(state)
      const historyId = state.research?.historyId ?? ''
      if (!state.busy && historyId !== loadedHistoryId.current) {
        loadedHistoryId.current = historyId
        if (historyId)
          void window.deskdata
            .openHistory(historyId)
            .then((result) => {
              if (mounted && loadedHistoryId.current === historyId) setQueryResult(result)
            })
            .catch((reason: unknown) => {
              if (mounted) setError(errorText(reason))
            })
      }
    }
    const stopOperation = window.deskdata.onOperation(receiveOperation)
    void window.deskdata
      .getOperation()
      .then(receiveOperation)
      .catch((reason: unknown) => {
        if (mounted) setError(errorText(reason))
      })
    void window.deskdata
      .getPdfDirectory()
      .then((directory) => {
        if (mounted) setPdfDirectory(directory)
      })
      .catch((reason: unknown) => {
        if (mounted) setError(errorText(reason))
      })
    void refreshHistory()
    const onFocus = (): void => {
      void window.deskdata
        .getOperation()
        .then(receiveOperation)
        .catch((reason: unknown) => {
          if (mounted) setError(errorText(reason))
        })
    }
    window.addEventListener('focus', onFocus)
    return () => {
      mounted = false
      stopOperation()
      window.removeEventListener('focus', onFocus)
      unsubscribe()
    }
  }, [])

  async function changePdfDirectory(): Promise<void> {
    try {
      setPdfDirectory(await window.deskdata.changePdfDirectory())
    } catch (reason) {
      setError(errorText(reason))
    }
  }
  async function exportSelectedPdf(): Promise<void> {
    try {
      if (await window.deskdata.exportSelectedPdf())
        setPdfDirectory(await window.deskdata.getPdfDirectory())
    } catch (reason) {
      setError(errorText(reason))
    }
  }

  async function syncAfterError(reason: unknown): Promise<void> {
    setError(errorText(reason))
    try {
      setSnapshot(await window.deskdata.getSnapshot())
    } catch {
      setError('Falha na comunicação com o processo principal.')
    }
  }

  async function connect(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (action) return

    setAction('connect')
    setError(null)

    try {
      const result = await window.deskdata.connect({
        username: email,
        password,
        remember: rememberAccess
      })
      setSnapshot(result)
      setSavedAccess(await window.deskdata.getSavedAccess())
      setPage('operation')
    } catch (reason) {
      await syncAfterError(reason)
    } finally {
      setPassword('')
      setAction(null)
    }
  }

  async function connectWithSaved(): Promise<void> {
    if (action) return

    setAction('connect')
    setError(null)

    try {
      const result = await window.deskdata.connectSaved()

      setSnapshot(result)
      setPage('operation')
    } catch (reason) {
      await syncAfterError(reason)
    } finally {
      setPassword('')
      setAction(null)
    }
  }

  async function forgetSaved(): Promise<void> {
    if (action) return

    setAction('disconnect')
    setError(null)

    try {
      const result = await window.deskdata.forgetSavedAccess()

      setSavedAccess(result)
      setRememberAccess(false)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setAction(null)
    }
  }

  async function refreshBalance(): Promise<void> {
    if (action) return

    setAction('balance')
    setError(null)

    try {
      setSnapshot(await window.deskdata.refreshBalance())
    } catch (reason) {
      await syncAfterError(reason)
    } finally {
      setAction(null)
    }
  }

  async function disconnect(): Promise<void> {
    if (action) return

    setAction('disconnect')
    setError(null)

    try {
      setSnapshot(await window.deskdata.disconnect())
      setQueryResult(null)
    } catch (reason) {
      await syncAfterError(reason)
    } finally {
      setAction(null)
    }
  }

  async function searchProcesses(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (action || !confirmed) return

    setAction('query')
    setError(null)
    setQueryResult(null)
    setShowJson(false)

    try {
      const result = await window.deskdata.queryPerson({
        cpf: selectedCpf,
        cpiContext: !!operation?.identity,
        confirmed,
        datasets: selectedDatasets
      })

      setQueryResult(result)
      if (!operation?.identity) setCpf('')
      void refreshHistory()
      setConfirmed(false)

      try {
        setSnapshot(await window.deskdata.getSnapshot())
      } catch {
        setError('Consulta concluída, mas o painel não foi atualizado.')
      }
    } catch (reason) {
      await syncAfterError(reason)
    } finally {
      setAction(null)
    }
  }

  async function recoverQuery(): Promise<void> {
    if (action) return

    setAction('recover')
    setError(null)
    setRecoveryNotice(null)
    setQueryResult(null)
    setShowJson(false)

    try {
      const response = await window.deskdata.recoverQuery({
        queryCode: recoveryCode
      })

      if (response.state === 'processing') {
        setRecoveryNotice(
          `A consulta ${response.queryCode} ainda está em processamento. Você poderá verificar novamente usando o mesmo código.`
        )
        return
      }

      setQueryResult(response.result)
      setRecoveryNotice('Pesquisa recuperada com sucesso.')
    } catch (reason) {
      await syncAfterError(reason)
    } finally {
      setAction(null)
    }
  }

  async function refreshHistory(): Promise<void> {
    setHistoryLoading(true)

    try {
      setHistory(await window.deskdata.listHistory())
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setHistoryLoading(false)
    }
  }

  async function openSavedResearch(id: string): Promise<void> {
    if (action) return

    setAction('history')
    setError(null)

    try {
      const result = await window.deskdata.openHistory(id)

      setQueryResult(result)
      setShowJson(false)
      setConfirmed(false)
      setPage('operation')
    } catch (reason) {
      await syncAfterError(reason)
    } finally {
      setAction(null)
    }
  }

  async function runCpiBrowser(
    operation: 'open' | 'queue' | 'capture' | 'identity' | 'close'
  ): Promise<void> {
    if (cpiBrowserBusy || cpiBusy || action !== null) return

    setCpiBrowserBusy(true)
    setError(null)

    try {
      if (operation === 'open') {
        await window.deskdata.cpiOpen()
        setCpiQueueInfo(null)
        setCpiIdentityInfo(null)
      }

      if (operation === 'capture') {
        const identity = await window.deskdata.cpiReadOpenedIdentity()
        setCpiCaptured(identity)
        setCpiIdentityInfo(null)
      }

      if (operation === 'queue') {
        const result = await window.deskdata.cpiReadQueue()
        setCpiQueueInfo(result)
      }

      if (operation === 'identity') {
        if (!cpiSelectedId) {
          throw new Error('Selecione uma pesquisa no histórico.')
        }

        const result = await window.deskdata.cpiCheckIdentity(cpiSelectedId)
        setCpiIdentityInfo(result)
      }

      if (operation === 'close') {
        await window.deskdata.cpiClose()
        setCpiCaptured(null)
        setCpiQueueInfo(null)
        setCpiIdentityInfo(null)
      }
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setCpiBrowserBusy(false)
    }
  }

  async function prepareCpi(): Promise<void> {
    if (!cpiSelectedId || cpiBusy || action !== null) return

    setCpiBusy(true)
    setCpiPreview(null)
    setError(null)

    try {
      const result = await window.deskdata.prepareCpi(cpiSelectedId)

      setCpiPreview(result)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setCpiBusy(false)
    }
  }

  async function exportPdf(): Promise<void> {
    if (action || !queryResult) return

    setAction('pdf')
    setError(null)

    try {
      const saved = await window.deskdata.exportPdf()

      if (saved) {
        setPdfDirectory(await window.deskdata.getPdfDirectory())
        setSnapshot(await window.deskdata.getSnapshot())
      }
    } catch (reason) {
      await syncAfterError(reason)
    } finally {
      setAction(null)
    }
  }

  const cpiPlan = cpiPreview ? buildCpiFormPlan(cpiPreview) : null

  const connected = snapshot?.connected ?? false
  const balance = snapshot?.balance
  const activities = snapshot?.activity ?? []
  const inProgress = action !== null || !!operation?.busy

  return (
    <FluentProvider theme={webLightTheme} className="app-root">
      <header className="app-header">
        <div className="identity">
          <div className="identity-icon" aria-hidden="true">
            D
          </div>
          <strong>
            DeskData <span>Control</span>
          </strong>
        </div>

        <nav className="app-nav" aria-label="Navegação principal">
          <button
            type="button"
            className={`app-tab ${page === 'operation' ? 'selected' : ''}`}
            onClick={() => {
              setPage('operation')
              void refreshHistory()
            }}
          >
            <Home24Regular /> Central de Pesquisas
          </button>
          <button
            type="button"
            className={`app-tab ${page === 'deskdata' ? 'selected' : ''}`}
            onClick={() => setPage('deskdata')}
            aria-label="Configurações"
            title="Configurações"
          >
            <Settings24Regular />
          </button>
        </nav>

        <div className="header-status">
          <span className={`connection-dot ${connected ? 'connected' : ''}`} aria-hidden="true" />
          {connected ? 'API conectada' : 'API desconectada'}
        </div>
      </header>

      <div className="work-area">
        <main className="canvas">
          {error && (
            <div role="alert" className="error-banner">
              <span>{error}</span>
              <button type="button" onClick={() => setError(null)} aria-label="Fechar aviso">
                <Dismiss20Regular />
              </button>
            </div>
          )}

          {loading ? (
            <div className="loading">
              <Spinner label="Carregando estado do aplicativo" />
            </div>
          ) : (
            <div className="page-wrap">
              {page === 'operation' && (
                <>
                  <div className="page-head central-heading">
                    <h1>Central de Pesquisas</h1>
                    <span>
                      Saldo: {balance == null ? '—' : balance.toLocaleString('pt-BR')} · CPI:{' '}
                      {operation?.connected ? 'Sessão confirmada' : 'Validar sessão'} ·{' '}
                      {operation?.step ?? 'Carregando operação'}
                    </span>
                    <Button
                      size="small"
                      disabled={inProgress}
                      onClick={() => (connected ? void refreshBalance() : setPage('deskdata'))}
                    >
                      {connected ? 'Atualizar saldo' : 'Conectar DeskData'}
                    </Button>
                  </div>
                  <CpiOperationalQueue
                    state={operation}
                    queryRequest={{ confirmed, datasets: selectedDatasets }}
                    externalBusy={inProgress}
                    onError={setError}
                    onSavePdf={() => void exportSelectedPdf()}
                    onUseCpf={(value) => {
                      setCpf(value)
                      setConfirmed(false)
                    }}
                  >
                    <details
                      className="central-query"
                      open={operation?.research?.historyState !== 'unique'}
                    >
                      <summary>Consultar ou recuperar DeskData</summary>
                      <section className="section-card query-section">
                        <div className="section-bar">
                          <h2>Pesquisa de pessoa</h2>
                          <span>Consulta por CPF</span>
                        </div>

                        <form
                          className="query-form"
                          onSubmit={(event) => void searchProcesses(event)}
                        >
                          <div className="query-controls">
                            <Field label="CPF">
                              <Input
                                value={selectedCpf}
                                onChange={(_, data) => setCpf(data.value)}
                                placeholder="000.000.000-00"
                                inputMode="numeric"
                                autoComplete="off"
                                maxLength={14}
                                disabled={!connected || inProgress || !!operation?.identity}
                                required
                              />
                            </Field>

                            <Button
                              appearance="primary"
                              type="submit"
                              disabled={
                                !connected ||
                                inProgress ||
                                !confirmed ||
                                selectedDatasets.length === 0 ||
                                (!!operation?.identity &&
                                  operation.research?.historyState !== 'missing')
                              }
                            >
                              {action === 'query' ? 'Consultando...' : 'Executar pesquisa'}
                            </Button>
                          </div>

                          <fieldset className="dataset-fieldset">
                            <legend>Conjuntos de dados</legend>

                            <div className="dataset-grid">
                              {(
                                [
                                  ['basic', 'Dados básicos'],
                                  ['phones', 'Telefones'],
                                  ['addresses', 'Endereços'],
                                  ['emails', 'E-mails'],
                                  ['lawsuits', 'Processos judiciais']
                                ] as const
                              ).map(([key, label]) => (
                                <label className="dataset-option" key={key}>
                                  <input
                                    type="checkbox"
                                    checked={selectedDatasets.includes(key)}
                                    disabled={!connected || inProgress}
                                    onChange={(event) => {
                                      const checked = event.target.checked

                                      setSelectedDatasets((previous) =>
                                        checked
                                          ? [...new Set([...previous, key])]
                                          : previous.filter((item) => item !== key)
                                      )
                                    }}
                                  />
                                  {label}
                                </label>
                              ))}
                            </div>
                          </fieldset>

                          <label className="query-confirmation">
                            <input
                              type="checkbox"
                              checked={confirmed}
                              onChange={(event) => setConfirmed(event.target.checked)}
                              disabled={!connected || inProgress}
                            />
                            <span>
                              Confirmo que a pesquisa é autorizada e poderá consumir créditos.
                            </span>
                          </label>
                        </form>
                      </section>

                      <section className="section-card recovery-section">
                        <div className="section-bar">
                          <h2>Recuperar consulta</h2>
                          <span>Consulta já realizada</span>
                        </div>

                        <form
                          className="recovery-form"
                          onSubmit={(event) => {
                            event.preventDefault()
                            void recoverQuery()
                          }}
                        >
                          <Field label="Código da consulta">
                            <Input
                              value={recoveryCode}
                              onChange={(_, data) => setRecoveryCode(data.value.toUpperCase())}
                              placeholder="Q-ABC123DEF4"
                              maxLength={12}
                              autoComplete="off"
                              disabled={!connected || inProgress}
                              required
                            />
                          </Field>

                          <Button
                            appearance="secondary"
                            type="submit"
                            disabled={
                              !connected || inProgress || !/^Q-[A-F0-9]{10}$/.test(recoveryCode)
                            }
                          >
                            {action === 'recover' ? 'Recuperando...' : 'Recuperar resultado'}
                          </Button>
                        </form>

                        {recoveryNotice && (
                          <p className="recovery-notice" role="status">
                            {recoveryNotice}
                          </p>
                        )}
                      </section>
                    </details>
                    {queryResult && (
                      <section className="section-card result-section">
                        <div className="section-bar">
                          <h2>Resultado DeskData aberto</h2>
                          <div className="result-actions">
                            <Button
                              appearance="secondary"
                              type="button"
                              disabled={inProgress}
                              onClick={() => void exportPdf()}
                            >
                              {action === 'pdf' ? 'Gerando PDF...' : 'Salvar PDF'}
                            </Button>
                            <button
                              className="json-toggle"
                              type="button"
                              onClick={() => setShowJson(!showJson)}
                            >
                              {showJson ? 'Ver conjuntos' : 'Ver JSON'}
                            </button>
                          </div>
                        </div>

                        <div className="result-summary">
                          <span>CPF: {queryResult.cpf || 'Não informado pela API'}</span>
                          <strong>{queryResult.sections.length} conjunto(s)</strong>
                        </div>

                        {showJson ? (
                          <pre className="json-output">{JSON.stringify(queryResult, null, 2)}</pre>
                        ) : (
                          <div className="dataset-results">
                            {queryResult.sections.map((section) => {
                              const titles: Record<PersonDataset, string> = {
                                basic: 'Dados básicos',
                                phones: 'Telefones',
                                addresses: 'Endereços',
                                emails: 'E-mails',
                                lawsuits: 'Processos judiciais'
                              }

                              return (
                                <details key={section.dataset} className="dataset-result">
                                  <summary>
                                    <span>{titles[section.dataset]}</span>

                                    <span className="dataset-count">
                                      {!section.present
                                        ? 'Sem objeto retornado'
                                        : section.total === null
                                          ? 'Disponível'
                                          : `${section.total} registro(s)`}
                                    </span>
                                  </summary>

                                  <div className="dataset-body">
                                    {section.data ? (
                                      <>
                                        {section.returnedItems !== null &&
                                          section.returnedItems > 100 && (
                                            <p className="dataset-notice">
                                              Exibindo até 100 de {section.returnedItems} itens
                                              recebidos.
                                            </p>
                                          )}

                                        <pre>{JSON.stringify(section.data, null, 2)}</pre>
                                      </>
                                    ) : (
                                      <p>A API não retornou um objeto para este conjunto.</p>
                                    )}
                                  </div>
                                </details>
                              )
                            })}
                          </div>
                        )}
                      </section>
                    )}
                    <details className="central-history">
                      <summary>Histórico local — consultar e recuperar</summary>{' '}
                      <section className="section-card history-panel">
                        <div className="section-bar">
                          <h2>Pesquisas registradas</h2>
                          <span>{history.length} registro(s)</span>
                        </div>

                        {historyLoading ? (
                          <div className="empty-state">Carregando histórico...</div>
                        ) : history.length === 0 ? (
                          <div className="empty-state">
                            Nenhuma pesquisa armazenada. Recupere uma consulta anterior pelo código
                            ou execute uma nova pesquisa autorizada.
                          </div>
                        ) : (
                          <div className="history-scroll">
                            <table className="history-table">
                              <thead>
                                <tr>
                                  <th>Data</th>
                                  <th>CPF</th>
                                  <th>Código DeskData</th>
                                  <th>Conjuntos</th>
                                  <th>Situação</th>
                                  <th>Ação</th>
                                </tr>
                              </thead>

                              <tbody>
                                {history.map((item) => {
                                  const statusLabel = {
                                    pending: 'Iniciada',
                                    processing: 'Processando',
                                    completed: 'Concluída',
                                    uncertain: 'Não confirmada'
                                  }[item.status]

                                  return (
                                    <tr key={item.id}>
                                      <td>{formattedDate(item.createdAt)}</td>

                                      <td className="history-cpf">{item.cpf || 'Não informado'}</td>

                                      <td className="history-code">
                                        {item.queryCode || 'Não retornado'}
                                      </td>

                                      <td>{item.datasets.join(', ') || '—'}</td>

                                      <td>{statusLabel}</td>

                                      <td>
                                        {item.hasResult ? (
                                          <Button
                                            size="small"
                                            appearance="secondary"
                                            disabled={action !== null}
                                            onClick={() => void openSavedResearch(item.id)}
                                          >
                                            Abrir
                                          </Button>
                                        ) : item.queryCode ? (
                                          <Button
                                            size="small"
                                            appearance="secondary"
                                            onClick={() => {
                                              setRecoveryCode(item.queryCode || '')
                                              setPage('operation')
                                            }}
                                          >
                                            Recuperar
                                          </Button>
                                        ) : (
                                          <span className="history-muted">Indisponível</span>
                                        )}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </section>
                    </details>
                  </CpiOperationalQueue>
                  <div className="central-status" role="status">
                    <span>
                      {operation?.busy
                        ? 'Operação em andamento…'
                        : operation?.message ||
                          activities[0]?.message ||
                          'Selecione uma solicitação ou consulte o histórico local.'}
                    </span>
                    <small>Destino PDF: {pdfDirectory ?? 'Escolher na primeira exportação'}</small>
                    <Button
                      size="small"
                      appearance="subtle"
                      disabled={inProgress}
                      onClick={() => void changePdfDirectory()}
                    >
                      Alterar pasta
                    </Button>
                  </div>
                </>
              )}

              {page === 'deskdata' && (
                <>
                  <div className="page-head">
                    <h1>Conta DeskData</h1>
                    <p>Gerencie a autenticação e o saldo de créditos.</p>
                  </div>

                  <section className="section-card account-card">
                    <div className="section-bar">
                      <h2>Sessão da API</h2>
                      <span className={connected ? 'state-connected' : ''}>
                        {connected ? 'Conectada' : 'Não conectada'}
                      </span>
                    </div>

                    {connected ? (
                      <div className="account-content">
                        <div className="account-row">
                          <span>Créditos disponíveis</span>
                          <strong>
                            {balance == null ? 'Não disponível' : balance.toLocaleString('pt-BR')}
                          </strong>
                        </div>

                        <div className="account-row">
                          <span>Expiração do token</span>
                          <strong>
                            {snapshot?.tokenExpiresAt
                              ? formattedDate(snapshot.tokenExpiresAt)
                              : '—'}
                          </strong>
                        </div>

                        <div className="account-actions">
                          <Button
                            appearance="secondary"
                            icon={<SignOut20Regular />}
                            disabled={inProgress}
                            onClick={() => void disconnect()}
                          >
                            Desconectar
                          </Button>

                          <Button
                            appearance="primary"
                            icon={<ArrowClockwise20Regular />}
                            disabled={inProgress}
                            onClick={() => void refreshBalance()}
                          >
                            {action === 'balance' ? 'Consultando...' : 'Atualizar saldo'}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <form
                        className="login-form"
                        onSubmit={(event) => void connect(event)}
                        autoComplete="off"
                      >
                        {savedAccess?.available && !manualLogin && (
                          <div className="stored-access">
                            <div className="stored-access-main">
                              <div className="stored-access-icon" aria-hidden="true">
                                D
                              </div>

                              <div className="stored-access-identity">
                                <span>Conta salva</span>
                                <strong>{savedAccess.username ?? 'Acesso protegido'}</strong>
                              </div>

                              <Button
                                appearance="primary"
                                type="button"
                                disabled={inProgress}
                                onClick={() => void connectWithSaved()}
                              >
                                Entrar
                              </Button>
                            </div>

                            <div className="stored-access-footer">
                              <span>Credenciais protegidas neste computador</span>

                              <div className="stored-access-links">
                                <button
                                  type="button"
                                  disabled={inProgress}
                                  onClick={() => {
                                    setManualLogin(true)
                                    setEmail('')
                                    setPassword('')
                                    setRememberAccess(false)
                                  }}
                                >
                                  Usar outra conta
                                </button>

                                <button
                                  type="button"
                                  className="stored-access-remove"
                                  disabled={inProgress}
                                  onClick={() => void forgetSaved()}
                                >
                                  Esquecer acesso
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {(!savedAccess?.available || manualLogin) && (
                          <>
                            {savedAccess?.available && (
                              <div className="manual-access-heading">
                                <strong>Entrar com outra conta</strong>

                                <button
                                  type="button"
                                  disabled={inProgress}
                                  onClick={() => {
                                    setManualLogin(false)
                                    setEmail(savedAccess.username ?? '')
                                    setPassword('')
                                  }}
                                >
                                  Voltar à conta salva
                                </button>
                              </div>
                            )}
                            <Field label="E-mail" required>
                              <Input
                                type="email"
                                value={email}
                                onChange={(_, data) => setEmail(data.value)}
                                disabled={inProgress}
                                maxLength={254}
                                autoComplete="off"
                                required
                              />
                            </Field>

                            <Field label="Senha" required>
                              <Input
                                type="password"
                                value={password}
                                onChange={(_, data) => setPassword(data.value)}
                                disabled={inProgress}
                                maxLength={256}
                                autoComplete="off"
                                required
                              />
                            </Field>

                            <label className="remember-access">
                              <input
                                type="checkbox"
                                checked={rememberAccess}
                                disabled={inProgress}
                                onChange={(event) => setRememberAccess(event.target.checked)}
                              />
                              <span>Lembrar e-mail e senha neste computador</span>
                            </label>

                            <p className="hint">
                              Credenciais utilizadas somente durante a autenticação. A sessão fica
                              na memória do aplicativo.
                            </p>

                            <div className="account-actions">
                              <Button type="submit" appearance="primary" disabled={inProgress}>
                                {action === 'connect' ? 'Conectando...' : 'Conectar'}
                              </Button>
                            </div>
                          </>
                        )}
                      </form>
                    )}
                  </section>
                  <details className="cpi-advanced">
                    <summary>Diagnóstico e vínculos CPI</summary>
                    <section className="section-card cpi-browser-panel">
                      <div className="section-bar">
                        <h2>Conexão com CPI</h2>
                        <span>Somente leitura</span>
                      </div>

                      <div className="cpi-browser-body">
                        <div className="cpi-browser-actions">
                          <Button
                            appearance="primary"
                            type="button"
                            disabled={cpiBrowserBusy || cpiSessionOpen}
                            onClick={() => void runCpiBrowser('open')}
                          >
                            Abrir CPI
                          </Button>

                          <Button
                            appearance="secondary"
                            type="button"
                            disabled={cpiBrowserBusy || !cpiSessionOpen}
                            onClick={() => void runCpiBrowser('queue')}
                          >
                            Verificar fila
                          </Button>

                          <Button
                            appearance="secondary"
                            type="button"
                            disabled={cpiBrowserBusy || !cpiSessionOpen}
                            onClick={() => void runCpiBrowser('capture')}
                          >
                            Ler CPF aberto
                          </Button>

                          <Button
                            appearance="secondary"
                            type="button"
                            disabled={cpiBrowserBusy || !cpiSessionOpen || !cpiSelectedId}
                            onClick={() => void runCpiBrowser('identity')}
                          >
                            Conferir CPF
                          </Button>

                          <Button
                            appearance="subtle"
                            type="button"
                            disabled={cpiBrowserBusy || !cpiSessionOpen}
                            onClick={() => void runCpiBrowser('close')}
                          >
                            Encerrar sessão
                          </Button>
                        </div>

                        <p className="cpi-browser-help">
                          Faça o login manualmente na janela CPI. Para conferir o CPF, abra
                          manualmente a pesquisa correspondente à selecionada no histórico.
                        </p>

                        {cpiCaptured && (
                          <div className="cpi-browser-result" role="status">
                            <p>
                              CPF identificado na CPI:
                              <strong> {cpiCaptured.maskedCpf}</strong>
                            </p>
                            <Button
                              appearance="primary"
                              type="button"
                              disabled={cpiBrowserBusy}
                              onClick={() => {
                                setCpf(cpiCaptured.cpf)
                                setConfirmed(false)
                                setQueryResult(null)
                                setCpiPreview(null)
                                setCpiSelectedId('')
                                setShowJson(false)
                                setPage('operation')
                              }}
                            >
                              Usar CPF na pesquisa
                            </Button>
                          </div>
                        )}

                        {cpiQueueInfo && (
                          <p className="cpi-browser-result" role="status">
                            Fila:{' '}
                            {cpiQueueInfo.state === 'HAS_RESEARCH'
                              ? 'Pesquisas identificadas'
                              : cpiQueueInfo.state === 'EMPTY'
                                ? 'Sem pesquisas'
                                : cpiQueueInfo.state === 'LOGIN_REQUIRED'
                                  ? 'Login ou navegação à fila necessária'
                                  : 'Situação não confirmada'}
                            {' · '}Linhas visíveis: {cpiQueueInfo.visibleRows}
                          </p>
                        )}

                        {cpiIdentityInfo && (
                          <p
                            className={
                              cpiIdentityInfo.match
                                ? 'cpi-browser-result matched'
                                : 'cpi-browser-result mismatch'
                            }
                            role="status"
                          >
                            {cpiIdentityInfo.match
                              ? 'CPF da CPI corresponde ao histórico selecionado.'
                              : 'CPF diferente. Não prossiga com esta pesquisa.'}
                          </p>
                        )}
                      </div>
                    </section>

                    <CpiLinkPanel
                      selectedHistoryId={cpiSelectedId}
                      sessionOpen={cpiSessionOpen}
                      onLinked={(link) => {
                        setCpiSelectedId(link.historyId)
                        setCpiPreview(null)

                        void window.deskdata
                          .prepareCpi(link.historyId)
                          .then((preview) => {
                            setCpiPreview(preview)
                            setError(null)
                          })
                          .catch((reason: unknown) => {
                            setError(errorText(reason))
                          })
                      }}
                    />

                    <section className="section-card cpi-review">
                      <div className="section-bar">
                        <h2>Preparação de pesquisa</h2>
                        <span>Simulação local</span>
                      </div>

                      <div className="cpi-review-content">
                        <label htmlFor="cpi-history-select">Pesquisa concluída no histórico</label>

                        <div className="cpi-review-controls">
                          <select
                            id="cpi-history-select"
                            className="cpi-review-select"
                            value={cpiSelectedId}
                            disabled={cpiBusy}
                            onChange={(event) => {
                              setCpiSelectedId(event.target.value)
                              setCpiPreview(null)
                            }}
                          >
                            <option value="">Selecione uma pesquisa</option>

                            {history
                              .filter((item) => item.hasResult)
                              .map((item) => (
                                <option value={item.id} key={item.id}>
                                  {formattedDate(item.createdAt)}
                                  {' · '}
                                  {item.cpf || 'CPF indisponível'}
                                  {' · '}
                                  {item.queryCode || 'Sem código'}
                                </option>
                              ))}
                          </select>

                          <Button
                            type="button"
                            appearance="primary"
                            disabled={!cpiSelectedId || cpiBusy || action !== null}
                            onClick={() => void prepareCpi()}
                          >
                            {cpiBusy ? 'Analisando...' : 'Preparar prévia'}
                          </Button>
                        </div>

                        {cpiPreview && (
                          <div className="cpi-preview-output">
                            <div
                              className={`cpi-proposed-answer ${
                                cpiPreview.classification === 'CONSTA_RESTRICAO'
                                  ? 'restriction'
                                  : cpiPreview.classification === 'INDEFINIDO'
                                    ? 'review'
                                    : 'information'
                              }`}
                            >
                              <div>
                                <span>Resposta prevista na CPI</span>
                                <strong>{cpiPreview.classificationLabel}</strong>
                              </div>
                              <small>Classificação preliminar — aguardando revisão</small>
                            </div>

                            <div className="cpi-preview-summary">
                              <div>
                                <span>Processos recebidos</span>
                                <strong>{cpiPreview.totalReceived}</strong>
                              </div>
                              <div>
                                <span>Esfera criminal</span>
                                <strong>{cpiPreview.criminal}</strong>
                              </div>
                              <div>
                                <span>Criminais com CPF localizado</span>
                                <strong>{cpiPreview.criminalWithDocument}</strong>
                              </div>
                              <div>
                                <span>Esfera indefinida</span>
                                <strong>{cpiPreview.unknown}</strong>
                              </div>
                            </div>

                            {cpiPlan && (
                              <section className="cpi-form-plan">
                                <div className="cpi-form-plan-heading">
                                  <h3>Campos previstos para a CPI</h3>
                                  <span>
                                    {cpiPlan.readyForReview
                                      ? 'Pronto para revisão'
                                      : 'Revisão necessária'}
                                  </span>
                                </div>

                                <dl className="cpi-form-plan-fields">
                                  <div>
                                    <dt>Resultado</dt>
                                    <dd>
                                      {cpiPlan.resultLabel ?? 'Não definido'}
                                      {cpiPlan.resultSelector ? ` (${cpiPlan.resultSelector})` : ''}
                                    </dd>
                                  </div>

                                  <div>
                                    <dt>Status</dt>
                                    <dd>{cpiPlan.statusLabel}</dd>
                                  </div>

                                  <div>
                                    <dt>Pesquisador / Fonte</dt>
                                    <dd>{cpiPlan.researcherLabel}</dd>
                                  </div>

                                  <div>
                                    <dt>Pesquisador / Fonte 1º</dt>
                                    <dd>{cpiPlan.primaryResearcherLabel}</dd>
                                  </div>

                                  <div>
                                    <dt>Documento</dt>
                                    <dd>Relatório PDF — geração local</dd>
                                  </div>
                                </dl>

                                {cpiPlan.issues.length > 0 && (
                                  <ul className="cpi-plan-issues">
                                    {cpiPlan.issues.map((issue) => (
                                      <li key={issue}>{issue}</li>
                                    ))}
                                  </ul>
                                )}

                                <p className="cpi-plan-footer">
                                  Somente preparação local. Nenhum campo foi preenchido ou gravado
                                  no portal.
                                </p>
                              </section>
                            )}

                            {cpiPreview.warnings.length > 0 && (
                              <div className="cpi-review-warnings">
                                {cpiPreview.warnings.map((warning) => (
                                  <p key={warning}>{warning}</p>
                                ))}
                              </div>
                            )}

                            <div className="cpi-process-scroll">
                              <table className="cpi-process-table">
                                <thead>
                                  <tr>
                                    <th>Processo</th>
                                    <th>Esfera</th>
                                    <th>Situação</th>
                                    <th>Participação</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {cpiPreview.processes.map((process, index) => (
                                    <tr
                                      key={`${process.number}-${index}`}
                                      className={
                                        process.sphere === 'criminal' ? 'cpi-criminal' : ''
                                      }
                                    >
                                      <td>{process.number}</td>
                                      <td>{process.courtType || 'Não identificada'}</td>
                                      <td>{process.situation || 'Não informada'}</td>
                                      <td>
                                        {process.participation === 'document_matched'
                                          ? process.roles.join(', ') ||
                                            'CPF localizado; papel não informado'
                                          : 'Não verificada por CPF'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            {cpiPreview.truncated && (
                              <p className="cpi-review-note">Prévia limitada a 100 processos.</p>
                            )}

                            <p className="cpi-review-note">
                              Preparação para revisão. Nenhuma classificação ou informação foi
                              enviada à CPI.
                            </p>
                          </div>
                        )}
                      </div>
                    </section>
                  </details>
                </>
              )}
            </div>
          )}
        </main>
      </div>
    </FluentProvider>
  )
}

export default App
