# Guia de gravação do vídeo — passo a passo

**Duração máxima:** 5:00  
**Roteiro de referência:** [`../ROTEIRO-VIDEO-5MIN.md`](../ROTEIRO-VIDEO-5MIN.md)  
**Objetivo:** demonstrar o sistema atual sem criar pedidos, convites, produtos ou alterar status.

> **Regra principal:** esta gravação é somente leitura. Não criar pedido, não emitir convite, não mudar status, não
> editar/excluir produto, não alterar disponibilidade e não rodar migrations. O RF008 dinâmico já foi executado no
> pedido #5 e não será repetido.

## 1. Antes de gravar

### 1.1 Serviços e janelas

Com os serviços já em execução:

| Janela/aba | URL | Estado necessário |
| --- | --- | --- |
| **A — CLIENTE** | `http://localhost:5173/` | catálogo no topo; se o acompanhamento do #5 estiver montado, **não pressionar F5** |
| **B — ADMIN** | `http://localhost:5173/#admin` | já autenticado; seção **Pedidos** visível |
| **C — DOCS** | `http://localhost:4000/api/docs` | página de operações carregada |
| **D — OPENAPI** | `http://localhost:4000/api/openapi.json` | JSON carregado |
| **E — APOIO** | `../CHECKLIST-ENTREGA.md` ou uma slide | resultados reais dos testes, sem executar a suíte de novo |

- Deixar A e B lado a lado, se possível.
- Fechar notificações do Windows, WhatsApp/Slack, abas com `.env`, terminais com variáveis e a pasta de segredos.
- Não abrir DevTools, cookie jar, rede ou arquivos de credenciais.
- Conferir que o produto `TESTE_RF004_PEDIDO` continua `UNAVAILABLE`. **Não alterar.**

### 1.2 Identificação e áudio

- Gravar em 1920×1080, fonte do navegador em 100–125%, mouse lento.
- Testar 10 s de áudio.
- Ter os nomes/códigos reais dos integrantes para a capa; não inventar.
- Narração humana, em português, explicando o que está sendo mostrado.

## 2. Cena a cena (300 s)

### 0:00–0:15 — Capa

**Tela:** slide ou editor com curso, disciplina, projeto, integrantes e data.

**Dizer:** “Este é o RÚSTIKA — Cardápio Digital, projeto acadêmico da Prática Extensionista VII. A demonstração usa o
ambiente local de desenvolvimento e dados fictícios.”

**Não mostrar:** senha, token, cookie, connection string.

### 0:15–0:45 — RF001: catálogo e categorias

**Tela A (CLIENTE).**

1. Rolar até “NOSSO MENU”.
2. Passar pelas categorias (PORÇÕES, DRINKS, CERVEJAS etc.).
3. Selecionar a categoria `CERVEJAS` e localizar um produto real, por exemplo `CORONA`.
4. Mostrar que o catálogo vem da API, com a contagem de itens e categorias.

**Dizer:** “O catálogo é carregado da API, com categorias e todos os itens disponíveis.”

**Não fazer:** não clicar em Admin, não recarregar.

### 0:45–1:05 — RF002: detalhes do produto

**Tela A (CLIENTE).**

1. Abrir o modal de um produto real disponível, por exemplo `ÁGUA COM GÁS`.
2. Mostrar imagem, nome, preço e disponibilidade.
3. Se o produto tiver descrição/ingredientes, mostrá-los. Se não tiver, **não alegar** que existem.

**Dizer:** “O modal apresenta os detalhes disponíveis no catálogo. O produto fictício usado na validação tinha
descrição e ingredientes, mas está indisponível desde o encerramento e não será alterado nesta gravação.”

**Limitação:** não há captura dedicada do modal do produto fictício. Se a rubrica exigir essa imagem, registrar como
pendência; não reativar o produto sem autorização.

### 1:05–1:30 — RF003: carrinho e quantidades

**Tela A (CLIENTE).**

1. Adicionar 1 unidade do produto aberto.
2. Abrir o carrinho.
3. Alterar a quantidade para 2.
4. Remover o item e fechar o carrinho.

**Dizer:** “O carrinho mantém quantidade, subtotal e total em centavos. Nesta gravação não há envio de pedido.”

**Não fazer:** não clicar em “Revisar pedido” até o envio, não preencher checkout, não enviar.

### 1:30–1:45 — RF005: acesso administrativo

**Tela B (ADMIN).**

1. Mostrar o painel já autenticado.
2. Rolar por **Pedidos** e **Produtos**.
3. Mostrar que as rotas são protegidas e que o painel usa a sessão administrativa.

**Dizer:** “O acesso administrativo é autenticado e as operações de escrita exigem sessão, origem permitida e o
cabeçalho anti-CSRF.”

**Não fazer:** não fazer logout/login nesta gravação para não criar nova sessão; se a rubrica exigir a tela de login,
gravar em uma tomada separada, sem exibir a senha.

### 1:45–2:20 — RF004: pedido real #5

**Tela B (ADMIN).**

1. Em **Pedidos**, selecionar o filtro `ENTREGUE`.
2. Localizar o **Pedido #5**.
3. Mostrar comanda `000126`, cliente `Cliente RF008`, item `TESTE_RF004_PEDIDO` ×1 e total R$ 1,00.
4. Expandir **Histórico (4)** e mostrar as quatro entradas.

**Dizer:** “Este é o pedido #5, criado e concluído na validação real de 14/11/2026. Não é um pedido novo; o histórico
está preservado.”

**Não fazer:** não clicar em transições, cancelar ou criar convite.

### 2:20–2:50 — RF007: filtro, polling e histórico

**Tela B (ADMIN).**

