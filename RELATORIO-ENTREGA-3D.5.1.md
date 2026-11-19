# RELATÓRIO DE ENTREGA — ETAPA 3D.5.1
Diagnóstico de prontidão para piloto operacional (somente análise e planejamento; arquivo local, não commitado)

**Método.** Leitura de código e de relatórios anteriores (3D.2.x, 3D.3.x, 3D.4.2 a 3D.4.2-D). Nenhum banco, migration, seed, Playwright, deploy, conta, commit ou push foi executado. Legenda de evidência usada em todo o documento:
**[CÓDIGO]** confirmado no código lido · **[CI]** comprovado em execução de CI (informado pelo usuário) · **[PARCIAL]** parcialmente implementado · **[N/V]** não validado · **[DECISÃO]** pendente de decisão do responsável.

---

## 1. Resumo executivo
O sistema está **tecnicamente avançado para um ambiente de desenvolvimento**, mas **não está pronto para um piloto com clientes reais**. O fluxo central (convite de comanda → pedido → painel de pedidos → disponibilidade de produtos) existe e tem testes; o CI A/B/C passou para a jornada de pedido e para a de disponibilidade **[CI]**. Os bloqueios para o piloto não são de funcionalidade de cardápio, e sim de **operação**: (a) não existe caminho para criar um banco novo de homologação/produção (perfis e migrations são presos a `cardapio_digital_test|dev` e a papéis locais); (b) não há hospedagem, HTTPS, domínio nem variáveis de ambiente de produção; (c) a equipe não é avisada de pedidos novos (polling de 10 s, sem aviso sonoro); (d) sessões administrativas e rate limit vivem na memória de um único processo; (e) não há observabilidade (logs só em `console`, `/health` não verifica o banco); (f) o catálogo real começa 100 % `UNKNOWN` e exige confirmação manual item a item; (g) risco residual conhecido de credenciais locais fracas/compartilhadas.
**Recomendação:** não iniciar o piloto agora. Próxima implementação (seção 19): **preparação de um banco novo e reprodutível para homologação (perfil de ambiente + procedimento de bootstrap + provisionamento do primeiro admin)**, pois destrava todas as demais frentes. Estimativa de prontidão: 4–6 etapas pequenas até uma homologação fechada.

## 2. Estado atual
| Item | Estado |
|---|---|
| Pilha | React/TS/Vite · Node/Express/TS · Prisma 6.19.3 · PostgreSQL 18 **[CÓDIGO]** |
| Repositório original | HEAD `3b857ad`, índice vazio, sem remoto, 82 refs **[CÓDIGO]** |
| Snapshot sanitizado | `main` = remoto privado = `5ef3643`, árvore limpa, 258 arquivos rastreados **[CÓDIGO]** |
| Testes locais (última medição) | Frontend 153/153; backend conforme relatórios 3D.4.2 **[CI/relatório]** |
| CI | Workflow manual (`workflow_dispatch`) com jobs backend/frontend/e2e/integração/Playwright **[CÓDIGO]**; Playwright de disponibilidade passou, 2 pedidos sintéticos, resíduo zero **[CI, informado]** |
| Migrations | 7 (`EXPECTED_MIGRATIONS`), a 7ª concede `UPDATE(availability_state, updated_at)` ao papel de runtime **[CÓDIGO]** |
| Implantação | Nenhum Dockerfile, nenhum script de deploy, nenhum workflow de deploy **[CÓDIGO]** |
| Funcionalidade de IA | Fora do escopo desta etapa |

## 3. Matriz funcional
Critério: "VALIDADA" só quando há teste automatizado de comportamento **e** prova em CI; código existente não basta.

