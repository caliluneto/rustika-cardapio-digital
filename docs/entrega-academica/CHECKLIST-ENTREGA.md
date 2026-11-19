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

- [x] RF001–RF009 implementados; RF004, RF005, RF006, RF007 e RF009 exercitados com PostgreSQL Dev real.
- [x] Backend: 1.241 testes aprovados e 9 ignorados; frontend: 174 aprovados (validação local mais recente).
- [x] Typechecks e builds aprovados.
- [x] Identidade PostgreSQL validada: `cardapio_digital_dev`, PostgreSQL 18.6, **9/9 migrations aplicadas**.
- [x] RF006 validado em banco real: criar, editar e excluir produto fictício `test`, com persistência confirmada.
- [x] RF004 validado com o **pedido #2** (comanda `000123`, total R$ 1,00).
- [x] RF007 validado parcialmente: transições reais `RECEIVED → IN_PREPARATION → READY → DELIVERED` e histórico.
- [ ] RF007: evidenciar filtro por status e aviso de novo pedido no vídeo.
- [ ] RF008: confirmar a atualização automática no navegador, sem recarregar a página.
- [ ] Rotacionar as senhas locais reprovadas por `secrets:audit` e repetir a auditoria; procedimento em
      `backend/docs/secrets-rotation.md` e resumo em `backend/docs/rotate-password-plan.md`.
- [x] Backup pré-RF006 gerado e verificado por SHA-256 e TOC: 47.535 bytes, SHA-256
      `12b97471552173e3bd6291585dd93d497393c700e63c2ef5222cb4ef75c8ee96`.
- [ ] Provar a restauração integral do backup em banco descartável; até lá o backup não é considerado comprovado.
- [ ] Executar integração e Playwright E2E no banco de teste autorizado; o Test local está em 5/7 (faltam 20261105/06).
- [x] Guardar evidências sem cookies, tokens, senhas ou connection strings.
- [x] Incidente do pedido #1 cancelado registrado em `backend/docs/incidente-pedido-1-dev.md`, sem reescrever o histórico.

## GitHub e publicação

- [ ] Confirmar URL/branch do GitHub. O checkout original **não tem remote**; o snapshot de publicação em
      `C:\Users\u1n3c\RustikaPublish\cardapio-digital-snapshot` usa `origin` =
      `https://github.com/caliluneto/rustika-cardapio-digital.git` na branch `main`.
- [ ] Revisar o conjunto de arquivos, inclusive os **268 não rastreados**; não usar `git add .` sem inventário.
- [ ] Excluir do commit `.env`, dumps, backups, logs sensíveis, dados reais de catálogo e scripts locais com credenciais.
- [ ] Conferir que nenhum segredo real entra no commit e concluir a rotação pendente antes da publicação.
- [ ] Fazer commit/push somente com autorização do aluno.
- [ ] Não tornar o repositório público nem fazer deploy sem autorização.

## Vídeo

- [ ] Preparar dados exclusivamente de teste; se o produto fictício estiver `UNAVAILABLE`, reativá-lo pelo painel
      apenas durante a gravação e devolvê-lo a `UNAVAILABLE` ao final.
- [ ] Gravar MP4 de até 5 minutos conforme `ROTEIRO-VIDEO-5MIN.md`, cobrindo RF001–RF009.
- [ ] Mostrar cliente, admin, status automático, histórico, filtros, OpenAPI, código e testes.
- [ ] Não mostrar credenciais, tokens, cookies, o pedido #1 cancelado em destaque ou resultados não executados.
- [ ] Fazer upload autorizado, testar o link e inserir no relatório.

## Confirmação final

- [ ] Todos os campos `[PENDENTE]` foram preenchidos com informações reais.
- [ ] A matriz corresponde ao comportamento demonstrado.
- [ ] Relatório, vídeo e repositório abrem para o avaliador.
- [ ] Uma cópia final foi preservada em local seguro.
