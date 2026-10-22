# deskdatacontrol

An Electron application with React and TypeScript

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```

## Fluxo CPI supervisionado

Na aba CPI, selecione e abra uma pesquisa. O resultado é recuperado do histórico
local, conferido pelo CPF e associado à solicitação, sem nova consulta DeskData.
“Preparar PDF do resultado local” reutiliza o gerador atual e abre o documento
para conferência. O CPF completo permanece no relatório. O processo principal
mantém os bytes e o hash do documento conferido para evitar troca de resultado.

Uma lista judicial explicitamente presente e reconciliada com total zero produz
`HA_INFORMACOES` (`#consta2`). Dados ausentes, truncados, inconsistentes ou sem
vínculo documental comprovado produzem `INDEFINIDO`, exigindo revisão. Processos
criminais documentais continuam destacados e, com resultado íntegro, produzem
`CONSTA_RESTRICAO` (`#consta3`).

**O envio ao portal permanece bloqueado nesta implementação.** A inspeção usa
o seletor original `#MainPage_FileUpload1`, exigindo um único input de arquivo
habilitado no frame de detalhe HTTPS da CPI. Um input genérico não é aceito.
Mesmo com o controle presente, precisam ser validados no portal real o vínculo
ao ID da pesquisa, o destino de upload e a evidência de documento persistido.

O botão “Anexar PDF” informa essa causa. O fluxo interno já exige conferência,
confirmação nativa do operador, revalidação de IDs/CPF/histórico e presença do
documento após o envio. Sua conclusão é testada com adaptador simulado. O
adaptador de seleção com `setInputFiles` está implementado e testado em DOM
fictício, com capability desabilitada na aplicação. Usa os bytes revisados em
memória, fixa o elemento validado e revalida a identidade antes e depois da
seleção. `ARQUIVO_SELECIONADO` não significa upload nem gravação confirmada.
Não há implementação habilitada de leitura de evidência documental no portal.
Nenhum comando de finalização ou alteração para “Respondida” é executado.
O estado exibido da solicitação é o da última leitura da fila, explicitamente
identificado na interface.

O diário local persiste preparação, revisão, reserva, seleção, incerteza e
confirmação documental por solicitação/pesquisa. Eventos usam criação exclusiva
e sincronização em disco antes do efeito externo. Operações interrompidas são
lidas como `CONFIRMACAO_INCERTA` e exigem reconciliação por identidade, hash do
PDF original e evidência conclusiva de operação encerrada. Uma ausência
reconciliada exige nova revisão humana; não existe repetição automática.
Reservas antigas continuam bloqueando duplicação. Registros corrompidos falham
fechados. O diário guarda hashes, classificação, estado, revisão e data; nunca
CPF, documento, credenciais ou mensagens externas. Diagnósticos registram
somente etapa, duração, status, categoria e possibilidade de recuperação.

O relatório da adaptação e os limites da validação estão em
[docs/cpi-hardening-relatorio.md](docs/cpi-hardening-relatorio.md).

## Verificação local CPI

```powershell
npm run typecheck
npm run lint
npm run build
$env:PLAYWRIGHT_BROWSERS_PATH = 'I:\DEV\Cache\Playwright'
node tests/cpi-classification.mjs
node tests/cpi-attachment.mjs
node tests/cpi-hardening.mjs
node tests/cpi-upload-adapter.mjs
node tests/cpi-queue.mjs
node tests/pdf-smoke.mjs
node tests/deskdata-history-smoke.mjs
node tests/cpi-ui.mjs
```

Os testes usam dados fictícios, IPC/adaptador de upload simulados e bloqueiam
acesso externo nos navegadores. Não fazem consulta paga nem upload real.
`pdf-smoke.mjs` exercita o gerador existente com Electron simulado e bytes PDF
reais do Chromium local, verificando A4 e CPF completo no HTML renderizado.
A execução direta com Electron foi impedida neste ambiente pela ACL Windows
da pasta `node_modules/electron/dist`; o sandbox de produção foi preservado.
A prévia PDF nativa e todo envio real ainda exigem validação no ambiente final.