| Funcionalidade | Classificação | Evidência / limitação |
|---|---|---|
| Catálogo público: categorias, produtos, preço, descrição | IMPLEMENTADA COM LIMITAÇÕES | Rotas e mapper **[CÓDIGO]**; filtro por categoria no cliente (`Catalog.tsx`); **sem busca textual pública** (a busca existe só no admin) |
| Imagens de produto | PARCIAL | `ProductCard` trata `imageUrl` e falha de carregamento **[CÓDIGO]**; catálogo real sem imagens confirmadas **[N/V]** |
| Disponibilidade no catálogo | IMPLEMENTADA E VALIDADA | `publicProductWhere` + E2E de disponibilidade **[CI]** |
| Tratamento de erro da API no catálogo | IMPLEMENTADA COM LIMITAÇÕES | `ConnectionIndicator`/`CatalogStatus` **[CÓDIGO]**; sem retentativa automática comprovada **[N/V]** |
| Carrinho (adicionar/remover/quantidade) | IMPLEMENTADA E VALIDADA | testes `cart` + jornada **[CI]** |
| Revisão, validação de comanda, envio | IMPLEMENTADA E VALIDADA | jornada com 2 pedidos **[CI]** |
| Produto indisponível no envio | IMPLEMENTADA E VALIDADA | `PRODUCT_UNAVAILABLE`, sem pedido parcial **[CI]** |
| Divergência de preço | IMPLEMENTADA COM LIMITAÇÕES | preço é lido do servidor no envio **[CÓDIGO]**; aviso ao cliente de preço alterado **[N/V]** |
| Recuperação de erro sem duplicar pedido | PARCIAL | idempotência por sessão/serialização **[CÓDIGO]**; retry após perda de rede no cliente **[N/V]** |
| Login/logout admin, sessão | IMPLEMENTADA E VALIDADA (1 instância) | corrida de login corrigida e provada **[CI]**; sessões em memória, 1 h |
| Gestão de produtos/disponibilidade | IMPLEMENTADA E VALIDADA | **[CI]** |
| Convites de comanda | IMPLEMENTADA COM LIMITAÇÕES | expiração padrão 10 min **[CÓDIGO]**; **não há tela de abertura/fechamento de comanda no admin** (comanda tem `status/closedAt`, mas nenhuma rota de fechamento foi encontrada) **[N/V]** |
| Painel de pedidos e transições de status | IMPLEMENTADA E VALIDADA | **[CI]**; teto de 100 pedidos ativos, sem histórico na UI |
| Conflitos de concorrência | IMPLEMENTADA E VALIDADA | CAS/Serializable com testes **[CÓDIGO]** |
| Atualização periódica | IMPLEMENTADA COM LIMITAÇÕES | 10 s (`ORDERS_POLL_INTERVAL_MS`), sem alerta sonoro/visual de pedido novo |
| Acompanhamento do pedido pelo cliente | FORA DO ESCOPO DO PILOTO (decisão sugerida) | `trackingTokenHash` reservado e não usado **[CÓDIGO]** |
| Histórico/relatórios de pedidos | PENDENTE | só no banco |
| Pagamento online | FORA DO ESCOPO DO PILOTO | não existe |
| Impressão de comanda/cozinha | PENDENTE **[DECISÃO]** | não existe |
| Redefinição de senha / múltiplos admins | PARCIAL | `admin-provisioning.md` documenta; sem ferramenta |

## 4. Diagnóstico do catálogo real
- Histórico: **204** produtos importados; **174** classificados como públicos/candidatos de exibição (144 públicos + 30 inativos conforme relatórios 3D.2.x), **24 internos**, **6 incertos**, 168 candidatos a publicação **[relatórios 3D.2.x; reconciliar com o banco é N/V]**. Os números históricos e os artefatos (`backend/data/Exportacao-produtos.xlsx`) **não foram reconferidos** nesta etapa por não haver acesso ao banco.
- Categorias: 12 chaves públicas em `CATEGORY_PUBLIC_KEYS` **[CÓDIGO]**.
- Particularidades: itens INSUMO/internos fora da publicação; preços simbólicos; produtos sem `publicKey`; estado `UNKNOWN` — todos exigem decisão humana.
- **Todo produto começa `UNKNOWN`** e o servidor só aceita `AVAILABLE` **[CÓDIGO]**: sem trabalho manual, o cardápio de homologação não vende nada.
- O administrador precisa confirmar manualmente: disponibilidade de cada item que será ofertado; os 6 incertos e os 24 internos; preços simbólicos; descrições e imagens.
- Proibido nesta etapa e no piloto sem nova autorização: reimportar, alterar preços em massa, marcar disponibilidade em lote, excluir produtos.
- **Lacuna:** a UI de disponibilidade é item a item; para ~150 itens isso é aceitável uma vez, mas é a principal tarefa operacional pré-piloto (**[DECISÃO]**: reduzir o cardápio piloto a um subconjunto, p.ex. 30–60 itens).