1. Mostrar o filtro `ENTREGUE` e o carimbo “Atualizado às … (a lista atualiza sozinha)”.
2. Limpar o filtro e mostrar a lista com #5, #4, #3 e #2.
3. Reaplicar `ENTREGUE`.
4. Mostrar que o painel atualiza por polling de 10 s.

**Dizer:** “O painel lista os pedidos, filtra por status e atualiza sozinho. Não há toast destacado de novo pedido;
a evidência é o carimbo de atualização e a lista que se atualiza.”

**Evidência:** [`../evidencias/rf007-01-filtro-entregue.png`](../evidencias/rf007-01-filtro-entregue.png).

### 2:50–3:30 — RF008: acompanhamento automático

**Tela A (CLIENTE), depois material de evidência.**

1. Rolar até **“Acompanhe seu pedido #5”**.
2. Mostrar **Status atual: Entregue** e o histórico com Recebido, Em preparação, Pronto e Entregue.
3. Cortar para [`../evidencias/rf008-01-tracking-final.png`](../evidencias/rf008-01-tracking-final.png) e
   [`../evidencias/rf008-02-admin-delivered.png`](../evidencias/rf008-02-admin-delivered.png).
4. Se necessário, mostrar o registro de horários em [`../evidencias/README-RF008.md`](../evidencias/README-RF008.md).

**Dizer:** “As quatro transições foram observadas na janela do cliente em 14/11/2026, sem F5, com a URL fixa. Esta é
uma captura real do estado final e do histórico. As capturas intermediárias não enquadraram o componente; por isso
não serão apresentadas como se fossem uma nova demonstração ao vivo.”

**Não fazer:** não mudar status, não criar pedido, não editar DOM, não simular polling, não recarregar.

**Limitação:** um novo vídeo dinâmico do RF008 exigiria um novo pedido autorizado, o que não faz parte desta etapa.

### 3:30–4:00 — RF006: gestão de produtos

**Tela B (ADMIN).**

1. Abrir **Produtos**.
2. Mostrar o produto `TESTE_RF004_PEDIDO` como **Indisponível**.
3. Abrir o formulário de edição apenas para mostrar os campos.
4. Cancelar/fechar sem salvar.
5. Mostrar que a validação real de criar/editar/excluir o produto `test` já foi registrada.

**Dizer:** “O CRUD de produtos foi validado em banco real na etapa anterior. Nesta gravação não vamos criar, editar
nem excluir nada, para preservar os dados.”

**Não fazer:** não salvar, não excluir, não alterar disponibilidade.

### 4:00–4:20 — RF009: documentação OpenAPI

**Tela C (DOCS) e Tela D (OPENAPI).**

1. Mostrar `/api/docs` com as operações.
2. Abrir `/api/openapi.json` e mostrar `openapi: 3.1.0`, paths e schemas.
3. Explicar que a página é um índice próprio que consome o contrato.

**Dizer:** “O contrato OpenAPI 3.1 está disponível em `/api/openapi.json`; `/api/docs` é um índice HTML próprio, não
o Swagger UI clássico.”

**Evidência:** [`../evidencias/rf009-01-docs.png`](../evidencias/rf009-01-docs.png).

### 4:20–4:40 — Testes e builds

**Tela E (apoio).**

Mostrar o resumo já registrado:

- backend: 1.237 aprovados / 9 ignorados;
- frontend: 174/174;
- typecheck e builds aprovados;
- smoke tests HTTP 200.

**Dizer:** “Os resultados são os da execução real de 14/11/2026. A suíte não será repetida durante a gravação.”

**Não fazer:** não executar a suíte completa de novo.

### 4:40–5:00 — Encerramento

**Tela:** slide final ou o próprio relatório.

**Dizer:** “O sistema está tecnicamente estável. Permanecem pendentes os documentos humanos, a foto autorizada, o
link do vídeo e a definição de acesso ao repositório privado. Não houve deploy público.”

## 3. Trechos sem escrita no banco

| Trecho | Ação | Escreve no banco? |
| --- | --- | --- |
| RF001 | navegar, filtrar por categoria, rolar | Não |
| RF002 | abrir modal de produto | Não |
| RF003 | adicionar/alterar/remover no carrinho | Não; estado em memória |
| RF004 | visualizar pedido #5 | Não |
| RF005 | visualizar painel já autenticado | Não; não fazer logout/login |
| RF006 | abrir formulário e cancelar | Não; salvar/excluir escreveria |
| RF007 | filtrar, limpar filtro, ver polling | Não; apenas GET |
| RF008 | ver tracking e capturas | Não; não mudar status |
| RF009 | abrir docs e openapi.json | Não; apenas GET |
| Testes | mostrar resultados registrados | Não; não reexecutar |

## 4. O que não pode aparecer

- Tokens de convite, cookies, senhas, `.env`, connection strings e DevTools.
- Pedido #1 cancelado em destaque.
- Checkout, convite, transição de status ou CRUD encenados como se tivessem acontecido agora.
- Capturas estáticas sem o rótulo “captura real de 14/11/2026”.
- Alegação de deploy, acesso ao Neon ou teste não executado.

## 5. Depois de gravar

1. Conferir que nenhum dado foi alterado durante a gravação.
2. Confirmar que o produto continua `UNAVAILABLE` e os pedidos #1–#5 permanecem como estavam.
3. Salvar o arquivo com no máximo 5:00 e conferir áudio, foco e legibilidade.
4. Revisar o vídeo em busca de credenciais ou dados pessoais.
5. Subir com autorização, testar o link em janela anônima e só então inserir em `RELATORIO-FINAL.md`.
6. Registrar no relatório quais trechos foram capturas reais e quais foram apenas visualização de estado.
