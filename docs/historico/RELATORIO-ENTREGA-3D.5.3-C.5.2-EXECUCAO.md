# RELATÓRIO DE ENTREGA — 3D.5.3-C.5.2 (EXECUÇÃO)
## Resultado real do modo WRITE supervisionado no Neon Free

Data/hora: 2026-11-07T16:28:47Z. **Executado com autorização explícita do proprietário**, no projeto descartável `rustika-homolog-test`. A connection string foi digitada só no terminal local (duas vezes: pré-voo e write), nunca enviada ao chat, nunca gravada em arquivo. Variáveis de ambiente sensíveis removidas ao final de cada execução.

**RESULTADO GERAL: PARCIALMENTE COMPROVADO, COM FALHA E RESÍDUO CRÍTICO.** Nenhuma migration histórica foi executada, `cardapio_digital_homolog` não foi criado, nenhuma role definitiva foi criada, `serverIdentity.ts` não foi alterado, Render e bancos locais não foram tocados, nada foi commitado nem publicado. **O script não foi modificado durante a execução.**

---

## ⚠️ Atenção prioritária: resíduo real no projeto Neon

Ficaram no projeto `rustika-homolog-test`, **neste momento**:
- Banco `zz_probe_4ed63750_db` (dono: a role abaixo).
- Role `zz_probe_4ed63750_role_b`.
- Uma membership ativa: `neondb_owner` tem `SET TRUE, INHERIT FALSE` sobre `zz_probe_4ed63750_role_b` (ainda não revogada).

Nenhum outro objeto preexistente foi tocado (`INVENTARIO_DEPOIS_IGUAL_ANTES = COMPROVADO` para tudo que não é `zz_probe_*`). **Não tentei nenhuma limpeza manual** — a instrução desta etapa proíbe explicitamente "executar DROP manual fora do procedimento auditado", e o script, por desenho, também se recusa a isso (só remove nomes com o prefixo desta execução, nunca improvisa). Proponho, na seção "Pendências", um procedimento de limpeza mínimo e auditável, mas **não o executei** — aguardo autorização específica.

## 1. Resultado do novo pré-voo (antes do write)

Código de saída: **0**. Repetiu e confirmou tudo que já constava no pré-voo anterior (TLS externo, identidade, projeto, Prisma, ausência de `zz_probe_*`, inventário). Cópia completa em `RELATORIO-ENTREGA-3D.5.3-C.5.2.md` (seção já registrada) — não repetida aqui por já estar documentada.

## 2. Resultado de cada operação administrativa

| Passo | Resultado | Detalhe |
|---|---|---|
| A — `CREATE ROLE ... NOLOGIN` | **COMPROVADO** | atributos corretos; membership automática do criador: `admin=true, inherit=false, set=false` |
| A2 — `CREATE ROLE ... LOGIN CONNECTION LIMIT 2` | **COMPROVADO** | |
| B — `ALTER ROLE RENAME` | **COMPROVADO** | renomeada para `zz_probe_4ed63750_role_b` |
| C — `COMMENT ON ROLE` | **COMPROVADO** | |
| D — leitura do comentário por role sem privilégio | **COMPROVADO** | |
| E — `CREATE DATABASE ... OWNER` **sem** grant | **FALHOU** (esperado) | `42501 must be able to SET ROLE "zz_probe_...role_b"` |
| E2 — `GRANT ... WITH SET TRUE, INHERIT FALSE` | **COMPROVADO** | o comando SQL executou sem erro |
| E2B — verificação de `pg_auth_members` | **FALHOU** (na verificação, não na operação — ver seção 3) | leu `admin=true, inherit=false, set=false` |
| E3 — `CREATE DATABASE ... OWNER` **depois** do grant | **COMPROVADO** | banco criado com dono = role descartável |
| E4 — `REVOKE ALL` / `GRANT CONNECT` no banco descartável | **COMPROVADO** | |
| F — `ALTER DATABASE ... RENAME` | **FALHOU** | `42501 must be owner of database zz_probe_...db` |
| G — revogar a membership temporária | **NÃO TESTADO** | depende de F, que falhou |
| Limpeza automática | **FALHA PARCIAL** | ver resíduo acima |

## 3. Membership efetivo — causa raiz da falha em F (achado real, não previsto na C.5.1)