## 5. Segurança
Pontos fortes **[CÓDIGO]**: cookie admin `rustika_admin` HttpOnly, SameSite=Strict, Path=/api/admin, 1 h; cookie de comanda `rustika_session` 8 h; `writeGuard` (Origin exata, `X-Rustika-Request: 1`, JSON); rate limit por rota; `/api/admin` recusa query string; limite de corpo (4 KiB acesso, 16 KiB pedido); revogação e expiração de convites/sessões de comanda; admin desativado perde acesso; validação de entrada em domínio; segredos lidos de arquivos, não do repositório.
Lacunas:
- Sessões admin e rate limit **em memória por processo**: reinício = todos deslogados e limites zerados; mais de uma instância = comportamento inconsistente. Alternativas (não implementar): (1) manter 1 instância no piloto e documentar (menor esforço, recomendada); (2) tabela de sessões no PostgreSQL (reaproveita a infraestrutura; a comanda já faz isso); (3) Redis/Upstash (nova dependência e custo); (4) JWT (revogação difícil). **[DECISÃO]**
- Atrás de proxy, sem `trust proxy` e sem confiar em cabeçalhos de encaminhamento, **todos os clientes parecem ter o IP do proxy**: o rate limit por origem passaria a limitar o conjunto inteiro **[CÓDIGO]**.
- Sem `helmet`/cabeçalhos de segurança (CSP, HSTS, X-Content-Type-Options) no backend; precisam vir do host estático ou de middleware **[CÓDIGO]**.
- Flag `Secure` do cookie depende da configuração do ambiente; validar sob HTTPS **[N/V]**.
- CORS configurado em `app.ts`; origem de produção precisa ser definida por ambiente **[N/V]**.
- **Risco residual conhecido:** credenciais locais fracas/compartilhadas de desenvolvimento. Não foram exibidas nem alteradas. **Nenhuma credencial antiga pode ser usada em homologação ou produção**; novas devem ser geradas no cofre do provedor.
- Erros: respostas padronizadas por `AppError`; vazamento de detalhes internos em erros inesperados **[N/V]** (revisar handler final).

## 6. PostgreSQL
- Esquema: Admin, Category, Product (`availabilityState`), Order, OrderItem, OrderStatusHistory, Comanda, ComandaInvitation, ComandaSession; índices em `status+createdAt`, `sessionId+createdAt+id`, `isActive+availabilityState`, FKs indexadas **[CÓDIGO]**. Para o volume do piloto (dezenas/centenas de pedidos por dia) os índices são suficientes.
- Isolamento: Serializable em pedido e disponibilidade, com retentativa P2034 ≤ 2 **[CÓDIGO]**; privilégios mínimos por coluna ao papel de runtime **[CÓDIGO]**.
- **Bloqueio P0:** `DB_PROFILE` aceita só `app-dev`/`app-test`; as migrations 5–7 recusam bancos que não sejam `cardapio_digital_test|dev`, exigem o papel `cardapio_migrator` e PG ≥ 17 **[CÓDIGO]**. Não há perfil/URL de homologação nem de produção.
- Procedimento para banco novo e vazio (a ser **implementado e documentado**, não executado): criar banco e dois papéis (migrator, runtime) no provedor; `prisma migrate deploy` (nunca `db push`/`migrate reset`) com o migrator; conferir `EXPECTED_MIGRATIONS` e ACLs; criar primeiro admin; importar apenas o catálogo revisado por rota autorizada (**sem** reutilizar o seed local). Pré-condição: relaxar as guardas das migrations de forma controlada (lista explícita de nomes de banco por ambiente), o que **altera migrations já com SHA registrado** — exige decisão (alternativa: nova migration de guarda parametrizada ou ajuste do executor).
- Backup/restauração: existe plano documentado e dump de teste (`restore-backup.md`), com restauração **nunca executada** — "legível não significa restaurável" **[N/V]**. Para o piloto: backup automático diário do provedor + `pg_dump` pré-implantação e **um teste de restauração antes do piloto**.

