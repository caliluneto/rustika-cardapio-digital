# RÚSTIKA — Procedimento local Windows para RF004 e RF005

Data: 2026-11-09. Ambiente: Windows + PowerShell 5.1, PostgreSQL local em `127.0.0.1:5432`.

Este documento entrega o **procedimento executável no Windows** para demonstrar o fluxo real
cliente → backend → administrador. Ele existe porque duas etapas exigem terminal interativo
(TTY) e por isso não podem ser concluídas por um agente automatizado: a digitação oculta da
senha do administrador.

> **Nada aqui foi executado no Neon.** Todos os comandos apontam para o PostgreSQL local
> (`cardapio_digital_dev`). Nenhum seed, migration, `db push`, `DROP` ou `RESET` é usado.

---

## 0. Estado verificado em 2026-11-09 (somente leitura)

| Item | Valor observado |
| --- | --- |
| Banco | `cardapio_digital_dev` em `127.0.0.1:5432` |
| Role de runtime | `cardapio_dev_app` (sem superuser/createrole/createdb) |
| Categorias / produtos | 12 / 168, todos `is_active = true` |
| Disponibilidade | 142 `AVAILABLE`, 26 `UNKNOWN` |
| **Administradores** | **0** ← bloqueio do RF005 |
| Pedidos / itens | 0 / 0 |
| Comandas / sessões / convites | 0 / 0 / 0 |
| Privilégios da role | `INSERT/UPDATE/DELETE/SELECT` em `admins`, `orders`, `comandas`, `comanda_invitations`, `comanda_sessions` |

Conclusão: o catálogo está pronto; **falta o primeiro administrador**. Sem ele não existe
login administrativo, não existe convite de comanda e, portanto, não existe pedido real.

---

## 1. Criar o primeiro administrador (RF005)

O script `backend/scripts/bootstrap-admin-dev.ts` foi criado nesta entrega exatamente para
esta lacuna. Ele é separado do bootstrap de homologação e tem guardas próprias:

- só aceita o perfil `app-dev` e o banco `cardapio_digital_dev`;
- só aceita host local (`127.0.0.1`, `localhost`, `::1`) — nunca Neon/Render;
- recusa se já existir **qualquer** administrador;
- exige `--execute` **e** a variável de confirmação para escrever;
- a senha é digitada em TTY oculto, nunca por argumento, ambiente ou arquivo;
- reutiliza `hashPassword` e `checkPasswordPolicy` já existentes.

### 1.1 Dry-run (nenhuma escrita)

```powershell
cd C:\Users\<usuario>\OneDrive\Documentos\Cardapio_Digital\backend
npx tsx scripts/bootstrap-admin-dev.ts --name "Operador Rustika" --email operador@rustika.local
```

Saída esperada:

```
[bootstrap-dev] ambiente=dev banco=cardapio_digital_dev role=cardapio_dev_app host=127.0.0.1 modo=dry-run
[bootstrap-dev] resultado=dry-run-ok (nenhuma escrita realizada)
[bootstrap-dev] criaria administrador=o***@rustika.local
```

### 1.2 Execução real (escreve 1 linha em `admins`)

Abra um **PowerShell interativo** (não use pipe, redirecionamento nem terminal de IDE sem TTY,
pois a leitura da senha é recusada por projeto):

```powershell
cd C:\Users\<usuario>\OneDrive\Documentos\Cardapio_Digital\backend
$env:CARDAPIO_DEV_BOOTSTRAP_CONFIRMATION = "CREATE_FIRST_ADMIN_RUSTIKA_DEV"
npx tsx scripts/bootstrap-admin-dev.ts --name "Operador Rustika" --email operador@rustika.local --execute
```

O terminal pedirá `Senha do administrador:` e `Repita a senha:` — os caracteres **não aparecem**.

Política de senha aplicada (a mesma do projeto): mínimo **14 caracteres**, ao menos **3** entre
minúsculas/maiúsculas/números/símbolos, no mínimo 6 caracteres distintos, e **sem** conter
`password`, `senha`, `qwerty`, `123456`, `rustika`, `cardapio`, `admin`, `letmein`, o nome ou o
e-mail. Exemplo válido (troque antes de usar):

