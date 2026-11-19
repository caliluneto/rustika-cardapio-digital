# Relatório da Entrega 3D.3.3

## Publicação das categorias e exposição dos 144 produtos públicos

**Data:** 03/11/2026  
**Escopo:** preparação e validação offline da correção incremental do catálogo público.  
**Estado:** nenhuma escrita foi realizada no PostgreSQL; o modo `--execute` do executor preparado não foi utilizado.

### Resultado em uma linha

O plano foi validado contra o banco real em modo somente leitura: **12 categorias**, **144 produtos públicos elegíveis**, **24 produtos internos preservados**, **10 categorias a publicar**, **3 produtos elegíveis antes** e **144 depois**. Build concluído com sucesso e os 5 testes novos foram aprovados.

---

## 1. Identificação das dez categorias

Todas as 12 categorias estão ativas, com `displayOrder = 0`. As duas categorias já publicadas são apresentadas apenas para contexto; as dez sem `publicKey` são o alvo da atualização.

| Categoria | ID | `publicKey` atual | Situação |
|---|---|---|---|
| ÁGUA | `877f6779-8bf9-4941-ab69-65afe92e95ab` | `null` | a publicar |
| CERVEJA | `769c666b-3ec8-4121-833b-d8c8de0c1917` | `null` | a publicar |
| DESTILADO | `c7689217-1e13-407a-8f3f-00e7a7821ab2` | `null` | a publicar |
| DRINK PRONTO | `891ae262-5fd4-42e3-950b-16210959618e` | `null` | a publicar |
| DRINKS | `242e73fa-d8d3-4d0f-a55d-fd886626ea2f` | `null` | a publicar |
| ENERGÉTICO | `b31f1de9-df94-4cf7-9afd-65ac88c06f27` | `null` | a publicar |
| GELO CÔCO | `839dcd6e-7cbc-4772-a610-8989d55d4e88` | `null` | a publicar |
| PORÇÕES | `1c12cb16-3faa-4e74-82cb-1017e6687a9d` | `null` | a publicar |
| REFRIGERANTE | `35b2f7d6-5e15-4e93-930b-52f7c07d19d1` | `null` | a publicar |
| SUCO | `41a28be7-71cb-4091-a694-2d30824a738c` | `null` | a publicar |
| DIVERSOS | `012e00e4-214a-4674-aede-49677e83faf5` | `rustika-category-diversos` | já publicada |
| INSUMO | `a3a6f2a6-33f7-45aa-91bd-529702c8ac6e` | `rustika-category-insumo` | já publicada |

Não há criação, renomeação, exclusão ou alteração de ID de categoria. As duas chaves existentes serão preservadas.

## 2. Chaves públicas propostas

As chaves seguem o padrão já usado pelo catálogo: prefixo `rustika-category-`, minúsculas, números e hífens, com no máximo 64 caracteres. Todas são únicas, não colidem com as chaves existentes e não há duplicidade de categoria.

| Categoria | Chave atual | Chave proposta |
|---|---|---|
| ÁGUA | `null` | `rustika-category-agua` |
| CERVEJA | `null` | `rustika-category-cerveja` |
| DESTILADO | `null` | `rustika-category-destilado` |
| DRINK PRONTO | `null` | `rustika-category-drink-pronto` |
| DRINKS | `null` | `rustika-category-drinks` |
| ENERGÉTICO | `null` | `rustika-category-energetico` |
| GELO CÔCO | `null` | `rustika-category-gelo-coco` |
| PORÇÕES | `null` | `rustika-category-porcoes` |
| REFRIGERANTE | `null` | `rustika-category-refrigerante` |
| SUCO | `null` | `rustika-category-suco` |

O contrato aceito pela API é `^[a-z0-9]+(-[a-z0-9]+)*$`, com limite de 64 caracteres. As chaves propostas passam nesse contrato.

## 3. Quantidade de produtos por categoria

“Comercializável” aqui significa produto com `publicKey` preenchida. “Interno” significa produto com `publicKey` nula. Os 24 internos estão todos em `INSUMO`; nenhum outro grupo possui produto interno.

| Categoria | Total | Com `publicKey` | Internos | Elegíveis antes | Elegíveis depois |
|---|---:|---:|---:|---:|---:|
| ÁGUA | 2 | 2 | 0 | 0 | 2 |
| CERVEJA | 14 | 14 | 0 | 0 | 14 |
| DESTILADO | 44 | 44 | 0 | 0 | 44 |
| DIVERSOS | 1 | 1 | 0 | 1 | 1 |
| DRINK PRONTO | 9 | 9 | 0 | 0 | 9 |
| DRINKS | 26 | 26 | 0 | 0 | 26 |
| ENERGÉTICO | 12 | 12 | 0 | 0 | 12 |
| GELO CÔCO | 3 | 3 | 0 | 0 | 3 |
| INSUMO | 26 | 2 | 24 | 2 | 2 |
| PORÇÕES | 13 | 13 | 0 | 0 | 13 |
| REFRIGERANTE | 10 | 10 | 0 | 0 | 10 |
| SUCO | 8 | 8 | 0 | 0 | 8 |
| **Total** | **168** | **144** | **24** | **3** | **144** |