## 7. Infraestrutura
Estado: nenhum artefato de implantação **[CÓDIGO]**. Requisitos do MVP: 1 processo Node, 1 PostgreSQL gerenciado, frontend estático, HTTPS com domínio, região Brasil/baixa latência, variáveis e segredos fora do repositório, health check, logs, backup, deploy e rollback.
Comparação de alternativas (sem escolha definitiva; **preços não informados — dependem de consulta externa atual**):
| Opção | Prós | Contras |
|---|---|---|
| A. PaaS para app + PostgreSQL gerenciado (ex.: Render, Railway, Fly.io) | deploy simples, HTTPS automático, rollback por release | região no Brasil nem sempre disponível; latência e LGPD (transferência internacional) a avaliar |
| B. Frontend estático em CDN + backend em PaaS | frontend barato/rápido | duas origens: CORS e cookies SameSite=Strict exigem mesmo site (mesmo domínio registrável) |
| C. VPS no Brasil (Docker + Caddy/Nginx) + PostgreSQL gerenciado ou na VM | controle, região BR, custo previsível | manutenção, patches e backup por conta própria |
| D. Plataforma com Postgres + Auth gerenciados (ex.: Supabase) | banco e backup prontos | o backend atual usa Prisma e auth próprio; adotar a Auth do provedor seria mudança de escopo |
Recomendação preliminar **[DECISÃO]**: opção A ou C com **frontend e API sob o mesmo domínio registrável** (necessário para `SameSite=Strict` e cookies HttpOnly), uma única instância do backend e backup gerenciado. Antes de decidir: consultar preços atuais, região disponível, SLA e política de retenção de backup.

## 8. Fluxo operacional (jornada de 12 passos)
1 Admin abre a comanda · 2 gera convite · 3 cliente resgata (QR/link) · 4 navega · 5 monta o carrinho · 6 revisa · 7 envia · 8 equipe vê o pedido · 9 muda para preparo · 10 pronto · 11 entrega · 12 encerra a comanda/pagamento no balcão.
Lacunas:
- **P0 operacional:** passo 8 depende de a equipe olhar a tela (10 s de polling, sem som, sem contador de novos, sem indicador de conexão no painel) **[CÓDIGO]**.
- Passo 1 e 12: **não há abertura/fechamento de comanda no painel** nem rota de fechamento encontrada **[N/V]**; hoje depende de banco/script.
- Multi-equipe: dois atendentes podem alterar o mesmo pedido; o CAS evita conflito silencioso e informa conflito **[CÓDIGO]**.
- Falha de rede do cliente: o pedido pode ter sido gravado sem o cliente saber; sem rastreamento, ele pode reenviar **[PARCIAL]**.
- Reinício do backend: pedidos persistem; sessões admin caem (relogin); sessões de comanda persistem (banco).
- Sessão admin expirada durante o turno: o painel precisa tratar 401 com mensagem clara **[N/V]**.
- Duplicidade: pedidos idênticos seguidos são aceitos como distintos (não há chave de idempotência do cliente) **[N/V]**.
- Cancelamento não notifica o cliente (documentado).

## 9. UX (sem redesenho; identidade visual preservada)
Pontos observados: carrinho abre em modo edição quando a comanda ainda não foi restaurada após recarregar (aspereza registrada na 3D.4.2-D); sem busca pública; 64 usos de `aria-*`/`role` indicam preocupação com acessibilidade, mas **sem auditoria** de contraste/teclado/leitor de tela **[N/V]**; testes de responsividade só estáticos/SSR. Sugestões proporcionais: sincronizar o estado de edição do carrinho com a restauração; mensagens de erro de rede com ação "tentar de novo"; teste manual em 2–3 celulares reais antes do piloto.

## 10. Desempenho e confiabilidade
- Admin lista até 500 produtos (`truncated`); pedidos ativos até 100; catálogo público paginado em 30 **[CÓDIGO]**. Suficiente para o piloto.
- Polling de 10 s por painel aberto: com 3–5 painéis, carga desprezível; rate limit admin de 120 req/min por origem comporta 1 painel (6 req/min) com folga.
- Memória: sessões em `Map` pequeno; sem vazamento evidente **[N/V]**.
- Pool de conexões Prisma: limite precisa casar com o plano do banco gerenciado **[N/V]**.
- Testes de carga propostos (não executados; contra ambiente descartável de homologação, nunca o PostgreSQL local): 20 clientes simultâneos montando pedidos; 5 painéis em polling; rajada de 30 pedidos/min; verificação de p95 < 500 ms e zero erros 5xx.

