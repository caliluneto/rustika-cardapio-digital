# Checklist final da entrega

## Identificação e documentos

- [ ] Inserir nomes completos e códigos acadêmicos na capa do relatório e no vídeo.
- [ ] Copiar os pesos oficiais da rubrica para `MATRIZ-REQUISITOS.md`.
- [ ] Conferir o termo com o modelo oficial do professor.
- [ ] Coletar consentimento e assinatura reais.
- [ ] Inserir foto autorizada do cardápio físico.
- [ ] Coletar questionário e assinatura do proprietário/responsável.
- [ ] Revisar ortografia, paginação e exportar o relatório no formato solicitado.

## Código e execução

- [x] RF001–RF009 implementados; RF004, RF005, RF006, RF007, RF008 e RF009 exercitados com PostgreSQL Dev real.
- [x] Backend: **1.237 aprovados e 9 ignorados** (70 arquivos aprovados, 1 ignorado, exit 0); frontend: **174/174**.
- [x] Typecheck e build aprovados em backend e frontend.
- [x] Identidade PostgreSQL validada: `cardapio_digital_dev`, PostgreSQL 18.6, **9/9 migrations aplicadas**.
- [x] RF006 validado em banco real: criar, editar e excluir produto fictício `test`, com persistência confirmada.
- [x] RF004 validado com o **pedido #5** (comanda `000126`, convite resgatado, total R$ 1,00); pedido #2 preservado.
- [x] RF007 validado: lista atualizada sozinha, filtro por `ENTREGUE` capturado e histórico visível.
- [x] RF002: modal do produto fictício usado na jornada do #5, com descrição e ingredientes; preço conferido no
      carrinho e na revisão; sem captura dedicada do modal.
- [x] RF008: quatro transições observadas na janela do cliente, sem F5; captura final e registro de DOM em
      `evidencias/README-RF008.md`.
- [x] Produto `TESTE_RF004_PEDIDO` marcado `UNAVAILABLE` pelo painel; catálogo público não o exibe e o detalhe retorna
      `isAvailable: false`.
- [x] Pedidos #1–#5 preservados: #1 `CANCELLED`; #2–#5 `DELIVERED`, com históricos intactos.
- [x] Senhas locais rotacionadas (4/4) e auditoria repetida: `secrets:audit` = `POLICY_OK`, exit 0, 7 segredos
      conformes.
- [x] Backup pré-RF006 gerado e verificado por SHA-256 e TOC: 47.535 bytes, SHA-256
      `12b97471552173e3bd6291585dd93d497393c700e63c2ef5222cb4ef75c8ee96`.
- [ ] Provar a restauração integral do backup em banco descartável; até lá o backup não é considerado comprovado.
- [ ] Executar integração e Playwright E2E no banco de teste autorizado; o Test local está em 5/7 (faltam
      20261105/06).
- [x] Evidências guardadas sem cookies, tokens, senhas ou connection strings.
- [x] Incidente do pedido #1 cancelado registrado em `backend/docs/incidente-pedido-1-dev.md`, sem reescrever o
      histórico.

## GitHub e publicação

- [x] URL e branch confirmadas: `origin` = `https://github.com/caliluneto/rustika-cardapio-digital.git`, branch `main`.
- [x] Commit de referência anterior: `7b487c3` (99 arquivos); `origin/main` estava sincronizado antes desta rodada.
- [x] Visibilidade do repositório: **privada**, não alterada. O acesso do avaliador depende de autorização para
      tornar o repositório público ou conceder acesso individual.
- [x] Nenhum segredo real nos commits: verificação no staging e `secrets:audit` (`POLICY_OK`, exit 0).
- [x] Caminhos locais não publicados permanecem fora do repositório (provisionadores Neon, backups,
      `_not-for-publication/`, scripts locais; `node_modules/` e `dist/` são ignorados pelo `.gitignore`).
- [x] Commits desta rodada `435c3d4` (documentação) e `902c3b9` (evidências) enviados; `origin/main` sincronizado.
      O hash do commit final de registro consta no relatório de conclusão.
- [ ] Decidir e registrar a forma de acesso do avaliador (repositório público ou convite nominal).
- [ ] Não fazer deploy sem autorização; nenhum deploy foi executado.

## Vídeo

- [ ] Gravar MP4 de até 5 minutos conforme `ROTEIRO-VIDEO-5MIN.md`, cobrindo RF001–RF009.
- [ ] Mostrar cliente, modal do produto, admin, status automático, histórico, filtros, OpenAPI, código e testes.
- [ ] No RF008, usar as capturas reais com rótulo “captura real de 14/11/2026” ou obter nova autorização para um
      pedido adicional. Não simular a atualização ao vivo.
- [ ] No RF002, se o produto fictício for reativado apenas para a gravação, devolvê-lo a `UNAVAILABLE` ao final.
- [ ] Não mostrar credenciais, tokens, cookies, o pedido #1 cancelado em destaque ou resultados não executados.
- [ ] Fazer upload autorizado, testar o link e inserir no relatório.

## Confirmação final

- [ ] Todos os campos `[PENDENTE]` foram preenchidos com informações reais.
- [ ] A matriz corresponde ao comportamento demonstrado.
- [ ] Relatório, vídeo e repositório abrem para o avaliador.
- [ ] Uma cópia final foi preservada em local seguro.