Conferência: 141 produtos públicos nas dez categorias a publicar + 1 em `DIVERSOS` + 2 em `INSUMO` = **144**. Os 24 internos de `INSUMO` permanecem fora da API.

## 4. Impacto esperado na API

### Antes da atualização

- `GET /api/categories`: 2 categorias públicas (`DIVERSOS` e `INSUMO`).
- `GET /api/products`: 3 produtos públicos.
- Os 24 internos já retornam 404.
- `PA062240` já está disponível.

### Depois da atualização proposta

- `GET /api/categories`: **12 categorias**.
- `GET /api/products`: **144 produtos públicos**. Com o limite padrão de 30, são 5 páginas (30 + 30 + 30 + 30 + 24); com `?limit=50`, são 3 páginas (50 + 50 + 44).
- Filtros por categoria passam a funcionar para todas as 12 categorias; nenhuma categoria ficará vazia.
- `GET /api/products/rustika-PA062240`: continua disponível, com preço de R$ 50,00.
- Os 24 produtos internos continuam com `publicKey` nula e não aparecem em listagens, filtros, paginação ou busca por chave.
- Nenhum preço, nome, disponibilidade, ID ou vínculo de produto é alterado.
- Nenhuma categoria ou produto é criado ou excluído.

Esse impacto é **simulado e validado pelo plano/dry-run**; ainda não foi observado via HTTP porque a escrita não foi executada. A distribuição esperada é a da seção 3: `DESTILADO` terá 44 produtos, `DRINKS` 26, `CERVEJA` 14, `PORÇÕES` 13, `ENERGÉTICO` 12, `REFRIGERANTE` 10, `DRINK PRONTO` 9, `SUCO` 8, `GELO CÔCO` 3 e `ÁGUA` 2.

## 5. Testes e validações executados

### Testes novos

Arquivo: `backend/tests/categoryPublication.test.ts`  
Resultado: **5/5 aprovados**.

Cobertura:

1. Propõe chaves únicas e válidas apenas para as dez categorias sem `publicKey`.
2. Preserva IDs, nomes e as duas chaves existentes sem criar categorias.
3. Expõe exatamente 144 produtos públicos e bloqueia os 24 internos.
4. É idempotente quando as chaves já estão publicadas.
5. Mantém compatibilidade com o serviço de catálogo, filtros, paginação, disponibilidade, 404 de internos e `PA062240`.

A fixture usa os IDs reais das 12 categorias, as chaves reais dos 144 produtos e os dois produtos reais de `INSUMO` (`BALY 2L` e `PA062240`). Os demais nomes/preços genéricos são sintéticos; o dry-run contra o banco real cobre a identidade e as contagens reais.

### Testes relacionados

Comando executado com `NODE_ENV=test` e `DB_PROFILE=app-test`:

```powershell
npx vitest run tests/categoryPublication.test.ts tests/catalog.test.ts tests/services/catalog.service.test.ts tests/health.test.ts
```

Resultado: **74/75 aprovados**. A única falha é pré-existente e fora do escopo: `tests/catalog.test.ts > rejeita entrada inválida com 400 sem consultar Prisma` (entrada malformada retorna 500 em vez de 400), já registrada na 3D.3.2. Nenhuma falha nova foi introduzida.

### Build

```powershell
npm run build
```

Resultado: **exit 0**.

### Typecheck

`npm run typecheck` continua com **exit 2** e exatamente **11 erros pré-existentes**, todos fora dos arquivos desta entrega:

- `scripts/analyze-excel.ts` (2)
- `scripts/analyze-excel2.ts` (1)
- `scripts/executor-seed-real.ts` (5)
- `scripts/validate-api.ts` (1)
- `tests/access.test.ts` (1)
- `tests/scripts/seed-dev.test.ts` (1)

Não há erros em `categoryPublication.ts`, `categoryPublication.test.ts` ou `publish-category-publication.ts`.

### Dry-run do executor

Comando executado (sem `--execute`):

```powershell
npx tsx scripts/publish-category-publication.ts
```

Resultado: **exit 0**, identidade confirmada como `perfil=migrate-dev`, `banco=cardapio_digital_dev`, `role=cardapio_migrator`; 10 atualizações propostas; 12 categorias; 144 produtos com chave; 24 internos; 3 elegíveis antes; 144 depois. A transação de leitura usou `SET TRANSACTION READ ONLY`; nenhuma escrita foi feita.

