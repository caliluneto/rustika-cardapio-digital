# Roteiro do vídeo demonstrativo — até 5 minutos

> Versão de **14/11/2026**, posterior à validação final. O vídeo deve mostrar apenas comportamento realmente
> executado. **Não criar um sexto pedido.** A única tentativa adicional autorizada já foi usada no pedido #5.
> O RF008 dinâmico não será simulado: usar as capturas reais com rótulo ou obter nova autorização humana.

## 0. Estado real antes de gravar

- **Pedido de referência**: #5, comanda `000126`, cliente `Cliente RF008`, `TESTE_RF004_PEDIDO` ×1, total R$ 1,00,
  `DELIVERED`, histórico com quatro entradas. Criado em 14/11/2026, 20:38:03 (horário local).
- **Pedidos preservados**: #1 `CANCELLED`; #2 `DELIVERED` (comanda `000123`); #3 `DELIVERED` (`000124`); #4
  `DELIVERED` (`000125`); #5 `DELIVERED` (`000126`).
- **Produto fictício**: `TESTE_RF004_PEDIDO` está `UNAVAILABLE` pelo painel. O catálogo público não o exibe; o detalhe
  retorna `isAvailable: false`. Permanecem 169 produtos no banco (168 reais + 1 fictício).
- **Cliente**: a janela ainda tem o acompanhamento do #5 montado em `http://localhost:5173/`, com o histórico
  completo. **Não pressionar F5** nessa janela.
- **Admin**: `http://localhost:5173/#admin`, autenticado, com a seção **Pedidos** disponível.
- **Evidências reais**: `evidencias/rf008-01-tracking-final.png`, `evidencias/rf008-02-admin-delivered.png`,
  `evidencias/rf007-01-filtro-entregue.png`, `evidencias/rf009-01-docs.png` e `evidencias/README-RF008.md`.
- **Testes**: backend 1.237 aprovados / 9 ignorados; frontend 174/174; typecheck e build aprovados.

## 1. Decisões humanas antes do play

1. **RF002 — modal completo**: o produto fictício está indisponível. Para mostrar imagem, descrição e ingredientes ao
   vivo, o responsável pode autorizar a reativação temporária pelo painel, gravá-la e devolvê-la a `UNAVAILABLE` ao
   final. Sem essa autorização, mostrar o modal de um produto real (mais pobre em descrição) ou usar o registro da
   validação, sempre identificando a limitação.
2. **RF004 — envio ao vivo**: exigiria um novo pedido, não autorizado. Mostrar o **pedido #5 já existente** no painel
   e o acompanhamento real, com o rótulo “pedido real de 14/11/2026”. Não encenar um checkout.
3. **RF006 — CRUD ao vivo**: a validação real já foi feita. Se o grupo quiser gravar uma nova criação/exclusão, usar
   um produto fictício novo e autorizado, sem tocar nos produtos reais.
4. **RF005 — login**: se a rubrica exigir a tela de login, gravar o logout/login com a conta local; nunca mostrar a
   senha, o cookie ou o arquivo de segredos.
5. **Identificação**: nomes, códigos acadêmicos, docente, narração e consentimento são informações humanas; não
   inventar.

## 2. Preparação fora do vídeo

- Fechar notificações do Windows, WhatsApp/Slack, abas com `.env`, terminais com variáveis e a pasta de segredos.
- Gravar em 1920×1080, fonte do navegador em 100–125%, mouse lento e áudio testado por 10 s.
- Deixar o **CLIENTE** com o acompanhamento do #5 visível e o **ADMIN** na seção **Pedidos**.
- Abrir uma aba com `http://localhost:4000/api/docs` e outra com `http://localhost:4000/api/openapi.json`.
- Ter à mão a saída real dos testes (`1.237/9` e `174/174`) e os arquivos de evidência.
- Não abrir DevTools, não exibir tokens, cookies, senhas ou connection strings.

## 3. Sequência de gravação (300 s)

