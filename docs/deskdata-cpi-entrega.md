# Fluxo DeskData API → CPI — implementação local

Referência: `J:\AGENTE_PESQUISA_FORUM_NACIONAL-main.zip`, repositório
`ItaloRafaelDev/AGENTE_PESQUISA_FORUM_NACIONAL`.
SHA-256 do ZIP: `1A0AA99565DF6597FB8DEFB0878AC625A3BE6DEE40F70763D33926BBB343DB0A`.

Foram comparados os onze arquivos solicitados e os cenários dos testes de filtro,
resultado, PDF e gravação. Os arquivos extraídos para inspeção foram removidos;
o projeto antigo não foi incorporado como dependência.

## Comportamento entregue

- A autenticação CPI dispara a preparação do filtro criminal por eventos do
  navegador. Aplicações concorrentes são agrupadas. Novas leituras não reaplicam
  o filtro; seleção divergente observada nos checkboxes permite reaplicação.
  Login perdido invalida o controle da sessão. Não existe polling contínuo da fila.
- Atualizar fila usa Mostrar Tudo e confere novamente o filtro. A seleção continua
  usando solicitação, pesquisa, checkbox e fingerprint da mesma linha. O teste
  adicional seleciona a segunda linha pelos IDs e comprova que a primeira não abre.
- Processar pesquisa selecionada consulta primeiro o histórico, exige escolha em
  caso de ambiguidade e usa o cliente API existente somente quando falta resultado.
  Consulta paga continua exigindo a autorização e os datasets do formulário atual.
  Tentativa pendente/incerta permanece bloqueada pelo histórico persistente.
- Revisar resposta prepara status Respondida, ambas as fontes Desk Data e a
  classificação, confirma estabilidade dos controles e abre o PDF profissional
  gerado do historyId vinculado. INDEFINIDO bloqueia envio. Zero processos
  explicitamente reconciliado continua HA_INFORMACOES.
- Confirmar envio é a única ação final. Revalida identidade, histórico, resultado,
  campos e PDF; reserva o diário antes do efeito externo; seleciona o arquivo no
  controle oficial; distingue arquivo selecionado de documento persistido; aciona
  Alterar uma vez e aceita somente a confirmação esperada do portal.
- Sucesso exige nova leitura autenticada da URL exata do detalhe vinculada à
  abertura selecionada, conferência de solicitação/CPF/campos e download do PDF
  identificado por um link do próprio portal. Tamanho e SHA-256 devem coincidir.
  O histórico criptografado recebe o comprovante e o vínculo passa a submitted.
- Qualquer interrupção após a reserva bloqueia repetição. O diário usa criação
  exclusiva e sincronização em disco e sobrevive a reinícios. A aplicação possui
  bloqueio de instância única. Pausa/cancelamento atuam entre etapas; uma chamada
  já enviada pode concluir e ter seu resultado preservado. Gravação já iniciada
  segue para verificação, sem clique de repetição.
- A operação pertence ao processo principal; navegar pela interface não a reinicia.
  Fila, seleção, resultado, classificação, PDF, ações e estado ficam na Central
  existente. Não foram criadas abas. Diagnósticos novos contêm etapa e duração,
  sem CPF, nome, URL, documento ou mensagens externas.

## Diferenças deliberadas em relação ao legado

O controller antigo do PDF confirma apenas input.files. O saver antigo considera
o clique suficiente e libera nova tentativa quando ele falha. Esses comportamentos
não foram usados como evidência de persistência nem como autorização de reenvio.
A implementação atual exige a verificação posterior e conserva o bloqueio incerto.

## Arquivos criados e alterados

Criados:

- `src/main/cpi-filter.ts`
- `src/main/cpi-result-adapter.ts`
- `src/main/cpi-submission.ts`
- `tests/cpi-filter.mjs`
- `tests/cpi-result-adapter.mjs`
- `tests/cpi-submission.mjs`
- `tests/run.mjs`
- `docs/deskdata-cpi-entrega.md`

Alterados:

- `src/main/index.ts`: orquestração, IPC autorizado, controle, confirmação e recibo.
- `src/main/cpi-readonly.ts`: eventos de sessão, filtro, vínculo ao frame e upload final.
- `src/main/cpi-reference.ts`: seletor CPF compartilhado com a verificação posterior.
- `src/main/cpi-attachment-store.ts`: estados de gravação e resposta confirmada.
- `src/main/cpi-links.ts`: vínculo confirmado sem rebaixar seu estado depois.
- `src/main/research-history.ts`: recibos CPI vinculados ao resultado local.
- `src/main/operational-state.ts`: restauração conservadora de envio interrompido.
- `src/main/report-pdf.ts`: prazo de geração e liberação da janela do PDF.
- `src/shared/contracts.ts`: contratos do fluxo e controle.
- `src/preload/index.ts`: ponte IPC tipada para as ações da Central.
- `src/renderer/src/App.tsx`: autorização/datasets atuais encaminhados ao fluxo.
- `src/renderer/src/components/CpiOperationalQueue.tsx`: processamento, revisão,
  confirmação única, pausa/cancelamento e explicação do estado incerto.
- `tests/central-ipc.mjs`: fluxo completo com IPC e armazenamento criptografado reais,
  adaptador CPI simulado, histórico reutilizado, recibo e reinício sem reenvio.
- `tests/cpi-queue.mjs`: seleção explícita da segunda linha por IDs.
- `tests/cpi-ui.mjs`: cenários existentes adaptados às ações finais da Central.
- `tests/deskdata-history-smoke.mjs`: limpeza temporária com retries para ENOTEMPTY
  transitório no Windows; as asserções existentes foram preservadas.
- `package.json`: comando test que compila e executa todas as suítes locais.

## Verificação local

Ambiente dos testes de navegador:
`PLAYWRIGHT_BROWSERS_PATH=I:\DEV\Cache\Playwright`.

- Prettier nos arquivos alterados.
- `npm run lint` sem erros ou warnings do ESLint.
- `npm test`: typecheck Node/web, build Electron/preload/renderer e 14 suítes:
  central-ipc, cpi-attachment, cpi-classification, cpi-filter, cpi-hardening,
  cpi-queue, cpi-result-adapter, cpi-submission, cpi-ui, cpi-upload-adapter,
  deskdata-history-smoke, operational-state, pdf-destination e pdf-smoke.

As suítes usam fixtures e mocks, bloqueiam rede externa nos testes de DOM e não
executam consultas pagas nem gravações reais. A geração de PDF é exercitada com
bytes reais de Chromium; Electron e serviços são simulados. As suítes anteriores
continuam presentes, com suas verificações preservadas.

## Primeiro teste supervisionado

1. Autenticar DeskData e CPI; conferir a aplicação automática do filtro e atualizar
   a fila pela Central.
2. Selecionar uma linha e conferir os dois IDs e CPF. Preferir inicialmente uma
   solicitação com resultado judicial completo já presente no histórico.
3. Processar a seleção ou revisar a resposta existente. Conferir classificação,
   fontes, status e PDF aberto antes de Confirmar envio.
4. Confirmar uma única vez. Conferir o resultado da verificação no aplicativo e
   a resposta/documento no portal.
5. Se ficar incerto, interromper essa solicitação e conferir o portal e o diário;
   não apagar reservas nem tentar outro clique para forçar sucesso.

**Não houve validação real na CPI nesta entrega.** A evidência posterior por link
com o nome do PDF e download autenticado é uma estratégia implementada e testada
localmente, ainda a confirmar no DOM real. Se o portal não expuser esse link,
alterar o nome/bytes do arquivo, impedir a leitura direta do detalhe ou redirecionar
a sessão, o fluxo ficará incerto, mesmo que a gravação tenha ocorrido. Esses casos
exigem adaptação da evidência observada no teste supervisionado, sem repetir a
gravação. Também deve ser confirmado nesse teste se o portal mantém os checkboxes
do filtro disponíveis para detectar perda silenciosa da seleção.