A suíte completa não foi reexecutada; o recorte relacionado ao catálogo foi executado e o estado geral permanece o documentado na 3D.3.2.

## 6. Plano mínimo de atualização

1. **Pré-condição:** autorização explícita para a escrita e uso do banco `cardapio_digital_dev`.
2. **Role:** usar `cardapio_migrator` (perfil `migrate-dev`). A role de runtime `cardapio_dev_app` possui apenas `SELECT` em `categories` e `products`; ela não deve ser usada para a atualização. Nenhuma role ou permissão será alterada.
3. **Validação prévia:** executar o dry-run e confirmar exatamente 10 atualizações, 12 categorias, 144 produtos públicos, 24 internos e `PA062240` elegível. Qualquer divergência interrompe o processo.
4. **Atomicidade:** a escrita ocorre em uma única transação, com `statement_timeout` local. Cada linha é atualizada por `id + name + public_key IS NULL`; se qualquer atualização não afetar exatamente 1 linha, a transação é revertida.
5. **Escopo da escrita:** somente `UPDATE categories SET public_key = ...` nas 10 categorias identificadas. Não há `INSERT`, `DELETE`, alteração de produtos, alteração de preços, criação de categorias ou mudança de schema.
6. **Idempotência:** se as 10 chaves já estiverem publicadas, o executor apenas valida o estado e não escreve novamente. Estado parcial (1 a 9 chaves) é rejeitado.
7. **Verificação pós-commit:** confirmar por consulta somente leitura 12 categorias com chave, 144 produtos elegíveis, 24 internos e `PA062240`; depois validar via HTTP:
   - `GET /api/categories` = 12;
   - `GET /api/products` = 144 no total, 5 páginas no limite padrão de 30 (ou 3 com `?limit=50`);
   - `GET /api/products/rustika-PA062240` = 200;
   - uma chave interna = 404;
   - filtros por cada uma das 10 categorias.
8. **Falha após o commit:** não há `DELETE` nem rollback automático pós-commit. Qualquer reversão seria uma operação separada, explicitamente autorizada.

## 7. Comando de execução futura

O executor preparado é `backend/scripts/publish-category-publication.ts`. Ele carrega o perfil `migrate-dev` do mapa de perfis e o cofre de segredos aprovado, sem imprimir URL ou senha.

Dry-run (somente leitura):

```powershell
Set-Location C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend
npx tsx scripts/publish-category-publication.ts
```

Execução futura, somente após autorização explícita:

```powershell
Set-Location C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend
npx tsx scripts/publish-category-publication.ts --execute --confirm=cardapio_digital_dev
```

O script recusa a execução sem a confirmação exata, recusa banco ou role diferente de `cardapio_digital_dev` / `cardapio_migrator`, e recusa plano divergente do snapshot aprovado. Ele não contém `DELETE`. Nesta entrega o comando com `--execute` **não foi executado**.

## 8. Condições para autorização

A execução da escrita deve atender a todas as condições abaixo:

- Autorização explícita do responsável para a etapa de atualização.
- Alvo confirmado: banco `cardapio_digital_dev`; role `cardapio_migrator`.
- Dry-run aprovado com 10 IDs, 144 produtos públicos, 24 internos e `PA062240`.
- Janela sem escritores concorrentes no catálogo.
- Cofre de segredos e arquivos de configuração inalterados; nenhuma credencial exposta em log ou relatório.
- Nenhuma execução de Seed, migration, alteração de schema, autenticação, pedidos ou comandas.
- Critérios de aceite: 12 categorias públicas, 144 produtos, 24 internos fora da API, nenhuma chave duplicada, `PA062240` disponível, preços e IDs inalterados.
- Qualquer divergência antes ou depois da escrita interrompe o processo e exige investigação; não excluir dados.

## 9. Artefatos e estado

Arquivos novos desta entrega:

- `backend/src/domain/categoryPublication.ts` — mapeamento, validação e plano puro de publicação.
- `backend/tests/categoryPublication.test.ts` — 5 testes offline.
- `backend/scripts/publish-category-publication.ts` — executor guardado, dry-run por padrão.
- `RELATORIO-ENTREGA-3D.3.3.md` — este relatório.

O arquivo `backend/src/app.ts` já estava modificado antes desta entrega e não foi alterado nesta etapa. Não houve commit, migration, Seed ou escrita no banco. O snapshot somente leitura usado como base está em `C:\Users\u1n3c\AppData\Local\Temp\opencode\category-publication-snapshot.json`.

**Conclusão:** a correção está preparada e validada em modo somente leitura. A publicação dos 144 produtos depende apenas da autorização explícita para executar o comando da seção 7.