## 11. Observabilidade
**[CÓDIGO]** logs apenas por `console` em `server.ts`; `/health` estático **sem verificar o banco**; sem IDs de correlação; sem métricas; sem alertas. Mínimo para o piloto: log estruturado (JSON) com `requestId`, nível e rota, sem dados pessoais; `/health` e `/ready` (com `SELECT 1`); monitor de disponibilidade externo; alerta por e-mail; registro de erros 5xx. Ferramenta específica **[DECISÃO]**.

## 12. Privacidade (LGPD)
Dados tratados: `customerName`, `customerPhone` (se coletado), `notes`, sessões e convites **[CÓDIGO]**. Ausentes: política de retenção/descarte, aviso de privacidade no checkout, base legal registrada, canal do titular, política de logs. **Não** foram redigidos documentos jurídicos (fora do escopo): é necessário validar com responsável/jurídico. Medidas técnicas propostas: coletar o mínimo (nome ou apelido; telefone opcional); definir retenção (ex.: anonimizar após N dias); não registrar PII em logs; backups cifrados; hospedagem com avaliação de transferência internacional.

## 13. Riscos P0 / P1 / P2
Esforço: B baixo · M médio · A alto. Probabilidade: A/M/B.

**P0 — impedem o piloto**
| ID | Descrição | Evidência | Impacto | Prob. | Solução | Dependências | Esforço |
|---|---|---|---|---|---|---|---|
| P0-1 | Não há caminho para banco novo (perfil, guardas de migration presas a test/dev e papéis locais) | `env.ts`/`secrets.ts` só `app-dev/app-test`; migrations 5–7 | Impossível criar homologação | A | Perfil por ambiente + bootstrap documentado/testado offline | decisão de hospedagem parcial | M |
| P0-2 | Sem provisionamento do primeiro admin | `admin-provisioning.md` (só documento) | Ninguém entra no painel | A | CLI/rota de bootstrap segura e idempotente | P0-1 | B–M |
| P0-3 | Sem hospedagem, HTTPS, domínio, variáveis e segredos de produção | nenhum Dockerfile/deploy | Nada acessível ao público | A | Escolher provedor, definir mesmo domínio, gestão de segredos | decisão do dono | M |
| P0-4 | Equipe não é alertada de pedido novo | polling 10 s, sem som/contador | Pedidos esquecidos, atendimento lento | A | Indicador/som/título da aba para novos pedidos | — | B |
| P0-5 | Catálogo real 100 % `UNKNOWN`; nada vendável | regra do serviço de pedido | Cardápio vazio | A | Subconjunto piloto + confirmação manual guiada | decisão de cardápio | M |
| P0-6 | Credenciais locais fracas/compartilhadas | risco residual conhecido | Se reaproveitadas, acesso indevido | M | Novas credenciais por ambiente, nenhuma reutilização | P0-1 | B |
| P0-7 | Sem abertura/fechamento de comanda no painel | rotas só de convite | Operação depende de banco | M | Rotas e tela mínimas, com testes | — | M |
| P0-8 | Restauração de backup nunca provada | `restore-backup.md` "plano preparado" | Perda de dados sem recuperação | M | Teste de restauração em banco descartável antes do piloto | P0-1 | B–M |

**P1 — necessários antes de ampliar o piloto**
| ID | Descrição | Impacto | Solução | Esforço |
|---|---|---|---|---|
| P1-1 | Rate limit por IP atrás de proxy (sem `trust proxy`) | todos compartilham o limite | `trust proxy` por ambiente, testado | B |
| P1-2 | Sessões admin em memória | relogin a cada reinício; 1 instância | manter 1 instância no piloto; depois tabela de sessões | M |
| P1-3 | `/health` sem banco; logs sem estrutura | falha invisível | `/ready` + log JSON + monitor externo | M |
| P1-4 | Sem cabeçalhos de segurança | superfície XSS/clickjacking | helmet/headers no host | B |
| P1-5 | Sem retenção/aviso LGPD | risco legal | política validada por jurídico | M |
| P1-6 | Cliente sem confirmação/estado do pedido | cliente reenvia ou pergunta ao garçom | tela de confirmação com número do pedido | B–M |
| P1-7 | Reenvio duplicado após falha de rede | pedido em dobro | chave de idempotência no envio | M |
| P1-8 | Sem histórico de pedidos na UI | conferência de caixa difícil | lista de finalizados do dia | M |
| P1-9 | Scripts legados no `backend/` (seed, dumpers, `update-hba`, cópias "Calil-Notebook") | risco de execução indevida | isolar/arquivar fora do pacote implantado | B |

