import type { ReactNode } from 'react'
import { Button } from '@fluentui/react-components'
import type { OperationalSnapshot } from '../../../shared/contracts'

export default function CpiOperationalQueue({
  state,
  onUseCpf,
  children,
  onSavePdf,
  onError,
  externalBusy,
  queryRequest
}: {
  state: OperationalSnapshot | null
  onUseCpf(cpf: string): void
  children?: ReactNode
  onSavePdf(): void
  onError(message: string): void
  externalBusy: boolean
  queryRequest: {
    confirmed: boolean
    datasets: import('../../../shared/contracts').PersonDataset[]
  }
}): React.JSX.Element {
  const {
    queue,
    selected,
    research,
    busy: stateBusy = true,
    connected = false,
    pdf,
    attachment
  } = state ?? {}
  const busy = stateBusy || externalBusy
  async function run(operation: () => Promise<unknown>): Promise<void> {
    if (busy) return
    try {
      await operation()
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'Falha na operação CPI.')
    }
  }
  const preview = research?.preview
  const operational = connected && !!selected && !!state?.identity
  return (
    <div className="cpi-operational">
      <section className="section-card cpi-queue-area" aria-label="Fila operacional CPI">
        <div className="section-bar">
          <h2>Fila CPI</h2>
          <span>{connected ? 'Sessão confirmada' : 'Desconectada'}</span>
        </div>
        <div className="cpi-operational-body">
          <Button
            disabled={busy || connected}
            onClick={() =>
              void run(async () => {
                await window.deskdata.cpiOpen()
              })
            }
          >
            Conectar CPI
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await window.deskdata.cpiReadQueue()
              })
            }
          >
            Atualizar fila
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await window.deskdata.cpiClose()
              })
            }
          >
            Encerrar conexão
          </Button>
          <p>
            Faça o login no navegador CPI e clique em Atualizar fila para aplicar o filtro criminal
            e sincronizar as solicitações.
          </p>
          {queue && (
            <p role="status">
              {
                {
                  HAS_RESEARCH: 'Solicitações disponíveis',
                  EMPTY: 'Fila vazia',
                  LOGIN_REQUIRED: 'Login necessário',
                  INDETERMINATE: 'Fila não confirmada'
                }[queue.state]
              }{' '}
              · {queue.rows.length} linhas lidas · Total informado:{' '}
              {queue.declaredTotal ?? 'não identificado'}
            </p>
          )}
          <ul className="cpi-queue-list" aria-label="Solicitações">
            {queue?.rows.map((row, index) => (
              <li key={`${row.fingerprint}-${index}`}>
                <button
                  type="button"
                  aria-pressed={selected?.fingerprint === row.fingerprint}
                  disabled={busy || !connected || !!row.blockedReason}
                  onClick={() => {
                    void run(() => window.deskdata.cpiOpenSelected(row))
                  }}
                >
                  <strong>Solicitação {row.requestId || 'não identificada'}</strong>
                  <br />
                  Pesquisa {row.researchId || 'não identificada'}
                  <br />
                  {row.name || 'Nome indisponível'} · {row.situation || 'Situação indisponível'}
                </button>
                {row.blockedReason && <p>{row.blockedReason}</p>}
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="section-card cpi-selected-area" aria-label="Pesquisa selecionada">
        <div className="section-bar">
          <h2>Pesquisa selecionada</h2>
        </div>
        <div className="cpi-operational-body">
          {selected ? (
            <>
              <p>
                {selected.name && <strong>{selected.name} · </strong>}
                Solicitação <strong>{selected.requestId}</strong> · Pesquisa{' '}
                <strong>{selected.researchId}</strong>
              </p>
              <Button
                appearance="primary"
                disabled={busy || !connected}
                onClick={() =>
                  void run(async () => {
                    await window.deskdata.cpiOpenSelected(selected)
                  })
                }
              >
                Abrir pesquisa selecionada
              </Button>
            </>
          ) : (
            <p>Selecione uma solicitação na fila.</p>
          )}
          {research && (
            <>
              <p>CPF validado: {research.maskedCpf}</p>
              <h3>Situação do histórico</h3>
              <p>
                {research.historyState === 'unique'
                  ? 'Resultado local recuperado e CPF conferido.'
                  : research.historyState === 'ambiguous'
                    ? 'Mais de um resultado local. Selecione o resultado para revisar.'
                    : 'Nenhum resultado local encontrado para este CPF.'}
              </p>
              {research.historyState === 'ambiguous' &&
                research.candidates.map((candidate) => (
                  <Button
                    key={candidate.id}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await window.deskdata.cpiFindSelectedHistory(candidate.id)
                      })
                    }
                  >
                    Selecionar resultado {candidate.queryCode ?? candidate.id} ·{' '}
                    {candidate.createdAt}
                  </Button>
                ))}
              {research.historyState === 'missing' && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      onUseCpf(await window.deskdata.cpiSelectedCpf())
                    })
                  }
                >
                  Usar CPF no formulário abaixo
                </Button>
              )}
            </>
          )}
          <Button
            appearance="primary"
            disabled={
              busy ||
              state?.submission === 'confirmed' ||
              state?.submission === 'uncertain' ||
              !operational ||
              !research ||
              state?.control === 'paused' ||
              state?.control === 'cancelled' ||
              (research.historyState === 'missing' && !queryRequest.confirmed)
            }
            onClick={() => void run(() => window.deskdata.cpiProcessSelected(queryRequest))}
          >
            Processar pesquisa selecionada
          </Button>
          <Button
            disabled={
              !selected ||
              state?.control === 'paused' ||
              state?.submission === 'confirmed' ||
              state?.submission === 'uncertain'
            }
            onClick={() =>
              void window.deskdata.cpiControl('pause').catch((reason) => onError(String(reason)))
            }
          >
            Pausar
          </Button>
          <Button
            disabled={busy || state?.control !== 'paused'}
            onClick={() => void run(() => window.deskdata.cpiControl('resume'))}
          >
            Retomar
          </Button>
          <Button
            disabled={
              !selected || state?.control === 'cancelled' || state?.submission === 'confirmed'
            }
            onClick={() =>
              void window.deskdata.cpiControl('cancel').catch((reason) => onError(String(reason)))
            }
          >
            Cancelar
          </Button>
          {state?.status && <p>Estado: {state.status}</p>}
          {state?.message && <p role="status">{state.message}</p>}
          {children}
          <h3>Classificação preliminar</h3>
          <p>{preview?.classificationLabel ?? 'Aguardando resultado do histórico.'}</p>
          {preview?.warnings.map((warning, index) => (
            <p key={index}>{warning}</p>
          ))}
          <h3>Processos identificados</h3>
          {preview && (
            <p>
              {preview.totalReceived} recebidos · {preview.totalDeclared ?? 'Total não confirmado'}{' '}
              declarados · {preview.criminal} criminais · {preview.criminalWithDocument} com vínculo
              documental criminal.
            </p>
          )}
          {preview && (
            <div className="cpi-process-scroll">
              <table className="cpi-process-table">
                <thead>
                  <tr>
                    <th>Número</th>
                    <th>Tribunal</th>
                    <th>Situação</th>
                    <th>Esfera</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.processes.map((process, index) => (
                    <tr key={index}>
                      <td>{process.number}</td>
                      <td>{process.courtType}</td>
                      <td>{process.situation}</td>
                      <td>{process.sphere}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3>Preparação do PDF</h3>
          <Button disabled={busy || !research?.historyId} onClick={onSavePdf}>
            Salvar PDF da pesquisa CPI
          </Button>
          <Button
            disabled={busy || !operational || !research}
            onClick={() =>
              void run(() =>
                window.deskdata.cpiFindSelectedHistory(research?.historyId ?? undefined)
              )
            }
          >
            Revalidar histórico vinculado
          </Button>
          <p>
            {pdf
              ? `PDF disponível: ${pdf.filename} · ${pdf.byteLength} bytes · A4`
              : 'PDF ainda não preparado para esta seleção.'}
          </p>
          <Button
            disabled={
              busy ||
              !operational ||
              !research?.historyId ||
              state?.submission === 'confirmed' ||
              state?.submission === 'uncertain'
            }
            onClick={() =>
              void run(async () => {
                if (!research?.historyId) return
                await window.deskdata.cpiReviewResponse()
              })
            }
          >
            Revisar resposta
          </Button>
          {pdf && (
            <p>
              Conferência: solicitação {pdf.requestId} · pesquisa {pdf.researchId} · CPF completo{' '}
              {pdf.cpf} · histórico {pdf.historyId}. Confira o documento aberto antes de confirmar a
              envio.
            </p>
          )}
          <Button
            disabled={
              busy ||
              !operational ||
              !pdf ||
              state?.submission !== 'reviewed' ||
              state?.control === 'paused' ||
              state?.control === 'cancelled' ||
              attachment?.state === 'attached' ||
              attachment?.state === 'uncertain' ||
              attachment?.state === 'already_present'
            }
            onClick={() =>
              void run(async () => {
                if (!pdf) return
                await window.deskdata.cpiConfirmSubmission(pdf.reviewId)
              })
            }
          >
            Confirmar envio
          </Button>
          <h3>Estado do envio</h3>
          <p role="status">
            {attachment?.message ??
              pdf?.blockedReason ??
              'Aguardando preparação e conferência do PDF.'}
          </p>
          <h3>Estado real da solicitação</h3>
          <p>
            {attachment?.requestStatus ??
              pdf?.requestStatus ??
              selected?.situation ??
              'Não identificado'}{' '}
            (última leitura da fila CPI).
          </p>
          <p>
            Confirmar envio grava a resposta revisada e o PDF. O sucesso exige nova leitura do
            portal e conferência do documento persistido.
          </p>
          {state?.submission === 'uncertain' && (
            <details>
              <summary>Detalhes de erro</summary>
              <p>
                A persistência da resposta ou do PDF não pôde ser confirmada. O diário local
                bloqueia outra tentativa, inclusive após reinício. Confira a mesma solicitação e
                pesquisa no portal antes de reconciliar o histórico.
              </p>
            </details>
          )}
          {busy && <p role="status">Operação em andamento...</p>}
        </div>
      </section>
    </div>
  )
}
