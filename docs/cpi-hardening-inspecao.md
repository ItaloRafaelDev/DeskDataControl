# Inspeção inicial do hardening CPI — 2026-10-22

Nota posterior: a referência foi localizada em `J:\AGENTE_PESQUISA_FORUM_NACIONAL-main.zip`.
Esta inspeção registra a situação anterior às mudanças. A implementação e a
verificação final estão em [cpi-hardening-relatorio.md](cpi-hardening-relatorio.md).

## Situação

Inspeção do código atual e verificação da referência anterior às mudanças.
A integração solicitada ainda não foi implementada. O ZIP
`AGENTE_PESQUISA_FORUM_NACIONAL-main(5).zip` não foi localizado no workspace
nem nas buscas realizadas em `I:\DEV`, `I:\Projetos`,
`I:\PASTA QUE TEM TUDO` e Downloads do perfil disponível.
É necessário informar seu caminho para comparar os sete arquivos indicados.
Não houve consulta DeskData nem interação com o portal real.

## Proteções atuais confirmadas

- `src/main/cpi-preview.ts` mantém `INDEFINIDO` para resultados incompletos,
  ausentes ou sem correspondência documental; processos criminais confirmados
  geram `CONSTA_RESTRICAO`. Zero processos explicitamente reconciliado gera
  `HA_INFORMACOES`.
- `src/shared/cpi-form-plan.ts` não converte `INDEFINIDO` em `#consta2`.
- `src/main/cpi-workflow.ts` resolve histórico local e exige seleção quando há
  múltiplos candidatos. Não executa nova consulta DeskData.
- `src/main/cpi-queue.ts` abre a linha selecionada por IDs e impressão do
  conteúdo, revalidando-a; não usa posição arbitrária na fila.
- `src/main/cpi-readonly.ts` exige um único campo CPF e formulário único.
- `src/main/cpi-attachment.ts` verifica IDs, CPF, histórico, conteúdo local,
  hash e estrutura A4 do PDF. Revalida após confirmação do operador, reserva
  antes do efeito externo e exige presença posterior do documento.
- `src/main/cpi-attachment-store.ts` bloqueia nova reserva após reinício,
  inclusive para tentativas incertas. Não persiste CPF nem documento.
- `src/main/index.ts` mantém adaptadores reais de upload e confirmação
  bloqueados. Não aciona Alterar nem finaliza a solicitação.

## Lacunas para implementação

- Inspeção atual procura `input[type="file"]` genérico; falta adaptar e testar
  `#MainPage_FileUpload1`, verificando unicidade, tipo e frame autorizado.
- Não há implementação habilitada de `setInputFiles` nem evidência validada de
  persistência documental. Seleção de arquivo não deve confirmar upload.
- Registro persistente contém apenas `uncertain/attached`; faltam estados por
  etapa, retomada segura e reconciliação vinculada à identidade e ao documento.
- Fluxo de anexação não exige explicitamente classificação definida e revisada.
- Falta diagnóstico estruturado com etapa, duração, status, categoria e
  recuperabilidade, sem incluir mensagens externas ou dados sensíveis.
- É necessário ampliar cenários de sessão expirada, seletor duplicado,
  interrupção e recuperação, resposta indefinida e reconciliação.

## Verificações executadas antes de alterações

Todos os comandos abaixo terminaram com código 0:

- `node tests/cpi-classification.mjs`
- `node tests/cpi-attachment.mjs`
- `node tests/cpi-queue.mjs`
- `node tests/pdf-smoke.mjs`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

Fila e PDF foram testados com `PLAYWRIGHT_BROWSERS_PATH=I:\DEV\Cache\Playwright`.
Os testes usam identidades fictícias e integração simulada. O teste PDF
exercita bytes reais do Chromium com Electron simulado. Estes resultados não
validam autenticação, upload ou gravação no portal real. O teste de interface
`tests/cpi-ui.mjs` não foi executado nesta inspeção.

## Artefatos e pendências

Nenhum código legado foi reutilizado e nenhum fonte da aplicação foi alterado.
Este relatório foi adicionado; build e lint podem atualizar artefatos gerados
e cache. O diretório disponível não contém repositório Git reconhecido.

Depois da comparação com o ZIP, a validação real ainda precisará confirmar:
controle e frame no formulário autenticado; ID da pesquisa no próprio
formulário; vínculo entre documento e pesquisa; evidência durável de gravação;
comportamento em sessão expirada e troca de formulário. O envio definitivo
deve continuar desabilitado até validação específica.
