# Hardening e integração do adaptador CPI — 2026-10-22

O adaptador supervisionado foi fortalecido incrementalmente. A seleção real
de arquivos e o envio definitivo continuam desabilitados. Nenhuma consulta
DeskData ou gravação no portal real foi efetuada nesta tarefa.

## Referência examinada

Arquivo disponível: `J:\AGENTE_PESQUISA_FORUM_NACIONAL-main.zip`, sem o sufixo
`(5)` mencionado inicialmente. Não há comprovação de equivalência entre versões.
SHA-256: `1A0AA99565DF6597FB8DEFB0878AC625A3BE6DEE40F70763D33926BBB343DB0A`.

Os sete módulos solicitados foram lidos diretamente do ZIP. Não houve extração
integral do projeto nem execução de código legado. A inspeção inicial está em
[cpi-hardening-inspecao.md](cpi-hardening-inspecao.md).

## Reaproveitamento e decisões

| Referência original                         | Adaptação ou proteção preservada                                                                                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cpi-selectors.ts`                          | Reutilizado `#MainPage_FileUpload1`. Preservados os seletores atuais de CPF e classificação, já mais seguros.                                                                             |
| `cpi-research-pdf-attachment-controller.ts` | Adaptados unicidade, `setInputFiles` e conferência de arquivo selecionado. Agora usa bytes revisados em memória, verifica tipo, frame, origem, controle habilitado e troca de formulário. |
| `cpi-research-pdf-preparation-workflow.ts`  | Mantido o fluxo atual por histórico selecionado. Não reaproveitado o preenchimento duplicado antes/depois da seleção.                                                                     |
| `cpi-research-result-controller.ts`         | Mantido o plano atual de campos; não reintroduzidos cliques, preenchimentos repetidos ou mudança de status no portal.                                                                     |
| `cpi-research-result-saver.ts`              | Não reutilizada a conclusão `saved: true` baseada em clique. Não existe comando habilitado de Alterar nesta integração.                                                                   |
| `cpi-research-confirmed-save-controller.ts` | Não reutilizada a aceitação de diálogo como prova de gravação. A conclusão depende de evidência documental independente.                                                                  |
| `cpi-research-identity-reader.ts`           | Mantida a leitura atual que exige campo único e CPF válido, sem `first()`.                                                                                                                |

