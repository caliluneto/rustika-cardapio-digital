# UNAERP — Universidade de Ribeirão Preto

## Engenharia da Computação — Prática Extensionista VII

### RÚSTIKA — Cardápio Digital

**Integrantes:** [PENDENTE — inserir nomes completos e códigos acadêmicos]

**Docente:** [PENDENTE — preencher conforme o modelo oficial]

**Ribeirão Preto — 2026**

## 1. Contextualização do estabelecimento e do projeto

O material técnico disponível identifica o RÚSTIKA como o estabelecimento atendido pelo projeto acadêmico de
cardápio digital da Prática Extensionista VII. O repositório não registra endereço, razão social, nome do
proprietário, quantidade de mesas, horários, volume de atendimento ou qualquer outra informação comercial que
permita caracterizar esses aspectos com segurança; por isso, tais dados não são inventados neste relatório e devem
ser acrescentados pelo grupo após confirmação direta com o responsável. O problema abordado é objetivo: disponibilizar
um cardápio consultável em navegador, organizar a seleção de produtos em carrinho, vincular o atendimento a uma
comanda autorizada e transmitir o pedido ao estabelecimento com informações consistentes. Para a operação, a solução
oferece autenticação administrativa, controle de disponibilidade e cadastro de produtos, listagem de pedidos,
transições de status e histórico. Para o cliente, oferece categorias, detalhes, ingredientes, preços em centavos,
revisão e acompanhamento automático do próprio pedido. O backend foi construído em Express e Prisma sobre PostgreSQL,
e o frontend em React e Vite. A segurança faz parte do recorte: cookies HttpOnly, validação estrita, origem permitida,
cabeçalho anti-CSRF, limites de taxa, idempotência e privilégios de banco reduzidos. A validação funcional foi concluída em **14/11/2026** no ambiente Dev (`cardapio_digital_dev`, PostgreSQL 18.6, com
**9/9 migrations aplicadas**). O RF006 foi exercitado com criação, edição e exclusão reais de um produto fictício; o
RF004 gerou o pedido **#5** na comanda `000126`, após convite emitido pelo painel e resgatado na janela do cliente; o
RF007 teve lista atualizada por polling e filtro por status capturado; o RF008 percorreu os quatro estados na tela do
cliente **sem recarregar a página**; e o RF009 respondeu em `/api/openapi.json` e `/api/docs`. O produto fictício foi
marcado `UNAVAILABLE` pelo painel e deixou o catálogo público. A suíte final registrou **1.237 testes aprovados e 9
ignorados** no backend e **174/174** no frontend, com typecheck e builds aprovados. O ambiente Neon não foi acessado.
Os pedidos #1–#4 foram preservados; o #1 foi cancelado acidentalmente em rodada anterior e seu estado permanece
registrado em `backend/docs/incidente-pedido-1-dev.md`. O documento distingue o que foi efetivamente demonstrado do
que ainda depende de materiais humanos, gravação e publicação autorizada.

## 2. Resultado do desenvolvimento

### 2.1 Banco e migrations

A inspeção somente leitura de 14/11/2026 confirmou `cardapio_digital_dev` / `127.0.0.1:5432` / PostgreSQL 18.6 com
**9/9 migrations aplicadas**, incluindo `20261110000000_rf006_product_crud_privilege` e
`20261114000000_product_insert_identity_columns`. O ambiente Neon não foi acessado.

O backup pré-RF006 foi gerado fora do repositório e do OneDrive:
`cardapio_digital_dev_pre-rf006_20261114-021344Z.dump`, 47.535 bytes, SHA-256
`12b97471552173e3bd6291585dd93d497393c700e63c2ef5222cb4ef75c8ee96`, com TOC de 7.220 bytes. Checksum e TOC foram
verificados; a **restauração integral em banco descartável não foi executada**, portanto o backup não é declarado
restaurável.

### 2.2 RF006 — CRUD real com PostgreSQL

O RF006 foi validado com o produto fictício `test` (`public_key` `rustika-TEST`): criação persistida, edição de preço
de R$ 12,55 para R$ 15,50 e descrição para `Edicao RF006`, com novo `updated_at`, e exclusão confirmada por ausência no
banco. O banco ficou com 169 produtos — 168 reais mais o fictício `TESTE_RF004_PEDIDO` — e nenhum produto real foi
alterado. A correção de schema que fez o Prisma omitir
`is_available` e `created_at` no `INSERT` manteve os privilégios mínimos da role de runtime.

### 2.3 RF004, RF005, RF007, RF008 e RF009 — jornada real

- **RF004**: pedido **#5** criado na comanda `000126`, cliente `Cliente RF008`, item `TESTE_RF004_PEDIDO` ×1, total
  R$ 1,00 confirmado pelo servidor e snapshots persistidos. O pedido #2 (comanda `000123`) foi preservado.
- **RF005**: login administrativo e rotas protegidas usados na emissão do convite, nas três transições de status e na
  mudança de disponibilidade do produto.
