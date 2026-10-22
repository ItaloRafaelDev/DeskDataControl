import { useEffect, useState, type FormEvent } from 'react'
import type { CpiLinkRecord } from '../../../shared/contracts'

interface Props {
  selectedHistoryId: string
  sessionOpen: boolean
  onLinked: (link: CpiLinkRecord) => void
}

export default function CpiLinkPanel({
  selectedHistoryId,
  sessionOpen,
  onLinked
}: Props): React.JSX.Element {
  const [reference, setReference] = useState('')
  const [links, setLinks] = useState<CpiLinkRecord[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    void window.deskdata
      .cpiListLinks()
      .then((result) => {
        if (active) setLinks(result)
      })
      .catch(() => {
        if (active) {
          setError('Não foi possível carregar os vínculos salvos.')
        }
      })

    return () => {
      active = false
    }
  }, [])

  async function bindOpened(): Promise<void> {
    if (busy || !sessionOpen) return

    setBusy(true)
    setError(null)
    setNotice(null)

    try {
      const saved = await window.deskdata.cpiBindOpened()

      setLinks(await window.deskdata.cpiListLinks())

      onLinked(saved)

      setNotice(`Solicitacao ${saved.cpiReference} vinculada ao historico.`)
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Nao foi possivel vincular a solicitacao.'
      )
    } finally {
      setBusy(false)
    }
  }

  async function bind(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (!selectedHistoryId || busy || !sessionOpen) return

    setBusy(true)
    setError(null)
    setNotice(null)

    try {
      const saved = await window.deskdata.cpiBind({
        cpiReference: reference,
        historyId: selectedHistoryId
      })

      setLinks(await window.deskdata.cpiListLinks())
      onLinked(saved)

      setNotice(`Referência ${saved.cpiReference} vinculada. Revisão pendente.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao vincular a pesquisa.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="section-card cpi-link-panel">
      <div className="section-bar">
        <h2>Vincular solicitação CPI</h2>
        <span>Armazenamento local</span>
      </div>

      <div className="cpi-link-content">
        <p className="cpi-link-description">
          Abra a solicitacao no navegador CPI. O aplicativo identificara automaticamente seu ID e
          localizara a pesquisa correspondente pelo CPF no historico.
        </p>

        <button
          type="button"
          className="cpi-link-submit"
          disabled={!sessionOpen || busy}
          onClick={() => void bindOpened()}
        >
          {busy ? 'Conferindo solicitacao...' : 'Identificar e vincular pesquisa aberta'}
        </button>

        <details className="cpi-link-advanced">
          <summary>Vinculacao manual</summary>
          <form className="cpi-link-form" onSubmit={(event) => void bind(event)}>
            <div className="cpi-link-field">
              <label htmlFor="cpi-reference">ID da solicitação CPI</label>
              <input
                id="cpi-reference"
                value={reference}
                onChange={(event) =>
                  setReference(event.target.value.replace(/\D/g, '').slice(0, 15))
                }
                placeholder="Número da coluna ID Solicit."
                inputMode="numeric"
                autoComplete="off"
                required
                disabled={busy}
              />
            </div>

            <button
              type="submit"
              className="cpi-link-submit"
              disabled={busy || !sessionOpen || !selectedHistoryId || !/^\d{1,15}$/.test(reference)}
            >
              {busy ? 'Conferindo...' : 'Conferir e vincular'}
            </button>
          </form>
        </details>

        {!selectedHistoryId && (
          <p className="cpi-link-hint">Selecione uma pesquisa concluída na seção abaixo.</p>
        )}

        {error && (
          <p className="cpi-link-error" role="alert">
            {error}
          </p>
        )}

        {notice && (
          <p className="cpi-link-success" role="status">
            {notice}
          </p>
        )}

        {links.length > 0 && (
          <div className="cpi-link-history">
            <h3>Solicitações vinculadas</h3>
            <div className="cpi-link-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Referência CPI</th>
                    <th>CPF</th>
                    <th>Verificação</th>
                    <th>Estado local</th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((link) => (
                    <tr key={link.cpiReference}>
                      <td>{link.cpiReference}</td>
                      <td>***.***.***-{link.cpf.slice(-2)}</td>
                      <td>{new Date(link.verifiedAt).toLocaleString('pt-BR')}</td>
                      <td>Revisão pendente</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="cpi-link-disclaimer">
          A referência será localizada na fila e o CPF será comparado com o formulário aberto. A
          verificação não identifica automaticamente a coluna da referência. Nenhuma resposta será
          enviada à CPI.
        </p>
      </div>
    </section>
  )
}
