# Autenticação e sessão legítima de comanda — Entrega 2B

Backend mínimo para administrador → convite → sessão → pedido. Nenhum schema,
permissão ou conta real foi alterado. Testes usam somente Prisma simulado.

## Autenticação compatível com o schema

`Admin.email` é único; `name` não é um usuário de login. O login usa e-mail e senha.
E-mail é normalizado com trim/lowercase no login e no provisionamento; senha não
é normalizada. Não há conta automática ou credencial padrão.

Hash suportado: `scrypt$v1$32768$8$3$<sal hex de 16 bytes>$<hash hex de 64 bytes>`.
Usa scrypt nativo do Node, sal aleatório e comparação `timingSafeEqual`. Conta
inexistente/hash não suportado executa verificação de custo equivalente. Não há
fallback para senha em texto puro ou conversão automática de hashes antigos.

O schema não tem sessão administrativa. A implementação mínima usa tokens
aleatórios de 32 bytes, com somente seus hashes mantidos em memória por **uma
hora**, junto ao ID e versão (`updatedAt`) do administrador. Cada acesso protegido
reconsulta conta ativa e versão. Logout, expiração, alteração do cadastro/senha
ou desativação invalidam o acesso. Login com cookie anterior substitui esse token.

**Limite de implantação:** uma instância do backend. Reinício encerra os logins;
múltiplas instâncias exigirão um store compartilhado aprovado. A sessão de comanda
do cliente permanece persistida no modelo existente, com prazo de oito horas.

## Regras HTTP

Todos os endpoints retornam `Cache-Control: no-store`. POSTs exigem:

```http
Origin: http://localhost:5173
Content-Type: application/json
X-Rustika-Request: 1
```

Origin deve coincidir exatamente com `CORS_ORIGIN`. No navegador, usar
`credentials: 'include'`; o navegador envia Origin/Cookie. Origem validada, JSON
e header customizado protegem as escritas por cookie contra requisições cross-site
simples. Corpo máximo de 4 KiB; campos desconhecidos e query strings são recusados.
Não colocar tokens em URLs ou logs.

Cookies são `HttpOnly`; Secure é ativado em produção ou quando a origem configurada
usa HTTPS. Produção requer HTTPS. Frontend e API devem ter configuração compatível
com SameSite (mesmo site). Em desenvolvimento, usar o mesmo hostname nas duas
portas, por exemplo localhost.

## Endpoints

| Método/caminho | Entrada | Resultado |
| --- | --- | --- |
| `POST /api/admin/auth/login` | `{ "email": "<email>", "password": "<senha>" }` | 200, administrador público/expiração e cookie administrativo. |
| `GET /api/admin/auth/session` | Cookie administrativo | 200, administrador público/expiração; 401 se inválido. |
| `POST /api/admin/auth/logout` | `{}` e cookie, se presente | 204, revoga token no servidor e limpa cookie. Idempotente, com proteção de origem obrigatória. |
| `POST /api/admin/comanda-invitations` | `{ "comandaNumber": "000123", "expiresInMinutes": 10 }` + cookie administrativo | 201, comanda pública, convite de uso único e expiração. |
| `POST /api/comanda-sessions` | `{ "inviteToken": "<convite>" }` | 201, comanda pública/expiração e cookie do cliente. |
| `GET /api/comanda-sessions/current` | Cookie do cliente | 200, comanda pública/expiração; 401 se sessão inválida. |

Login retorna `{ "success": true, "data": { "admin": { "id": "...", "name": "...", "email": "..." }, "expiresAt": "<ISO>" } }`.
O token só é entregue no cookie `rustika_admin`, com `SameSite=Strict`,
`Path=/api/admin` e prazo de uma hora. Logout não revoga sessões de clientes:
são sessões independentes. Não há telas administrativas nesta entrega.

## Emissão mínima de convite

O administrador é autenticado antes de aceitar parâmetros e novamente dentro
da transação. Comanda: string de 1–6 dígitos, sem trim, preservando zeros.
Validade opcional: inteiro de 1–30 minutos; padrão 10.

Uma transação identifica ou cadastra a comanda pelo número e cria o convite.
Comanda existente deve estar OPEN e sem data de fechamento; não é reaberta.
O número tem unicidade global no schema e esta entrega não altera sua reutilização.

```json
{
  "success": true,
  "data": {
    "comanda": { "number": "000123" },
    "inviteToken": "<32 bytes aleatórios codificados em hex>",
    "expiresAt": "<ISO 8601>"
  }
}
```