**P2 — melhorias**
Busca pública no cardápio; auditoria de acessibilidade; impressão de pedidos; notificação ao cliente; paginação/filtros do admin; métricas e painel; testes de carga automatizados; imagens otimizadas; redefinição de senha; múltiplos perfis de acesso.

## 14. Requisitos para homologação
Banco novo e vazio com migrations aplicadas; dois papéis; primeiro admin com credencial nova; backend em HTTPS com mesmo domínio do frontend; `VITE_API_URL`, CORS e cookies `Secure` verificados; catálogo piloto revisado e disponibilidades confirmadas; `/ready` ok; backup e restauração testados; jornada Playwright adaptada executada **contra homologação com dados sintéticos** e resíduo zero; checklist de segurança (seção 5) aprovado; responsável legal informado (LGPD).

## 15. Escopo do piloto controlado
Um estabelecimento, 1–2 atendentes e 1 administrador, 5–10 mesas/comandas, janela curta (ex.: 1 turno), cardápio reduzido e revisado, homologação separada do piloto, **contingência manual sempre disponível** (comanda em papel). Fora do escopo: pagamento online, rastreamento pelo cliente, relatórios, múltiplos estabelecimentos, abertura ao público geral.
Critérios de **sucesso**: ≥ 95 % dos pedidos vistos pela equipe em < 1 min; zero pedidos perdidos ou duplicados; zero incidentes de segurança; produtos indisponíveis nunca vendidos; satisfação da equipe. Critérios de **parada imediata**: pedido perdido, vazamento de dados, indisponibilidade > 10 min no horário de serviço, divergência de preço, qualquer acesso não autorizado.

## 16. Critérios de entrada e saída
**Entrada:** seção 14 integralmente cumprida; P0 todos fechados; ensaio geral com a equipe sem clientes; plano de contingência impresso; responsável designado por turno.
**Saída:** relatório do piloto com métricas da seção 15, lista de incidentes, decisão formal (ampliar/ajustar/encerrar) e backup final.

## 17. Plano de contingência
Queda do sistema: voltar ao atendimento manual por comanda em papel; avisar clientes por QR/aviso na mesa. Pedido duvidoso: confirmar verbalmente. Backend reiniciado: relogin do admin; clientes mantêm sessão. Banco indisponível: manter papel, abrir incidente com o provedor, restaurar do backup se necessário. Incidente de segurança: desativar admins, revogar convites e sessões, trocar segredos, comunicar o responsável. Decisão de parada: o responsável do turno pode interromper sem aprovação adicional.

## 18. Próximas etapas (ordem por dependência)
1. **3D.5.2** — Preparação de ambiente novo: perfil de ambiente, bootstrap de banco, primeiro admin (P0-1, P0-2, P0-6).
2. 3D.5.3 — Alerta de novos pedidos e fechamento/abertura de comanda no painel (P0-4, P0-7).
3. 3D.5.4 — Observabilidade mínima, `/ready`, `trust proxy`, cabeçalhos (P1-1, P1-3, P1-4).
4. 3D.5.5 — Decisão e preparação de hospedagem/domínio/HTTPS, com autorização (P0-3).
5. 3D.5.6 — Backup/restauração provados e catálogo piloto revisado (P0-5, P0-8).
6. 3D.5.7 — Homologação com Playwright sintético, ensaio com a equipe, LGPD mínima.

