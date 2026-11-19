# Importação Homologatória do Catálogo Real — RÚSTIKA

## Objetivo e Escopo

Este documento descreve o importador controlado do catálogo real privado (`backend/data/Exportacao-produtos.xlsx`, ignorado pelo Git) para o banco de homologação no Neon (`cardapio_digital_homolog`, OID `57355`, projeto `aged-scene-47291697`, branch `br-frosty-fire-bd4xw2sc`).

Diferentemente de `scripts/executor-seed-real.ts` (restrito ao banco local `cardapio_digital_dev` e sem implementação de escrita), o executor `scripts/import-catalog-homolog.ts` (`scripts/homolog/catalogHomologImporter.ts`) foi construído especificamente para homologação remota supervisionada, com reconciliação prévia em transação `SERIALIZABLE READ ONLY` e importação atômica idempotente.

## Classificação Determinística da Planilha Real

Validada localmente por `tests/scripts/private-catalog.test.ts` sobre `backend/data/Exportacao-produtos.xlsx`:

| Classe | Quantidade verificada | Tratamento no importador de homologação |
|---|---:|---|
| Total de linhas na planilha | 204 | Inspecionadas integralmente antes de abrir conexão |
| Inativos (`Ativo ≠ Sim`) | 30 | **Excluídos** (nunca importados) |
| Insumos internos (`INSUMO` / prefixos internos) | 24 | **Bloqueados** (nunca expostos nem gravados no cardápio) |
| Incertos / suspensos (`INCERTO`) | 6 | **Bloqueados** até definição explícita de negócio |
| Comercializados aprovados (`COMERCIALIZADO`) | **144** | **Importados / reconciliados** (inclui `PA062240` e `44`) |
| Categorias públicas mapeadas (`CATEGORY_PUBLIC_KEYS`) | **12** | Criadas ou reconciliadas com `publicKey` e `displayOrder` determinísticos |

## Garantias de Segurança e Idempotência

1. **Perfil e alvo fixos:** aceita exclusivamente `--profile migrate-homolog`, endpoint Neon direto exato (sem `-pooler`), `sslmode=require`, `sslaccept=strict`, `channel_binding=require` (contrato real do Prisma/Quaint 6.19.3; `verify-full` cai em `prefer`), prova TLS externa independente e validação de projeto (`aged-scene-47291697`), branch (`br-frosty-fire-bd4xw2sc`), banco (`cardapio_digital_homolog`), OID (`57355`), role `cardapio_homolog_migrator`, owners, role `cardapio_homolog_bootstrap` (`NOLOGIN`, OID `57350`) e **9/9 migrations** com checksums exatos.
2. **Dry-run `SERIALIZABLE READ ONLY` por padrão:** sem `--execute`, abre transação PostgreSQL `SERIALIZABLE READ ONLY` comprovada no servidor (`transaction_read_only = true`), com cliente congelado sem métodos de escrita, e emite o relatório completo de reconciliação (`create`, `update`, `unchanged`, produtos manuais preservados e eventuais conflitos).
3. **Preservação de dados operacionais e históricos:**
   - Produtos novos entram com `availabilityState = 'UNKNOWN'` (nunca marcados disponíveis sem confirmação administrativa).
   - Em reexecuções idempotentes sobre produtos já existentes com mesmo `sourceCode`, `availabilityState`, `name` customizado pelo admin, `description`, `ingredients`, `imageUrl` e `imageAlt` existentes são **preservados**; apenas metadados de origem/preço/categoria divergentes são sincronizados.
   - Produtos manuais criados pelo painel administrativo (`MANUAL*` ou outros códigos fora da planilha) e todo o histórico de `orders` / `order_items` / `comandas` permanecem intactos; o importador **nunca executa `DELETE`, `TRUNCATE` ou `DROP`**.
   - Qualquer conflito de chave (`publicKey`, nome duplicado na mesma categoria com outro `sourceCode`, ou `sourceCode` pré-existente pertencente a item bloqueado) aborta a operação com `RECONCILIATION_CONFLICT` antes de qualquer gravação.
4. **Atomicidade e ambiguidade de commit:** toda a escrita ocorre em uma única transação `Prisma.TransactionIsolationLevel.Serializable`, revalidando os fatos de identidade dentro dela. Falha de rede na fronteira do `COMMIT` retorna `OUTCOME_UNKNOWN` (exit code `3`) e proíbe repetição automática antes de novo dry-run de reconciliação.

## Procedimento Operacional (Somente Após Autorização Explícita)

### 1. Dry-run somente leitura

Executar em `backend/`:

```powershell
npm run homolog:catalog:dry-run -- --authorize-read-only
```

Equivalente direto:

```powershell
npx tsx scripts/import-catalog-homolog.ts --profile migrate-homolog --authorize-read-only
```

Critério para prosseguir: exit code `0`, `resultado=dry-run-ok`, `commercializedToImport=144` e `conflicts=0`.

### 2. Execução única autorizada

Somente após inspecionar o dry-run e obter autorização literal específica para escrita:

```powershell
$env:CARDAPIO_HOMOLOG_CATALOG_CONFIRMATION = "IMPORT_APPROVED_RUSTIKA_CATALOG_AGED_SCENE_47291697_BR_FROSTY_FIRE_BD4XW2SC"
npm run homolog:catalog:import
Remove-Item Env:CARDAPIO_HOMOLOG_CATALOG_CONFIRMATION
```

Critério de sucesso: exit code `0` e `resultado=imported`. Uma segunda execução em dry-run deve reportar `productsToCreate=0`, `productsToUpdate=0` e `productsUnchanged=144`.

## Texto Literal de Autorização Remota

> Autorizo explicitamente a reconciliação e importação controlada do catálogo real RÚSTIKA (`backend/data/Exportacao-produtos.xlsx`, 144 itens `COMERCIALIZADO` e 12 categorias públicas, bloqueando 24 insumos, 6 incertos e 30 inativos) no projeto Neon `aged-scene-47291697`, branch `br-frosty-fire-bd4xw2sc`, banco `cardapio_digital_homolog` OID `57355`, usando exclusivamente o perfil `migrate-homolog` e a role `cardapio_homolog_migrator`. Autorizo primeiro o dry-run `SERIALIZABLE READ ONLY` (`npm run homolog:catalog:dry-run -- --authorize-read-only`) e, somente se retornar `resultado=dry-run-ok` com zero conflitos, uma execução única de `npm run homolog:catalog:import` com `CARDAPIO_HOMOLOG_CATALOG_CONFIRMATION=IMPORT_APPROVED_RUSTIKA_CATALOG_AGED_SCENE_47291697_BR_FROSTY_FIRE_BD4XW2SC`. Não autorizo exclusão de dados, alteração de schema/roles/ACLs, nem retry sem reconciliação caso ocorra `OUTCOME_UNKNOWN`.