O segredo é apresentado somente nessa resposta protegida; armazenar apenas seu
SHA-256 e vínculo com o administrador emissor. Entregar ao cliente por canal
controlado, sem query string. Não há endpoint de recuperação do token. Uma
comanda pode ter convites distintos, mas cada convite gera no máximo uma sessão.
Resposta perdida não deve provocar nova emissão automática.

## Resgate atômico

O endpoint público valida token, prazo, não consumo, não revogação, emissor ativo
e comanda aberta. Em transação Serializable, um `updateMany` condicional marca
consumo somente se ainda elegível. Apenas `count=1` permite criar a sessão.
Consumo e criação confirmam juntos; unicidade de `invitationId` também impede
duas sessões por convite. Conflitos serializáveis têm até três tentativas totais;
falhas genéricas/commit não são repetidas cegamente.

Sucesso:

```json
{
  "success": true,
  "data": {
    "comanda": { "number": "000123", "status": "OPEN" },
    "expiresAt": "<ISO 8601>"
  }
}
```

Cookie: `rustika_session=<novo segredo aleatório de 32 bytes em hex>`, com
`HttpOnly; SameSite=Lax; Path=/api`, prazo de oito horas e Secure quando aplicável.
O JSON não contém token de sessão, hash, IDs de sessão/convite. Cookie só é emitido
depois do retorno bem-sucedido da transação. Reutilização de convite retorna 401,
sem devolver segredo anterior.

Após resposta perdida, consultar `/api/comanda-sessions/current`. Se o cookie não
chegou ao navegador, obter outro convite; não existe replay que revele o segredo.

## Compatibilidade com pedidos

Nome/formato/hash do cookie correspondem exatamente a `orderSession.ts`.
`POST /api/orders` segue o mesmo contrato de escrita destas rotas
(`Origin` exato, `X-Rustika-Request: 1`, JSON; guarda única em
`src/security/writeGuard.ts`), mais `Idempotency-Key` UUID v4 e
`credentials: 'include'`, conforme [orders-api.md](orders-api.md). O corpo mantém
identificação do cliente e preços esperados para confirmação da revisão.

## Limites e erros

- Login: 10 tentativas/IP/15 minutos e até quatro verificações scrypt simultâneas.
- Resgate: 30 tentativas/IP/5 minutos. Emissão: 60 solicitações/IP/5 minutos.
- Stores de limite têm capacidade de 10000 entradas com expiração; com a capacidade
  cheia, a entrada mais antiga é descartada e o cliente novo é atendido (até a
  versão anterior, toda chave nova recebia 429). Toda recusa traz `Retry-After`. Sessões
  administrativas têm capacidade de 1000 entradas não expiradas. Limites são por
  processo e não substituem proteção de infraestrutura em implantação distribuída.
- `trust proxy` não foi alterado; headers enviados pelo cliente não definem IP.
- Erros não registram senha, tokens, hashes ou detalhes do driver no middleware.

Envelope: `{ "success": false, "error": { "code": "...", "message": "..." } }`.

| HTTP | Código |
| --- | --- |
| 400 | `INVALID_INPUT` |
| 401 | `INVALID_CREDENTIALS`, `ADMIN_UNAUTHENTICATED`, `INVALID_INVITATION`, `INVALID_SESSION` |
| 403 | `ORIGIN_NOT_ALLOWED` |
| 409 | `COMANDA_CLOSED`, `ACCESS_CONFLICT` |
| 413 | `BODY_TOO_LARGE` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` |
| 429 | `TOO_MANY_REQUESTS` |
| 500 | `INTERNAL_ERROR` |
| 503 | `ACCESS_UNAVAILABLE`, `AUTH_UNAVAILABLE` |

Convite inexistente, expirado, consumido, revogado ou inelegível usa a mesma
mensagem. Credenciais incorretas e conta inativa também usam mensagem genérica.

## Bloqueios externos restantes

1. Primeiro administrador provisionado separadamente com aprovação humana:
   [admin-provisioning.md](admin-provisioning.md).
2. Schema aplicado e permissões verificadas/aprovadas. O fluxo lê Admin,
   lê/cria Comanda, lê/cria/consome Convite e lê/cria Sessão. A migration existente
   revoga acessos da aplicação nessas tabelas; aplicá-la sozinha não habilita isso.
3. Catálogo disponível e permissões de persistência de pedidos da Entrega 2A.
4. Configuração HTTPS/CORS/cookies de produção. As telas de login, emissão,
   resgate e envio estão ligadas ao frontend (`#admin` e carrinho), com envio de
   pedido desligado por padrão; o fluxo administrativo foi validado no Dev em 14/11/2026.

Não houve acesso ao PostgreSQL nem alterações de permissões/contas. Testes com
doubles, inclusive resgates concorrentes e falhas transacionais, não comprovam
isolamento ou rollback do banco real.