- **RF007**: a lista administrativa atualizou sozinha, com carimbo “Atualizado às …”; o pedido #5 apareceu sem
  recarga manual. O filtro por `ENTREGUE` foi aplicado e capturado em
  `evidencias/rf007-01-filtro-entregue.png`.
- **RF008**: o pedido #5 percorreu `RECEIVED → IN_PREPARATION → READY → DELIVERED` na janela do cliente, com polling
  de 5 segundos, sem F5 e com a URL fixa em `http://localhost:5173/`. O histórico visível contém as quatro entradas.
- **RF009**: `GET /api/openapi.json` 200 (OpenAPI 3.1, 25.920 bytes) e `GET /api/docs` 200. A página `/api/docs` é um
  índice HTML próprio que consome o contrato, não o Swagger UI clássico.
- **RF001–RF003**: catálogo, modal de detalhes e carrinho foram usados na própria jornada que originou o pedido #5.

### 2.4 RF008 — acompanhamento automático

O pedido #5 foi criado às **20:38:03** (horário local; `23:38:03Z`) e passou para `IN_PREPARATION` às **20:38:54**,
`READY` às **20:38:59** e `DELIVERED` às **20:39:04**. Em cada transição, o DOM da janela CLIENTE foi lido com o
componente `#order-tracking-title` montado, `location.href` inalterado e o texto “Status atual” atualizado; não houve
F5, remontagem do React ou edição manual do DOM. As transições foram feitas exclusivamente pelo painel administrativo,
com confirmação.

A captura `evidencias/rf008-01-tracking-final.png` mostra o estado final e o histórico completo; a captura
`evidencias/rf008-02-admin-delivered.png` mostra o painel com o #5 entregue. O registro detalhado está em
`evidencias/README-RF008.md`. **Limitação**: as capturas intermediárias foram feitas com a página no topo do catálogo
e não enquadraram o componente; o registro de DOM comprova os horários, mas não há quatro imagens enquadradas dos
estados. Reexecutar a sequência exigiria um novo pedido, não autorizado nesta etapa. O estado do acompanhamento vive
em memória: após F5 ou desmontagem da página, ele é perdido, comportamento já documentado e fora do escopo desta
entrega corrigir com persistência nova.

### 2.5 Encerramento dos dados demonstrativos

O produto `TESTE_RF004_PEDIDO` foi marcado `UNAVAILABLE` pelo fluxo administrativo, sem excluir o registro e sem
alterar nome, preço, categoria, `sourceCode` ou `publicKey`. O catálogo público passou a não exibi-lo; o detalhe
retorna `isAvailable: false`. Permanecem 169 produtos no banco (168 reais + 1 fictício), e o catálogo público é
paginado. Os pedidos #1–#5 e seus históricos foram preservados: #1 `CANCELLED`, #2–#5 `DELIVERED`. Nenhum SQL de
escrita foi usado para status ou disponibilidade.

### 2.6 Incidente operacional

O pedido histórico #1 (comanda `5`, total R$ 7,00, item `ÁGUA SEM GÁS`) foi cancelado acidentalmente às 16:02:30 UTC de
14/11/2026, antes da criação do pedido #2. Itens, valores e histórico original permanecem íntegros; apenas o status
mudou para `CANCELLED`. Nenhuma restauração foi executada. O registro técnico está em
`backend/docs/incidente-pedido-1-dev.md`.

### 2.7 Testes automatizados e segurança

Resultados comprovados em 14/11/2026, no snapshot de publicação: backend **1.237 testes aprovados, 9 ignorados**, 70
arquivos aprovados e 1 ignorado, exit 0 (`npm test`); frontend **174/174**, exit 0; typecheck e build aprovados em
backend e frontend. O E2E real em runner efêmero do GitHub Actions está registrado em
`backend/docs/github-actions-e2e.md`; o E2E local não foi executado nesta sprint. Em 14/11/2026 foram executados 77
testes direcionados de RF006. A auditoria de segredos terminou com **`POLICY_OK`, exit 0, 7 segredos conformes**,
fora do repositório e do OneDrive. Nenhuma credencial real foi encontrada em arquivo rastreado nem no histórico de
`main`.

## 3. Termo de consentimento

> [PENDENTE — substituir ou conferir esta seção com o modelo oficial fornecido pelo professor antes da assinatura.]

Eu, ________________________________________________, responsável pelo estabelecimento
____________________________________, declaro que fui informado(a) sobre os objetivos acadêmicos do projeto, o escopo
da demonstração e o tratamento das informações fornecidas para a atividade extensionista. Autorizo, nos limites
assinalados no modelo oficial da disciplina, o uso acadêmico das informações e imagens aprovadas por mim.

Local e data: ______________________________________

Nome legível: ______________________________________

Assinatura: ________________________________________

## 4. Links da entrega

