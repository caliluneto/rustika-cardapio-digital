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
RF004 gerou o pedido #2 na comanda `000123`; o RF007 percorreu os quatro estados com histórico atômico; e o RF009
respondeu em `/api/openapi.json` e `/api/docs`. A sequência do RF008 foi confirmada no banco, mas a atualização
automática no navegador ainda depende de confirmação visual. O ambiente Neon não foi acessado. O pedido histórico #1
foi cancelado acidentalmente durante os testes e seu estado foi preservado, sem reescrever o histórico; o incidente está
registrado em `backend/docs/incidente-pedido-1-dev.md`. O documento distingue o que foi efetivamente demonstrado do
que ainda depende de evidência visual, materiais humanos e publicação autorizada.

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

### 2.3 RF004, RF005, RF007 e RF009 — jornada real

- **RF004**: pedido #2 criado na comanda `000123`, cliente `Cliente RF004`, item `TESTE_RF004_PEDIDO` ×1, total R$ 1,00
  confirmado pelo servidor e snapshots persistidos.
- **RF005**: login administrativo e rotas protegidas usados em todas as escritas reais (CRUD e transições).
- **RF007**: o pedido #2 percorreu `RECEIVED → IN_PREPARATION → READY → DELIVERED`, com quatro entradas de histórico
  atômicas e listagem por polling no painel.
- **RF009**: `GET /api/openapi.json` 200 (25.920 bytes) e `GET /api/docs` 200.
- **RF001–RF003**: catálogo, detalhes e carrinho foram usados na própria jornada que originou o pedido #2.

### 2.4 RF008 e limites da validação

A sequência de status do pedido #2 foi confirmada no banco. A atualização automática da tela do cliente (polling de
5 segundos) **ainda depende de confirmação visual do usuário** e não é declarada aprovada. O filtro por status e o
aviso de novo pedido (RF007) também precisam de evidência visual. O modal de detalhes do produto (RF002) não foi
conferido nesta rodada.

### 2.5 Incidente operacional

O pedido histórico #1 (comanda `5`, total R$ 7,00, item `ÁGUA SEM GÁS`) foi cancelado acidentalmente às 16:02:30 UTC de
14/11/2026, antes da criação do pedido #2. Itens, valores e histórico original permanecem íntegros; apenas o status
mudou para `CANCELLED`. Nenhuma restauração foi executada. O registro técnico está em
`backend/docs/incidente-pedido-1-dev.md`.

### 2.6 Testes automatizados e segurança

Resultados comprovados em 14/11/2026, no snapshot de publicação: backend 1.238 testes aprovados, 8 ignorados, 0
falhas (`npm run test:ci`), typecheck e build aprovados. Frontend: 174/174 aprovados (reaproveitado da última
execução; nenhum arquivo relevante mudou), typecheck e build aprovados. O E2E real em runner efêmero do GitHub Actions está registrado em
`backend/docs/github-actions-e2e.md`; o E2E local não foi executado nesta sprint. Em 14/11/2026 foram executados 77
testes direcionados de RF006. A auditoria de segredos continua com
`FAIL` para as senhas locais fracas/reutilizadas: a rotação é obrigatória antes de publicação. Nenhuma credencial real
foi encontrada em arquivo rastreado nem no histórico de `main`.

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

- Repositório GitHub: `https://github.com/caliluneto/rustika-cardapio-digital` — URL configurada como `origin` no
  snapshot de publicação em `C:\Users\u1n3c\RustikaPublish\cardapio-digital-snapshot` (branch `main`). O checkout
  original de desenvolvimento **não** possui remote. **PENDENTE: confirmar acesso, visibilidade e link final.**
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

**Validação funcional**

- **RF008**: confirmar, no navegador e sem recarregar, que a tela do cliente reflete a mudança de status. A sequência
  já está comprovada no banco; a evidência visual ainda é do usuário.
- **RF007**: evidenciar o filtro por status e o aviso de novo pedido no painel (o restante já foi exercitado).
- **RF002**: conferir o modal de detalhes e as fotos reais antes da gravação.

**Materiais humanos**

- Nomes completos e códigos acadêmicos dos integrantes; docente responsável.
- Termo de consentimento e questionário do proprietário preenchidos, assinados e conferidos com o modelo oficial.
- Foto autorizada do cardápio físico.
- Vídeo MP4 de até cinco minutos e link público com acesso testado.
- URL definitiva do repositório GitHub e branch; o checkout original está em `main`, **sem remote configurado**, e o
  snapshot de publicação usa `origin` = `https://github.com/caliluneto/rustika-cardapio-digital.git`.

**Publicação segura**

- Rotacionar as senhas locais reprovadas por `secrets:audit` (`cardapio_dev_app`, `cardapio_test_app`,
  `cardapio_migrator`, `cardapio_test_fixtures`), conforme `backend/docs/secrets-rotation.md`, e repetir a auditoria
  até não haver `FAIL`.
- Selecionar os arquivos do commit por inventário; nunca `git add .`. Excluir `.env`, dumps, logs, dados reais de
  catálogo e scripts locais com credenciais.
- Commit, push, publicação do repositório e deploy dependem de autorização explícita e não foram executados.

**Backup e ambientes**

- A restauração integral do backup pré-RF006 **não foi comprovada**; só um ensaio em banco descartável autorizado
  permite afirmá-la.
- Integração/E2E no banco de teste e no GitHub Actions não foram executados nesta sprint.
- O ambiente Neon permanece intocado; as 9/9 migrations são do Dev.