| Tempo | RF | Ação prática | O que precisa aparecer |
| --- | --- | --- | --- |
| 0:00–0:15 | — | Capa com curso, disciplina, projeto e integrantes | Nomes/códigos reais; não inventar |
| 0:15–0:45 | **RF001** | Janela CLIENTE: percorrer as categorias, filtrar uma delas e abrir um produto | Catálogo vindo da API, categorias e contagem de itens |
| 0:45–1:05 | **RF002** | Abrir o modal de um produto | Imagem, descrição/ingredientes quando disponíveis, preço e disponibilidade; se usar produto real, não alegar descrição inexistente |
| 1:05–1:30 | **RF003** | Adicionar ao carrinho, alterar quantidade e remover | Contador, subtotal e total em centavos; estado em memória |
| 1:30–1:45 | **RF005** | Painel administrativo; opcionalmente, logout/login | Rota protegida e sessão; nunca mostrar a senha |
| 1:45–2:20 | **RF004** | Mostrar o **pedido #5** no ADMIN: comanda `000126`, item, total e histórico | Rótulo “pedido real de 14/11/2026”; não encenar envio |
| 2:20–2:50 | **RF007** | Aplicar o filtro `ENTREGUE`; mostrar o carimbo “Atualizado às …”, itens e histórico | Filtro funcionando e polling de 10 s; não inventar toast de novo pedido |
| 2:50–3:30 | **RF008** | Exibir a captura final do acompanhamento e o registro de horários; opcionalmente, a janela CLIENTE ainda aberta | Rótulo “captura real de 14/11/2026”; estados Recebido → Em preparação → Pronto → Entregue; **não simular atualização ao vivo** |
| 3:30–4:00 | **RF006** | Seção **Produtos**: mostrar o formulário e o produto fictício; CRUD ao vivo só se autorizado | Cadastro/edição/exclusão reais; não alterar produtos reais |
| 4:00–4:20 | **RF009** | Abrir `/api/docs` e `/api/openapi.json`, expandir uma operação | OpenAPI 3.1, schemas e cabeçalhos; a página é um índice próprio, não Swagger UI |
| 4:20–4:40 | — | Mostrar a saída real dos testes e os builds | `1.237/9`, `174/174`, typecheck/build aprovados |
| 4:40–5:00 | — | Encerramento | O que foi demonstrado e o que segue pendente; não alegar deploy |

## 4. O que não pode aparecer

- Tokens de convite, cookies, senhas, arquivos `.env`, connection strings ou DevTools.
- O pedido #1 cancelado em destaque.
- Um checkout ou uma transição de status encenada como se tivesse acontecido agora.
- Capturas estáticas apresentadas como demonstração dinâmica sem o rótulo de captura real.
- Qualquer afirmação de deploy público, acesso ao Neon ou resultado de teste não executado.

## 5. Encerramento e limpeza

1. Se o produto fictício foi reativado apenas para a gravação, marcá-lo `UNAVAILABLE` novamente pelo painel e conferir
   que sumiu do catálogo.
2. Não excluir pedidos nem históricos. O #5 permanece `DELIVERED`; os #2–#4 permanecem como estão.
3. Salvar o MP4 com no máximo 5:00, conferir duração, áudio e legibilidade.
4. Subir com autorização, testar o link em janela anônima e só então inserir em `RELATORIO-FINAL.md`.
5. Registrar no relatório qual trecho do RF008 foi captura real e qual foi apenas leitura do estado final.

## 6. Checklist de gravação

- [ ] RF001–RF009 citados, cada um no seu bloco.
- [ ] RF002 sem alegar descrição ou imagem que não esteja na tela.
- [ ] RF004 identificado como pedido real já existente, sem encenação de checkout.
- [ ] RF007 com filtro e carimbo de atualização.
- [ ] RF008 com captura real e rótulo; nenhuma simulação de polling.
- [ ] Pedidos #1–#5 preservados; nenhum pedido novo criado.
- [ ] Produto fictício devolvido a `UNAVAILABLE` e conferido no catálogo.
- [ ] Nenhuma credencial, cookie, token ou connection string visível.
- [ ] MP4 ≤ 5:00, áudio compreensível e texto legível.
- [ ] Link testado em janela anônima antes de entrar no relatório.