## 19. Próxima implementação prioritária (NÃO implementar nesta etapa)
**3D.5.2 — Ambiente novo reproduzível e primeiro admin.**
- **Objetivo:** permitir criar, com segurança e de forma repetível, um banco novo de homologação e o primeiro administrador, sem tocar no PostgreSQL local.
- **Escopo:** perfil de ambiente `homolog` (conexão por variável/arquivo de segredo fora do repositório); parametrização controlada das guardas de migration por ambiente; script de bootstrap *offline-first* (validação sem conexão + execução apenas com autorização); CLI de criação do primeiro admin (senha gerada e entregue por canal seguro, nunca em log); documentação do procedimento e checklist.
- **Arquivos prováveis:** `backend/src/config/env.ts`, `secrets.ts`, `lib/prisma.ts`, `scripts/prisma-run-policy.ts`, `scripts/bootstrap-environment.ts` (novo), `scripts/create-first-admin.ts` (novo), migrations 5–7 ou migration de guarda (decisão), `docs/environment-bootstrap.md`, `.env.example`, testes em `backend/tests`.
- **Contratos:** variáveis (`DB_PROFILE=homolog`, `DATABASE_URL` via segredo), lista de bancos permitidos por ambiente, `EXPECTED_MIGRATIONS` e SHA inalterados se possível, `PERMISSIONS_SQL` estrito.
- **Testes:** unitários de validação de perfil e guardas (recusar produção sem flag explícita), parser SQL offline das migrations, teste de que scripts legados não são acionados, varredura de segredos.
- **Critérios de aceite:** nenhum segredo no repositório; procedimento documentado reproduzível; recusa de perfis desconhecidos; migrations antigas continuam válidas para test/dev; relatório sem executar nada contra bancos reais.
- **Riscos:** alterar migrations com SHA registrado (preferir nova camada de guarda); confundir ambientes; vazamento de senha do admin.
- **Autorizações necessárias:** modificar código de configuração e migrations; (execução real somente numa etapa posterior, com autorização própria).
- Esta etapa **não** escolhe nem contrata hospedagem.

## 20. Arquivos e contratos envolvidos (mapa)
Backend: `src/app.ts`, `server.ts`, `config/env.ts`, `config/secrets.ts`, `lib/prisma.ts`, `routes/{health,access,order,catalog}.routes.ts`, `security/{adminSessions,accessLimits}.ts`, `services/{order,orderOperations,productAvailability,comandaAccess,adminAuth}.service.ts`, `domain/{rules,orderInput,categoryPublication,contracts}.ts`, `prisma/schema.prisma` + 7 migrations, `docs/*`. Frontend: `pages/{AdminOrders,AdminProducts,AdminLogin}.tsx`, `components/{Catalog,ProductCard,CartDrawer,ConnectionIndicator}.tsx`, `services/{api,adminOrders,adminProducts}.ts`, variáveis `VITE_API_URL`, `VITE_ORDER_SUBMISSION`, `VITE_CATALOG_MODE`. CI: `.github/workflows/ci.yml`. Contratos críticos: cookies, `writeGuard`, query string proibida em `/api/admin`, `EXPECTED_MIGRATIONS` (7), ACLs por coluna.

## 21. Autorizações necessárias (futuras)
Implementar 3D.5.2; escolher e contratar hospedagem/domínio; criar banco e papéis em provedor; executar migrations em banco novo; criar o primeiro admin; importar/confirmar catálogo piloto; rodar Playwright e carga contra homologação; validação jurídica LGPD; alterar migrations existentes (se escolhido); eventual mudança de armazenamento de sessões.

## 22. Estado final dos repositórios
Original: HEAD `3b857ad`, índice vazio, sem remoto, **nenhuma operação Git**; único arquivo criado nesta etapa: este relatório (não commitado). Snapshot: `main` = remoto = `5ef3643`, árvore limpa, sem alterações. Nenhum banco, migration, seed, Playwright, deploy, conta ou credencial foi tocado. Quatro testes sensíveis inalterados.

## Pendências de verificação (itens [N/V] que exigem ambiente ou decisão)
Reconciliação 204/174/30 com o banco; rota/fluxo de fechamento de comanda (não encontrado no código lido); exposição de detalhes em erros inesperados; comportamento do cookie `Secure` sob HTTPS; retry do cliente após queda de rede; acessibilidade e responsividade reais; pool de conexões; restaurabilidade do backup.