A verificação `E2B` leu `set_option=false`, mas a operação seguinte (`E3`, `CREATE DATABASE ... OWNER`) **só pode ter sucedido se a habilidade de `SET ROLE` estivesse de fato concedida** — ou seja, a leitura de `E2B` não prova que o `GRANT` falhou; ela indica que minha consulta de verificação leu a linha **errada** de `pg_auth_members`. O PostgreSQL ≥ 16 guarda uma linha de membership **por concedente** (`grantor`): já existia uma linha automática (criada junto com `CREATE ROLE`, `admin=true, inherit=false, set=false`, concedente = o mecanismo interno de criação) e o `GRANT` explícito criou uma **segunda** linha (concedente = `neondb_owner`, com `set=true`). Minha consulta (`SELECT ... [0]`, sem filtrar por `grantor` nem agregar) pegou a linha antiga. **Isto é um defeito do script de ensaio, não do comportamento do Neon** — registrado como pendência de correção (seção "Pendências").

**O achado real e importante**: `F` (`ALTER DATABASE ... RENAME`) falhou mesmo com a membership `SET TRUE, INHERIT FALSE` ativa, enquanto `E3` (`CREATE DATABASE ... OWNER`) teve sucesso com a mesma membership. Isso mostra que as duas operações são governadas por checagens **diferentes** no PostgreSQL:
- `CREATE DATABASE ... OWNER x`: a documentação oficial liga essa operação à **habilidade de `SET ROLE`** (opção `SET`) — confirmado agora empiricamente no Neon: funcionou com `SET TRUE, INHERIT FALSE`.
- `ALTER DATABASE ... RENAME` (um comando que exige **já ser reconhecido como o dono** de um objeto existente, não criar uma nova propriedade): usa a checagem geral de "privilégios do dono" (`has_privs_of_role`), que **segue apenas memberships com `INHERIT`** — por isso falhou sem `INHERIT TRUE`. Fazer `SET ROLE` explícito antes do `RENAME` não resolveria: a role migradora (`cardapio_migrator`) é `NOCREATEDB`, e `ALTER DATABASE RENAME` também exige que quem executa tenha `CREATEDB` — ao trocar de identidade com `SET ROLE`, a sessão perderia esse privilégio.

**Conclusão desta etapa: a decisão da C.5.1 (`SET TRUE, INHERIT FALSE` para os dois scripts de produção) estava incompleta.** `01-grant-set-true-migrator.sql` (usado antes de `02-create-replay-database.sql`) está correto como está — `CREATE DATABASE ... OWNER` só precisa de `SET`. Mas o mesmo grant, do jeito que está, **não é suficiente** para `04-finalize-rename.sql` (`ALTER DATABASE RENAME` + `ALTER ROLE RENAME`) — isso precisa de `INHERIT TRUE` (voltando à combinação originalmente testada na C.3/C.4). **Esta correção NÃO foi aplicada nesta etapa** (fora do escopo autorizado — "não modificar os scripts definitivos nesta etapa"); fica registrada como pendência crítica para a 3D.5.3-C.5.3.

## 4. Ownership antes/depois

- Depois de `E3`: dono de `zz_probe_4ed63750_db` = `zz_probe_4ed63750_role_b`. **COMPROVADO.**
- `F` nunca completou, então o banco **nunca foi renomeado** — ele continua com o nome `zz_probe_4ed63750_db`, não `_db_renamed`.
- Ownership atual (agora, residual): `zz_probe_4ed63750_db` ainda pertence a `zz_probe_4ed63750_role_b`. **COMPROVADO** (e é exatamente por isso que a limpeza automática não conseguiu removê-lo).

## 5. Evidências de limpeza

| Objeto | Resultado |
|---|---|
| `zz_probe_4ed63750_db` | **FALHOU — BLOQUEIO CRÍTICO** (`42501 must be owner of database`) |
| `zz_probe_4ed63750_db_renamed` | COMPROVADO (nunca existiu; a limpeza confirmou isso corretamente) |
| `zz_probe_4ed63750_reader` | **COMPROVADO** (role removida) |
| `zz_probe_4ed63750_role_b` | **FALHOU — BLOQUEIO CRÍTICO** (`2BP01 cannot be dropped because some objects depend on it` — o banco acima) |
| `zz_probe_4ed63750_role_a` | COMPROVADO (nunca existiu com esse nome após o rename bem-sucedido em B; a limpeza confirmou isso corretamente) |

