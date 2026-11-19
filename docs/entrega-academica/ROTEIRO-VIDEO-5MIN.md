# Roteiro do vídeo demonstrativo — até 5 minutos

## Preparação

- Usar somente o ambiente autorizado (`cardapio_digital_dev`), produtos fictícios e telas sem senhas, tokens,
  cookies ou connection strings. Não abrir DevTools, pasta de segredos nem terminal com variáveis.
- Deixar abertos: catálogo do cliente, painel admin autenticado, segunda janela anônima para o acompanhamento e
  `/api/docs`. Gravar em 1920×1080 com áudio compreensível.
- **Produto fictício**: `TESTE_RF004_PEDIDO` está `UNAVAILABLE`. Reativá-lo pelo painel antes da gravação e
  devolvê-lo a `UNAVAILABLE` ao final, para que nenhum item fictício apareça no catálogo depois.
- Usar o pedido #2 (comanda `000123`) como exemplo. **Não** destacar o pedido #1 cancelado; se ele aparecer na
  lista, não abrir o card.
- Nada de sucesso simulado: cada requisito mostrado deve ter sido executado de fato.

## Sequência (300 s)

| Tempo | Requisito | Demonstração | Narração essencial |
| --- | --- | --- | --- |
| 0:00–0:15 | — | Capa com nomes, códigos e disciplina | Curso, problema e objetivo do RÚSTIKA |
| 0:15–0:50 | **RF001** | Catálogo: categorias, busca de produto e dados vindos da API | Cardápio dinâmico, itens ativos e publicáveis, paginação |
| 0:50–1:15 | **RF002** | Abrir o modal de um produto | Imagem, descrição, ingredientes, preço e disponibilidade |
| 1:15–1:45 | **RF003** | Adicionar ao carrinho, alterar quantidade e remover | Contador, total em centavos e estado em memória |
| 1:45–2:20 | **RF004** | Resgatar a comanda `000123`, revisar e enviar o pedido | Sessão autorizada, preço validado no servidor, idempotência e número confirmado |
| 2:20–2:35 | **RF005** | Login administrativo e abertura de rota protegida | Cookie `HttpOnly`, sessão e proteção das rotas |
| 2:35–3:05 | **RF007** | Painel: lista, **filtro por status**, itens, paginação e histórico | Todos os pedidos, aviso de novo pedido e cursor |
| 3:05–3:40 | **RF006** | Produtos: criar `test`, editar preço/descrição e excluir | CRUD real com PostgreSQL; exclusão bloqueada se houver item de pedido |
| 3:40–4:15 | **RF007 + RF008** | Duas telas: mover `RECEIVED → IN_PREPARATION → READY → DELIVERED` e ver o cliente atualizar **sem recarregar** | Compare-and-set, histórico atômico e polling de 5 s |
| 4:15–4:35 | **RF009** | Abrir `/api/docs` e `/api/openapi.json` | OpenAPI 3.1, schemas, erros, cookies e cabeçalho anti-CSRF |
| 4:35–4:50 | — | Editor com serviços e testes; números reais | 1.241 testes backend e 174 frontend; typechecks e builds verdes |
| 4:50–5:00 | — | Encerramento | Resultado e pendências reais, sem alegar deploy ou validação não executada |

## Ordem de execução prática

1. Abrir o catálogo e deixar o produto fictício visível.
2. Gravar RF001–RF004 em uma única jornada, terminando no pedido #2.
3. Entrar no admin e mostrar RF005, RF007 e RF006.
4. Deixar o acompanhamento aberto na segunda janela e só então mudar os status; narrar a atualização automática.
5. Fechar com OpenAPI, testes e pendências. Devolver o produto fictício a `UNAVAILABLE`.

## Checklist de gravação

- [ ] RF001–RF009 citados e demonstrados, cada um dentro do seu bloco.
- [ ] Nenhuma credencial, cookie, token ou connection string visível.
- [ ] Pedido #1 cancelado não aparece em destaque.
- [ ] Atualização do RF008 ocorre sem recarregar a página; se não ocorrer, não declarar aprovado.
- [ ] Filtro por status e aviso de novo pedido aparecem no vídeo.
- [ ] MP4 com no máximo 5:00, áudio e texto legíveis.
- [ ] Produto fictício devolvido a `UNAVAILABLE` e conferido no catálogo.
- [ ] Link do vídeo testado em janela anônima antes de inserir no relatório.