```
Cafe#Forte2026!mesa
```

Saída esperada:

```
[bootstrap-dev] resultado=created administrador=o***@rustika.local id=<uuid>
```

Ao terminar, limpe a variável da sessão:

```powershell
Remove-Item Env:\CARDAPIO_DEV_BOOTSTRAP_CONFIRMATION
```

### 1.3 Conferir no banco (somente leitura)

```powershell
cd C:\Users\<usuario>\OneDrive\Documentos\Cardapio_Digital\backend
npx tsx -e "import{PrismaClient}from'@prisma/client';import{loadDatabaseProfile}from'./src/config/secrets';const p=loadDatabaseProfile('app-dev',{purpose:'runtime'});const c=new PrismaClient({datasources:{db:{url:p.databaseUrl}}});c.admin.findMany({select:{email:true,name:true,isActive:true}}).then(r=>{console.log(r);return c.$disconnect()})"
```

---

## 2. Subir backend e frontend (RF004)

Use **duas** janelas de PowerShell.

### 2.1 Backend (porta 4000)

```powershell
cd C:\Users\<usuario>\OneDrive\Documentos\Cardapio_Digital\backend
$env:NODE_ENV = "development"
$env:DB_PROFILE = "app-dev"
$env:PORT = "4000"
$env:CORS_ORIGIN = "http://localhost:5173"
npx tsx src/server.ts
```

Confirme: <http://localhost:4000/api/health> deve responder `"status":"ok"`.

### 2.2 Frontend (porta 5173) — **com o envio habilitado**

```powershell
cd C:\Users\<usuario>\OneDrive\Documentos\Cardapio_Digital\frontend
$env:VITE_API_URL = "http://localhost:4000/api"
$env:VITE_ORDER_SUBMISSION = "enabled"
$env:VITE_CATALOG_MODE = "api"
npx vite --port 5173 --strictPort
```

> **Ponto crítico do RF004.** `VITE_ORDER_SUBMISSION=enabled` é a única forma de ligar o envio:
> não existe atalho por `window` nem por JavaScript no console. Sem essa variável o botão
> "Enviar pedido" fica desabilitado por projeto. Ela precisa estar definida **antes** de subir
> o Vite, porque o valor é injetado no build.

---

## 3. Jornada completa no navegador

Abra <http://localhost:5173>.

### 3.1 Login administrativo (RF005)

1. Clique em **Admin** (canto superior direito) ou abra <http://localhost:5173/#admin>.
2. Informe o e-mail e a senha criados no passo 1.
3. Deve aparecer **Painel Administrativo** com "Olá, Operador Rustika".
4. Recarregue a página: a sessão deve ser restaurada pelo cookie `HttpOnly` (sem novo login).
5. Clique em **Sair**: deve voltar ao formulário de login. Recarregue: continua deslogado.

### 3.2 Emitir convite de comanda

1. No painel, em **Emitir Convite de Comanda**, informe um número de 1 a 6 dígitos (ex.: `10001`).
2. Clique em **Emitir Convite**.
3. Copie o token de 64 caracteres exibido em **Convite** (uso único, validade padrão de 10 min).

### 3.3 Pedido do cliente (RF004)

1. Volte ao cardápio (**← Voltar para o Cardápio**).
2. Abra o **Carrinho** e cole o token em **Vincular comanda** → **Resgatar**.
3. Deve aparecer **✓ Sessão ativa: Comanda 10001**.
4. Adicione produtos ao carrinho → **Revisar pedido** → **Prosseguir para envio**.
5. Preencha **Seu nome** (mínimo 2 caracteres) e clique em **Enviar pedido**.
6. A confirmação deve exibir: **Pedido nº `<número>` registrado para a comanda 10001** e o
   **Total confirmado pelo servidor**.

O número do pedido é gerado pelo PostgreSQL (`orderNumber`), não pelo frontend.

### 3.4 Pedido no painel administrativo