O formato de payload em memória de `setInputFiles` foi conferido na
[documentação primária do Playwright](https://playwright.dev/docs/api/class-locator#locator-set-input-files).
O elemento é fixado por handle para impedir que uma troca de formulário faça
o seletor resolver silenciosamente para outro controle durante a operação.

## Controles e falhas corrigidas

- A classificação é calculada a partir do resultado local vinculado e incluída
  na confirmação do operador. `INDEFINIDO` bloqueia anexação. Não é convertido
  em `HA_INFORMACOES`. Zero processos reconciliado e processos criminais
  documentais preservam as regras atuais.
- IDs de solicitação/pesquisa, CPF válido completo, histórico, hash da resposta
  e integridade/hash do PDF são conferidos antes do efeito. A confirmação
  humana não substitui a revalidação posterior da identidade.
- O PDF exige estrutura A4, valores numéricos finitos, EOF, xref com offsets
  consistentes e raiz Catalog. Trata-se do formato clássico produzido pelo
  Chromium atual, não de um parser geral de PDFs externos.
- Input ausente, duplicado, incorreto, desabilitado ou em frame não autorizado
  bloqueia a ação. A presença de input genérico não é aceita como fallback.
- Seleção de arquivo não confirma persistência. Um retorno indefinido do
  operador ou da leitura documental nunca autoriza envio.
- A reserva durável precede `setInputFiles`, pois scripts da página podem
  transmitir o arquivo no evento de seleção. A aplicação não fornece a
  capability de habilitação desse método.
- Abertura por identidade da linha, associação ao histórico e consumo da API
  foram preservados. Não foi reintroduzida navegação web na DeskData.
- Diagnósticos usam somente etapa, duração, status, categoria e recuperação.
  Não serializam exceções externas, CPF, cookies, tokens ou documentos.

## Persistência e retomada

Estados: `PREPARADO`, `REVISAO_CONFIRMADA`, `ANEXACAO_EM_ANDAMENTO`,
`ARQUIVO_SELECIONADO`, `CONFIRMACAO_INCERTA`, `DOCUMENTO_CONFIRMADO` e
`RECONCILIADO_AUSENTE`. Confirmação documental não significa envio definitivo
ou alteração de status da solicitação.

Eventos imutáveis e numerados são publicados por criação exclusiva e `sync()`.
Conflitos concorrentes bloqueiam a operação. A chave deriva dos IDs de
solicitação/pesquisa; os vínculos guardam hashes de histórico, fonte e PDF,
classificação e data. Não há armazenamento do documento ou CPF nesse diário.

Reinício anterior ao efeito permite preparar novamente e renovar a revisão.
Estados em andamento são interpretados como `CONFIRMACAO_INCERTA` na retomada.
Erros após reserva também persistem incerteza; se a escrita falhar, a reserva
anterior continua bloqueando repetição. Registros corrompidos ou reservas
legadas sem evidência suficiente exigem intervenção manual, sem liberação
automática.

A reconciliação exige identidade correspondente, hash do PDF da tentativa
original, resposta conclusiva e confirmação de que não há operação em curso.
PDF regenerado após reinício não substitui esse hash original. Presença encerra
sem reenvio. Ausência conclusiva permite uma nova preparação, revisão e
confirmação humana. Resposta desconhecida mantém o bloqueio.

O método de reconciliação está preparado no workflow e exercitado em testes;
não existe leitor autenticado de evidências habilitado no adaptador real nem
atalho de interface que libere uma tentativa incerta.

## Arquivos alterados

- `src/main/cpi-attachment.ts`: classificação, verificação PDF, diário,
  retomada, reconciliação e diagnóstico.
- `src/main/cpi-attachment-store.ts`: máquina de estados persistente e reserva
  exclusiva compatível com bloqueios legados.
- `src/main/cpi-readonly.ts`: inspeção do seletor original, origem HTTPS,
  diagnóstico de sessão e conexão ao adaptador desabilitado.
- `src/main/index.ts`: injeção do diário, diagnóstico seguro e classificação
  explícita na confirmação nativa.
- `src/shared/contracts.ts`: classificação no contrato de revisão do PDF.
- Novos: `src/main/cpi-upload-adapter.ts`, `src/main/cpi-diagnostics.ts`.
- Testes atualizados: `tests/cpi-attachment.mjs`, `tests/cpi-queue.mjs`,
  `tests/pdf-smoke.mjs`.
- Testes/suportes novos: `tests/cpi-hardening.mjs`,
  `tests/cpi-upload-adapter.mjs`, `tests/deskdata-history-smoke.mjs`,
  `tests/load-ts.mjs`, `tests/pdf-fixture.mjs`.
- Documentação: `README.md`, este relatório e nota na inspeção inicial.

Nenhuma dependência adicionada. Fontes da API, histórico e gerador de PDF não
foram modificados. O diretório não contém repositório Git reconhecido; não
foram criados commit ou branch. Build, lint e teste UI também atualizam
artefatos gerados, cache e capturas já usados pelo projeto.

## Validação local

Resultado final: os oito scripts de teste terminaram com código 0, assim como
typecheck, lint e build. A interface foi verificada após o build final. O lint
final não apresentou erros ou avisos. O npm emite um aviso preexistente sobre
a configuração de ambiente `store-dir`, sem impedir a execução.

Comandos executados com fixtures fictícias, sem serviços externos:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = 'I:\DEV\Cache\Playwright'
node tests/cpi-classification.mjs
node tests/cpi-attachment.mjs
node tests/cpi-hardening.mjs
node tests/cpi-upload-adapter.mjs
node tests/cpi-queue.mjs
node tests/pdf-smoke.mjs
node tests/deskdata-history-smoke.mjs
node tests/cpi-ui.mjs
npm run typecheck
npm run lint
npm run build
```

Os testes cobrem sessão expirada, controles ausentes/duplicados, CPF duplicado
ou divergente, troca de formulário, PDF corrompido/truncado/fora de A4,
interrupção, confirmação documental ausente, arquivo já associado, reinício,
resposta indefinida, ausência reconciliada de processos e processos criminais.
Também cobrem disputa de reserva, proteção de dados no diário/diagnóstico,
reconciliação de presença/ausência e hash original após regeneração do PDF.

O smoke da API usa fetch simulado e verifica POST único e ausência de repetição
após falha de rede. Histórico usa módulo real com fronteira safeStorage
substituída por cifra autenticada local; não valida DPAPI do Windows. O PDF usa
bytes reais do Chromium com Electron simulado. A interface usa IPC simulado.

## Validação real ainda necessária

1. Confirmar o controle oficial e seu frame na versão autenticada do portal,
   inclusive postbacks, scripts disparados pela seleção e sessão expirada.
2. Identificar evidência autoritativa do ID da pesquisa no formulário, além da
   associação atual conferida na fila.
3. Validar vínculo, hash/identidade e persistência do documento no servidor;
   nome de arquivo, input preenchido, clique ou diálogo não bastam.
4. Implementar e validar leitura de reconciliação que comprove ausência ou
   presença e que nenhuma requisição anterior permanece em processamento.
5. Validar a prévia nativa do Electron e armazenamento protegido no Windows
   final. Nenhum teste local substitui essas verificações.

O envio definitivo permanece desabilitado até validação específica. Não há
clique em Alterar nem mudança automática para Respondida nesta entrega.
