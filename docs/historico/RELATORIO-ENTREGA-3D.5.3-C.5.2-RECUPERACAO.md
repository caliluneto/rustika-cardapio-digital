# RELATÓRIO DE ENTREGA — 3D.5.3-C.5.2-R
## Recuperação e limpeza de resíduos do ensaio Neon

Data/hora: 2026-11-07T16:41:35Z. **Limpeza supervisionada, executada com autorização limitada aos dois objetos temporários exatos.** A connection string foi digitada só no terminal local, nunca enviada ao chat, nunca gravada em arquivo. Variáveis de ambiente sensíveis removidas ao final. Script dedicado e descartável (`backend/scripts/_tmp-neon-recovery-c552.mjs`, fora do manifesto, removido do disco depois da execução) — **não reutilizei o `neon-probe.mjs` em modo write**, como instruído. Nenhum script de produção foi alterado nesta etapa.

**CONCLUSÃO: LIMPO.** Código de saída **0**.

---

## 1. Identidade do ambiente

| Verificado | Resultado |
|---|---|
| Endpoint direto, sem `-pooler` | `ep-sweet-king-bd7i7ypb` — confere |
| TLS externo | `authorized=true`, `TLSv1.3` |
| Banco administrativo | `postgres` |
| `current_user` / `session_user` | `neondb_owner` / `neondb_owner` |
| `neon.project_id` | `aged-scene-47291697` — confere |

Todas as pré-verificações de identidade passaram **antes** de qualquer leitura dos objetos temporários.

## 2. Objetos encontrados antes da limpeza

- Banco `zz_probe_4ed63750_db` — existia, exatamente 1 (nenhuma variação de nome).
- Role `zz_probe_4ed63750_role_b` — existia, exatamente 1, **sem** `rolsuper`/`rolcreatedb`/`rolcreaterole`/`rolbypassrls`/`rolreplication`/`rolcanlogin`.
- Conexões ativas no banco temporário (além desta sessão): **0**.
- Dependências da role em todo o cluster (`pg_shdepend`): **1** (exatamente o banco temporário — nenhuma outra).
- Inventário antes: 3 bancos (`neondb`, `postgres`, `zz_probe_4ed63750_db`), 22 roles.

## 3. Ownership e membership

- Dono do banco temporário: `zz_probe_4ed63750_role_b` — confere com o esperado.
- `pg_auth_members` tinha **duas linhas** para `(roleid=zz_probe_4ed63750_role_b, member=neondb_owner)` — confirma o diagnóstico do bug relatado no `RELATORIO-ENTREGA-3D.5.3-C.5.2-EXECUCAO.md` (uma linha automática da criação da role, `admin=true/inherit=false/set=false`; outra do `GRANT` explícito, `set=true/inherit=false/admin=false`). A verificação desta etapa agregou as duas linhas (em vez de ler só a primeira) e confirmou corretamente `set_option=true` em pelo menos uma delas.

## 4. Comandos efetivamente executados

Nesta ordem exata, cada um só depois do anterior ter sido confirmado:
1. `SET ROLE "zz_probe_4ed63750_role_b"` (identificador fixo, sem interpolação de entrada externa).
2. Confirmação: `current_user = zz_probe_4ed63750_role_b`, `session_user = neondb_owner`.
3. `DROP DATABASE "zz_probe_4ed63750_db"` — **sem** `FORCE`.
4. `RESET ROLE`.
5. Confirmação: `current_user` de volta a `neondb_owner`.
6. Verificação de ausência do banco.
7. Verificação de zero dependências restantes da role.
8. `DROP ROLE "zz_probe_4ed63750_role_b"`.
9. Verificação de ausência da role (e, por consequência, da membership — `DROP ROLE` remove automaticamente qualquer `pg_auth_members` associado).

Nenhum `CASCADE`, `DROP OWNED`, `REASSIGN OWNED` ou `DROP DATABASE ... (FORCE)` foi usado. Nenhum atributo da role temporária foi alterado antes de excluí-la. Como não havia conexões ativas no banco (item 2), não foi necessário encerrar nenhuma sessão.

## 5. Resultados e SQLSTATE

Todos os passos (1–9) retornaram **PASS**, sem nenhum `SQLSTATE` de erro. O script estava preparado para interromper e registrar o código no primeiro erro — não foi necessário.

## 6. Objetos removidos

- Banco `zz_probe_4ed63750_db`.
- Role `zz_probe_4ed63750_role_b` (e, com ela, a membership temporária `neondb_owner → zz_probe_4ed63750_role_b`).

Nenhum outro objeto foi tocado.

## 7. Inventário final

- Bancos: `neondb`, `postgres` (os dois preexistentes — `zz_probe_4ed63750_db` não está mais na lista).
- Roles: 21 (eram 22 antes da limpeza; a diferença é exatamente a role removida).
- `zzRemanescentes` (bancos + roles com prefixo `zz_probe_%`): **lista vazia**.

## 8. Resíduos restantes

**Nenhum.**

## 9. Segurança

- Connection string nunca apareceu no chat, em logs ou em arquivos — só foi digitada, oculta, no terminal local, duas vezes nesta sessão (uma para cada script).
- O script de recuperação é descartável e foi removido do disco (`backend/scripts/_tmp-neon-recovery-c552.mjs`, o `.ps1` e o `.mjs` auxiliares no diretório de scratch) — não ficou no repositório, não aparece no `git status`.
- Nenhuma migration histórica foi executada; `cardapio_digital_homolog` não foi criado; nenhuma role definitiva foi criada ou alterada; `serverIdentity.ts`, Render e bancos locais não foram tocados; nada foi commitado nem publicado.
- A limpeza atingiu exclusivamente os dois objetos nomeados na autorização — confirmado tanto pelas verificações antes (identidade exata) quanto pela auditoria depois (diferença de inventário = exatamente 1 banco e 1 role, e apenas os dois nomeados).

## 10. Conclusão

**LIMPO.** O projeto `rustika-homolog-test` está de volta ao estado anterior ao ensaio de escrita (3 bancos → 2, 22 roles → 21, zero objetos `zz_probe_*`). Não iniciei nenhum novo ensaio.

**Observação sobre a execução original (3D.5.3-C.5.2):** o resíduo agora limpo foi causado porque `ALTER DATABASE RENAME` falhou por falta de `INHERIT` (já diagnosticado no relatório da execução) — essa correção nos scripts de produção **continua pendente** e não foi feita aqui, por estar fora da autorização desta etapa.