1. Volte em **Admin** (a sessão continua ativa).
2. Em **Pedidos**, o pedido aparece em até 10 s (polling) ou clique em **Atualizar**.
3. Confira: número, comanda, nome do cliente, itens, total e status **Recebido**.
4. Opcional (RF008, fora do escopo desta etapa): mover o status pelo próprio painel.

---

## 4. Verificação sem navegador (opcional, PowerShell)

Confirma que o pedido foi realmente gravado no PostgreSQL:

```powershell
cd C:\Users\<usuario>\OneDrive\Documentos\Cardapio_Digital\backend
npx tsx -e "import{PrismaClient}from'@prisma/client';import{loadDatabaseProfile}from'./src/config/secrets';const p=loadDatabaseProfile('app-dev',{purpose:'runtime'});const c=new PrismaClient({datasources:{db:{url:p.databaseUrl}}});c.order.findMany({select:{orderNumber:true,status:true,totalAmount:true,customerName:true,comanda:{select:{number:true}},items:{select:{productNameSnapshot:true,quantity:true}}},orderBy:{createdAt:'desc'},take:5}).then(r=>{console.log(JSON.stringify(r,null,1));return c.$disconnect()})"
```

---

## 5. Testes automatizados

```powershell
# Frontend — 169 testes (161 herdados + 8 novos de RF004)
cd C:\Users\<usuario>\OneDrive\Documentos\Cardapio_Digital\frontend
npm test

# Backend offline — 1158 passam; 4 falham em tests/scripts/neon-c6-recovery.test.ts
cd C:\Users\<usuario>\OneDrive\Documentos\Cardapio_Digital\backend
npm run test:ci

# Apenas os testes novos desta entrega
npx vitest run tests/scripts/bootstrap-admin-dev.test.ts
```

As 4 falhas de `neon-c6-recovery.test.ts` são **pré-existentes** e não têm relação com
RF004/RF005: elas verificam o texto de scripts de provisionamento Neon (C.6) e falham por
conteúdo de arquivo, não por conexão. Ver a seção "Testes" do relatório da entrega.

---

## 6. Teste E2E de navegador (opcional, escreve no banco de TESTE)

O Playwright do projeto roda contra `cardapio_digital_test` com fixtures sintéticas isoladas e
exige confirmação explícita. Ele **não** usa o administrador criado no passo 1.

```powershell
cd C:\Users\<usuario>\OneDrive\Documentos\Cardapio_Digital\frontend
$env:RUSTIKA_E2E_CONFIRM = "RUN_E2E_ON_CARDAPIO_DIGITAL_TEST"
npx playwright test
```

Isso cria e remove fixtures próprias (admin sintético, comanda reservada, produto sintético).
Não execute sem autorização, pois escreve no PostgreSQL de teste.

---

## 7. Se algo falhar

| Sintoma | Causa provável | Ação |
| --- | --- | --- |
| Botão "Enviar pedido" desabilitado | `VITE_ORDER_SUBMISSION` ausente | Reinicie o Vite com a variável definida |
| "Resgate o convite da comanda" | Sem sessão de comanda válida | Emita novo convite no painel (uso único) |
| 401 `INVALID_INVITATION` | Convite expirado (>10 min) ou já usado | Emita outro convite |
| 401 `ADMIN_UNAUTHENTICATED` | Sessão expirada (1 h) | Faça login novamente |
| 403 `ORIGIN_NOT_ALLOWED` | `CORS_ORIGIN` diferente da origem do navegador | Use exatamente `http://localhost:5173` |
| `A senha só pode ser digitada em um terminal interativo` | Execução sem TTY | Use um PowerShell interativo, sem pipe |
| `Já existe 1 administrador(es)` | Bootstrap já executado | Use o login existente; o script não gerencia usuários |

---

## 8. O que este procedimento NÃO faz

- Não toca no Neon, em homologação ou em produção.
- Não executa seed, migration, `db push`, `DROP`, `RESET` ou `TRUNCATE`.
- Não altera migrations históricas nem checksums.
- Não faz commit, push ou deploy.
- Não altera `PLATAFORMA_SITES_IA`.
- Não cria funcionalidades fora de RF004/RF005 (RF006–RF009 permanecem como estão).