A causa dos dois bloqueios é a mesma: o admin (`neondb_owner`) só tem `SET`-ability (sem `INHERIT`) sobre `zz_probe_4ed63750_role_b`, e `DROP DATABASE` segue a mesma checagem de "privilégios do dono" que `ALTER DATABASE RENAME` — por isso também falha sem `INHERIT`.

## 6. Inventário final

`INVENTARIO_DEPOIS_IGUAL_ANTES = COMPROVADO` — todos os bancos, roles e memberships **preexistentes** (os que já estavam lá antes de qualquer teste) continuam idênticos. O resíduo é exclusivamente dos objetos `zz_probe_4ed63750_*` criados por esta execução — nenhum objeto de fora do prefixo foi afetado.

`REMANESCENTES_zz_probe = {"databases":["zz_probe_4ed63750_db"],"roles":["zz_probe_4ed63750_role_b"]}` — **confirma o resíduo**, exatamente como o script foi desenhado para expor (nunca afirmar limpeza completa sem comprovação).

## 7. Código de saída

**3** (resíduo / limpeza com falha) — conforme o contrato documentado do script.

## 8. Riscos pendentes

- **Residual ativo no Neon** (seção "Atenção prioritária") — risco baixo (projeto descartável, nenhum dado real, role sem privilégios), mas real e precisa de limpeza supervisionada.
- **Bug de verificação em `E2B`** (lê a linha errada de `pg_auth_members` quando há múltiplas linhas por `grantor`) — precisa de correção antes do próximo ensaio de escrita, senão volta a dar falso-negativo.
- **Scripts de produção `ops/homolog/sql/neon/01-02` continuam com `INHERIT FALSE`**, que esta execução mostrou ser **insuficiente** para `04-finalize-rename.sql`. Enquanto não corrigidos, eles **vão falhar** se executados contra o Neon real, exatamente como `F` falhou aqui.
- `docs/neon-homolog.md` §8 cita a mesma decisão agora contestada pela evidência real; precisa de atualização.

## 9. Classificação resumida

| Item | Classificação |
|---|---|
| CREATE ROLE / RENAME / COMMENT / leitura sem privilégio (A–D) | **COMPROVADO NO NEON** |
| `GRANT SET TRUE, INHERIT FALSE` executa sem erro | **COMPROVADO NO NEON** |
| `pg_auth_members` com os três campos lidos corretamente | **PENDENTE** (bug de verificação a corrigir) |
| `CREATE DATABASE ... OWNER` funciona com `SET TRUE, INHERIT FALSE` | **COMPROVADO NO NEON** |
| `ALTER DATABASE RENAME` funciona com `SET TRUE, INHERIT FALSE` | **FALHOU — precisa de `INHERIT TRUE`** |
| `REVOKE` da membership temporária | **NÃO TESTADO** (bloqueado por F) |
| Ausência de resíduo | **FALHOU** (resíduo real, descrito acima) |
| Inventário preexistente preservado | **COMPROVADO NO NEON** |
| Código de saída 0 | **FALHOU** (código 3) |

## 10. Pendências antes de qualquer novo ensaio de escrita

1. **Decidir a limpeza do resíduo atual** — proposta mínima (não executada, aguardando autorização específica): usando a própria membership `SET` ainda ativa, `SET ROLE "zz_probe_4ed63750_role_b"; DROP DATABASE "zz_probe_4ed63750_db"; RESET ROLE; DROP ROLE "zz_probe_4ed63750_role_b";` — tudo dentro do projeto descartável, atingindo somente esses dois objetos nomeados, nada mais.
2. Corrigir o bug de leitura em `E2B` (agregar/filtrar por `grantor`, não pegar a primeira linha).
3. Corrigir `ops/homolog/sql/neon/01-grant-set-true-migrator.sql` para conceder `INHERIT TRUE` (voltando à combinação da C.3/C.4) **ou** avaliar uma alternativa mais restrita (ex.: dois grants distintos — `SET` apenas para o script 02, `INHERIT` temporário só em volta das duas instruções de `04-finalize-rename.sql`) — decisão de design para uma próxima etapa (3D.5.3-C.5.3), não tomada aqui.
4. Atualizar `docs/neon-homolog.md` §8 e o relatório C.5.1 com esta correção, quando a decisão acima for tomada.
5. Só depois, repetir o ensaio de escrita completo (A–G) do zero.
