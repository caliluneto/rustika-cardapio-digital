# Checklist final da entrega — concluído × pendente

**Base:** `docs/entrega-academica/` · **HEAD:** branch `main` — versão publicada mais recente · **Data:** 14/11/2026

Este checklist consolida o estado real. Itens marcados como concluídos têm evidência no repositório ou na documentação; itens humanos não foram presumidos.

## 1. Concluído e verificado

### Sistema e dados

- [x] Backend e frontend operacionais; smoke tests em `/api/health`, `/api/ready`, `/api/products`, `/api/openapi.json`, `/api/docs` e frontend retornaram HTTP 200.
- [x] Banco local `cardapio_digital_dev` / PostgreSQL 18.6 confirmado.
- [x] Pedido #5 `DELIVERED`, comanda `000126`, total R$ 1,00, histórico com quatro entradas.
- [x] Pedidos #1–#4 preservados: #1 `CANCELLED`; #2–#4 `DELIVERED`.
- [x] Produto `TESTE_RF004_PEDIDO` em `UNAVAILABLE`, fora do catálogo público, sem alteração de nome, preço, categoria ou identidade.
- [x] Nenhum pedido, convite, produto ou status novo foi criado nesta etapa.

### Requisitos

| RF | Situação | Evidência | Limitação registrada |
| --- | --- | --- | --- |
| RF001 | 🟡 | Catálogo paginado pela API; 144 produtos reais públicos consultados em modo somente leitura | 0/144 com descrição e 0/144 com imagem |
| RF002 | 🟡 | Modal suporta os campos e adição ao carrinho | Nenhum produto real possui descrição, ingredientes e imagem; sem demonstração real completa |
| RF003 | ✅ | Carrinho, quantidade e total revisados no #5 | Estado em memória |
| RF004 | ✅ | Pedido #5, comanda `000126`, snapshots e total | Envio ao vivo não pode ser repetido sem novo pedido |
| RF005 | ✅ | Painel autenticado usado em convite, status e disponibilidade | Logout/negativos não capturados |
| RF006 | ✅ | CRUD real do produto `test` validado anteriormente | Nenhuma |
| RF007 | ✅ | Filtro `ENTREGUE`, carimbo de polling e histórico | Alerta de novo pedido sem captura (exige pedido novo) |
| RF008 | ✅ com ressalva | Quatro transições observadas; captura final, histórico e `actorName` coberto por teste | Capturas intermediárias não enquadradas; sem novo pedido |
| RF009 | ✅ | OpenAPI 3.1 e Swagger UI em `/api/docs`; “Execute” validado com GET 200 | Atualizar a gravação acadêmica |

### Testes e qualidade

- [x] Backend: **1.239 aprovados / 9 ignorados**, 70 arquivos aprovados, 1 ignorado, exit 0.
- [x] Frontend: **176/176**, 0 falhas, exit 0.
- [x] Typecheck backend e frontend: exit 0.
- [x] Build backend: exit 0.
- [x] Build frontend: exit 0; Vite 6.4.5, 63 módulos.
- [x] `secrets:audit`: `POLICY_OK`, exit 0, 7 segredos conformes.
- [x] Evidências sem cookies, tokens, senhas ou connection strings.

### Documentação e Git

- [x] `MATRIZ-REQUISITOS.md`, `CHECKLIST-ENTREGA.md`, `RELATORIO-FINAL.md`, `ROTEIRO-VIDEO-5MIN.md` e `GUIA-EXECUCAO.md` atualizados.
- [x] Evidências de RF007, RF008 e RF009 em `evidencias/`.
- [x] Commits `435c3d4` (documentação), `902c3b9` (evidências), `1d71979` (registro da publicação) e `1e49371` (organização final).
- [x] Push normal; `origin/main` sincronizado com a branch `main` — versão publicada mais recente.
- [x] Repositório privado; visibilidade não alterada.
- [x] Nenhum deploy, migration, reset, clean ou force push executado.

## 2. Pendências humanas obrigatórias

- [ ] Nomes completos e códigos acadêmicos dos integrantes.
- [ ] Nome do docente responsável.
- [ ] Pesos oficiais da rubrica copiados para a matriz.
- [ ] Termo de consentimento real, conferido com o modelo do professor e assinado.
- [ ] Questionário/avaliação do proprietário respondido, datado e assinado.
- [ ] Foto autorizada do cardápio físico, com legenda e crédito.
- [ ] Vídeo MP4 de até 5 minutos, com narração e identificação dos integrantes.
- [ ] Link do vídeo testado em janela anônima.
- [ ] Definição do acesso do avaliador ao repositório privado.
- [ ] Exportação final do relatório no formato exigido (PDF/DOCX) e revisão ortográfica.

## 3. Pendências condicionais (somente se a rubrica exigir)

- [ ] Captura dedicada do modal do RF002 com imagem, descrição e ingredientes.
- [ ] Capturas intermediárias do RF008 com os quatro estados enquadrados; exigiria novo pedido autorizado.
- [ ] Prova de restauração integral do backup pré-RF006 em banco descartável.
- [ ] Integração/E2E no banco de teste autorizado.
- [ ] Login/logout e negativos 401/429 capturados no navegador.

## 4. Critério de pronto para entregar

- [ ] Todos os campos humanos acima preenchidos com informação real.
- [ ] Relatório exportado e revisado.
- [ ] Vídeo gravado, reproduzido e com link acessível.
- [ ] Acesso do avaliador testado.
- [ ] Nenhum segredo ou dado pessoal indevido no pacote.

Enquanto os itens humanos não estiverem concluídos, a classificação correta é **PRONTO COM PENDÊNCIAS HUMANAS**.