- Repositório GitHub (branch `main` — versão publicada mais recente):
  `https://github.com/caliluneto/rustika-cardapio-digital`. O histórico consolida `7b487c3` (99 arquivos),
  `435c3d4` (documentação), `902c3b9` (evidências), `1d71979` (registro da publicação) e `1e49371` (organização de
  código e documentação), com `origin/main` sincronizado. Visibilidade **privada**, não alterada; o acesso do
  avaliador depende de autorização para tornar o repositório público ou conceder acesso individual.
  **PENDENTE: definir a forma de acesso.**
- Vídeo demonstrativo: **[PENDENTE — inserir link após gravação e upload autorizados]**.

## 5. Foto do cardápio físico

**[PENDENTE — inserir foto autorizada pelo estabelecimento, com legenda, data e crédito.]**

## 6. Avaliação pelo proprietário/responsável

Preenchimento exclusivo pelo avaliador; nenhuma resposta foi presumida.

1. A solução apresenta o cardápio de forma clara?  ( ) Sim  ( ) Parcialmente  ( ) Não
2. O fluxo de carrinho e pedido é compreensível?  ( ) Sim  ( ) Parcialmente  ( ) Não
3. O painel administrativo atende à operação demonstrada?  ( ) Sim  ( ) Parcialmente  ( ) Não
4. O acompanhamento de status é útil ao atendimento?  ( ) Sim  ( ) Parcialmente  ( ) Não
5. Pontos positivos: ______________________________________________________________________
6. Melhorias sugeridas: __________________________________________________________________
7. Comentários adicionais: _________________________________________________________________

Nome: __________________________________  Função: ________________________________

Data: __________________________________  Assinatura: ______________________________

## 7. Pendências e autorizações

O que ainda impede declarar a entrega completa, sem omitir pendências reais:

**Validação funcional — ressalvas**

- **RF008**: aprovado com ressalva de evidência. As quatro transições foram observadas na janela do cliente sem F5,
  com URL fixa e histórico completo; a captura final está em `evidencias/rf008-01-tracking-final.png` e o registro de
  horários em `evidencias/README-RF008.md`. As capturas intermediárias não enquadraram o componente e não são usadas
  como prova de estado. Reexecutar a sequência exigiria um novo pedido, não autorizado nesta etapa.
- **RF007**: aprovado. O filtro por `ENTREGUE` está em `evidencias/rf007-01-filtro-entregue.png` e a lista atualizou
  sozinha com carimbo de horário. O painel não possui alerta destacado de “novo pedido”; se a rubrica exigir toast,
  registrar adaptação.
- **RF002**: o modal foi aberto e usado na jornada do #5, com descrição, ingredientes e preço; não há captura dedicada.
  O produto está `UNAVAILABLE` desde o encerramento.
- **RF009**: o contrato OpenAPI 3.1 responde em `/api/openapi.json` e a página `/api/docs` é um índice HTML próprio,
  não o Swagger UI clássico. Se a rubrica exigir Swagger UI, registrar adaptação.

**Materiais humanos**

- Nomes completos e códigos acadêmicos dos integrantes; docente responsável.
- Termo de consentimento e questionário do proprietário preenchidos, assinados e conferidos com o modelo oficial.
- Foto autorizada do cardápio físico.
- Vídeo MP4 de até cinco minutos e link público com acesso testado. **PENDENTE.** A sequência dinâmica do RF008 já
  foi executada no pedido #5; refazê-la exigiria um novo pedido. O vídeo deve usar as capturas reais com rótulo
  “captura real de 14/11/2026” ou obter nova autorização, sem simular atualização ao vivo.
- Repositório em `https://github.com/caliluneto/rustika-cardapio-digital` (branch `main` — versão publicada mais
  recente), com visibilidade **privada**; falta definir como o avaliador terá acesso.

**Publicação segura**

- Senhas locais rotacionadas (4/4) e auditoria repetida: `secrets:audit` = `POLICY_OK`, exit 0, 7 segredos
  conformes. Nenhum segredo real entrou nos commits.
- Commits seletivos, por inventário; `.env`, dumps, logs, `_not-for-publication/`, scripts locais com credenciais e
  artefatos privados ficaram fora. Os caminhos locais não publicados permanecem apenas na máquina.
- Push exclusivamente para `main`, sem force, sem deploy e sem alterar a visibilidade do repositório. Os commits
  `435c3d4`, `902c3b9`, `1d71979` e `1e49371` foram enviados e `origin/main` está sincronizado com a branch `main` —
  versão publicada mais recente.

**Backup e ambientes**

- A restauração integral do backup pré-RF006 **não foi comprovada**; só um ensaio em banco descartável autorizado
  permite afirmá-la.
- A integração local no banco de teste não foi executada nesta etapa; o E2E no GitHub Actions foi executado
  manualmente (CI #5, anterior ao RF006) e está registrado em `backend/docs/github-actions-e2e.md`.
- O ambiente Neon permanece intocado; as 9/9 migrations são do Dev.
