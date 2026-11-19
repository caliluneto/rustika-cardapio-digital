# 3D.5.3-C.5 — scripts específicos do provedor Neon

Estes três arquivos **não substituem nem modificam** os scripts `01-09` em `../` (cluster PostgreSQL dedicado), que continuam
valendo sem alteração para esse caso. Eles só se somam ao procedimento **quando o destino é o Neon**, para contornar a
ausência de um superusuário real lá (ver `RELATORIO-ENTREGA-3D.5.3-C.5.md`).

Nenhum destes arquivos foi executado. Ordem de execução pretendida, quando autorizada:

1. `../01-cluster-roles.sql`
2. **`neon/01-grant-set-true-migrator.sql`** ← novo (concede SET TRUE, INHERIT FALSE — mínimo para o passo 3)
3. `../02-create-replay-database.sql` (precisa só de SET)
4. `../03-verify-replay.sql`
5. **`neon/01b-elevate-inherit-for-rename.sql`** ← novo (eleva a MESMA membership para INHERIT TRUE — mínimo
   adicional para o passo 6; ver 3D.5.3-C.5.3 no cabeçalho do arquivo para a causa raiz)
6. `../04-finalize-rename.sql` (precisa de INHERIT, não só SET)
7. **`neon/02-revoke-set-true-migrator.sql`** ← novo (revoga a membership por completo: SET + INHERIT, numa só vez)
8. `../05-post-migration-grants.sql`
9. `../06` a `../09` (bootstrap e verificação de ACL), sem alteração

`neon/03-verify-ownership.sql` (leitura) deve ser rodado antes do passo 2 e depois do passo 7, para comparar o
inventário "antes"/"depois". Nunca rode `02-revoke-set-true-migrator.sql` entre os passos 5 e 6 — a renomeação
ainda precisa do INHERIT concedido no passo 5.
