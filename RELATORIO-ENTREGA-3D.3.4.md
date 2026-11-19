# Relatório da Entrega 3D.3.4

## Execução real da publicação das categorias e validação pós-commit

**Data:** 03/11/2026  
**Banco:** `cardapio_digital_dev`  
**Role da escrita:** `cardapio_migrator`  
**Comando executado:** `npx tsx scripts/publish-category-publication.ts --execute --confirm=cardapio_digital_dev`  
**Resultado:** transação concluída com sucesso; **10 categorias alteradas**; **0 produtos alterados**.  
**Estado final:** 12 categorias públicas, 144 produtos públicos, 24 produtos internos preservados, 168 produtos persistidos.

---

## 1. Verificação prévia e backup

Antes da escrita, o estado foi confirmado como exatamente dez categorias pendentes:

- 12 categorias existentes.
- 2 categorias já públicas.
- 10 categorias com `publicKey` nula.
- 168 produtos.
- 144 produtos com `publicKey`.
- 24 produtos internos.
- 3 produtos elegíveis antes da publicação.
- Nenhuma categoria adicional, ausente ou divergente.
- Nenhuma chave duplicada.
- Nenhum produto interno com identidade pública.
- Nenhum escritor concorrente ativo e nenhum lock de escrita em `categories`/`products` no momento da verificação.

### Backup recuperável

- Arquivo: `C:\Users\u1n3c\AppData\Local\CardapioDigital\backups\cardapio_digital_dev_pre_3d34_20261103_124004.backup`
- Formato: custom (`pg_dump -F c`), com estrutura e dados, sem owner/privileges.
- Tamanho: 42.995 bytes.
- Validação: `pg_restore --list` exit 0, 91 entradas.
- Presença de dados de `public.categories` confirmada.
- Conteúdo extraído: 12 linhas de `categories`, incluindo as chaves existentes `rustika-category-diversos` e `rustika-category-insumo`.

## 2. Autorização recebida

A autorização condicional foi concedida nesta continuação. O pré-voo confirmou as condições e a execução foi realizada **uma única vez**, em 03/11/2026 12:41:47.

Não foi necessário executar novamente o planejamento. O executor não foi alterado para contornar proteções.

## 3. Quantidade de categorias alteradas

| Indicador | Quantidade |
|---|---:|
| Categorias alteradas | **10** |
| Categorias já públicas preservadas | 2 |
| Categorias criadas | 0 |
| Categorias excluídas | 0 |
| Produtos alterados | 0 |
| Preços alterados | 0 |

## 4. Resultado da transação

Saída real do executor:

```json
{
  "mode": "execute",
  "database": "perfil=migrate-dev banco=cardapio_digital_dev role=cardapio_migrator",
  "updated": 10,
  "totals": {
    "categories": 12,
    "categoriesAlreadyPublic": 12,
    "categoriesToPublish": 0,
    "categoriesAfter": 12,
    "products": 168,
    "publicKeyProducts": 144,
    "internalProducts": 24,
    "eligibleBefore": 144,
    "eligibleAfter": 144
  }
}
```

- Exit code: **0**.
- A transação interativa foi concluída; o commit foi efetivado.
- Total real de linhas alteradas: **10**, exclusivamente em `categories.public_key`.
- Nenhuma escrita em `products`.
- Nenhum `DELETE`, `TRUNCATE` ou `DROP`.
- A execução seguinte em modo dry-run retornou `updates: []`, `categoriesToPublish: 0` e `eligibleAfter: 144`, confirmando idempotência e ausência de pendências.

### Chaves finais

| Categoria | ID | `publicKey` final | Total | Públicos | Internos |
|---|---|---|---:|---:|---:|
| ÁGUA | `877f6779-8bf9-4941-ab69-65afe92e95ab` | `rustika-category-agua` | 2 | 2 | 0 |
| CERVEJA | `769c666b-3ec8-4121-833b-d8c8de0c1917` | `rustika-category-cerveja` | 14 | 14 | 0 |
| DESTILADO | `c7689217-1e13-407a-8f3f-00e7a7821ab2` | `rustika-category-destilado` | 44 | 44 | 0 |
| DIVERSOS | `012e00e4-214a-4674-aede-49677e83faf5` | `rustika-category-diversos` | 1 | 1 | 0 |
| DRINK PRONTO | `891ae262-5fd4-42e3-950b-16210959618e` | `rustika-category-drink-pronto` | 9 | 9 | 0 |
| DRINKS | `242e73fa-d8d3-4d0f-a55d-fd886626ea2f` | `rustika-category-drinks` | 26 | 26 | 0 |
| ENERGÉTICO | `b31f1de9-df94-4cf7-9afd-65ac88c06f27` | `rustika-category-energetico` | 12 | 12 | 0 |
| GELO CÔCO | `839dcd6e-7cbc-4772-a610-8989d55d4e88` | `rustika-category-gelo-coco` | 3 | 3 | 0 |
| INSUMO | `a3a6f2a6-33f7-45aa-91bd-529702c8ac6e` | `rustika-category-insumo` | 26 | 2 | 24 |
| PORÇÕES | `1c12cb16-3faa-4e74-82cb-1017e6687a9d` | `rustika-category-porcoes` | 13 | 13 | 0 |
| REFRIGERANTE | `35b2f7d6-5e15-4e93-930b-52f7c07d19d1` | `rustika-category-refrigerante` | 10 | 10 | 0 |
| SUCO | `41a28be7-71cb-4091-a694-2d30824a738c` | `rustika-category-suco` | 8 | 8 | 0 |

## 5. Validação pós-commit no banco

Consultas reais após o commit:

```text
categories=12; public=12; pending=0
products=168; public=144; internal=24
internal products with clean identity=24
internal products in INSUMO=24
duplicate category keys=0
duplicate product keys=0
duplicate source codes=0
```

- `PA062240`: `public_key=rustika-PA062240`, preço `50.00`, `source_code=PA062240`, categoria `INSUMO`.
- As 12 categorias têm IDs, nomes, estado ativo e ordem preservados.
- O hash ordenado dos 168 produtos, comparando o backup prévio com o estado pós-commit, é idêntico: `37FBFD82AB776573596DA7E1F76589F4961EF739B1A3A5E4FB48B6D1AFCA2505`.
- O hash de `id + name` das 12 categorias também é idêntico ao estado anterior: `8A47677B373BC99E122AF7CE152DA68091D2E75982198919FC41C58930E95891`.
- Portanto, produtos, preços, IDs e nomes foram preservados; não houve duplicação nem exclusão.

## 6. Validação HTTP pós-commit

Servidor iniciado com `npm run build` já concluído e `node dist/server.js`; porta 4000 isolada e encerrada ao final. Todas as chamadas foram `GET`.

| Validação | Resultado |
|---|---|
| `GET /api/categories` | 12 categorias; 12 chaves únicas |
| `GET /api/products?limit=50` paginado | 144 produtos; 3 páginas (50 + 50 + 44) |
| `GET /api/products` com limite padrão 30, paginado | 144 produtos; 5 páginas (30 + 30 + 30 + 30 + 24) |
| IDs únicos de produto | 144 |
| Soma dos filtros por categoria | 144 |
| Filtros divergentes | 0 |
| `GET /api/products/rustika-PA062240` | 200; `rustika-PA062240`; R$ 50,00 |
| Sonda de chave interna inexistente | 404 |
| Preços inválidos no retorno | 0 |

Contagem HTTP por categoria:

| Categoria | Esperado | Retornado |
|---|---:|---:|
| `rustika-category-agua` | 2 | 2 |
| `rustika-category-cerveja` | 14 | 14 |
| `rustika-category-destilado` | 44 | 44 |
| `rustika-category-diversos` | 1 | 1 |
| `rustika-category-drink-pronto` | 9 | 9 |
| `rustika-category-drinks` | 26 | 26 |
| `rustika-category-energetico` | 12 | 12 |
| `rustika-category-gelo-coco` | 3 | 3 |
| `rustika-category-insumo` | 2 | 2 |
| `rustika-category-porcoes` | 13 | 13 |
| `rustika-category-refrigerante` | 10 | 10 |
| `rustika-category-suco` | 8 | 8 |

Resultado final do verificador: `HTTP_VALIDATION=OK`.

## 7. Preservação dos produtos internos

- 24 produtos internos persistem com `publicKey` nula.
- Todos os 24 estão em `INSUMO`.
- Todos os 24 têm `sourceCode`, `sourceName` e `sourceGroup` nulos.
- A API retorna 144 produtos no total; os 24 internos não aparecem nas listagens, filtros ou paginação.
- A sonda de detalhe com chave interna retorna 404.
- O hash dos 168 produtos é idêntico ao backup prévio, comprovando que nenhum produto foi alterado.
- `INSUMO` já era público e continua retornando apenas 2 produtos públicos.

Conclusão: os 24 produtos internos permanecem inacessíveis.

## 8. Testes e validações

- Testes de `categoryPublication`: **5/5 aprovados**.
- Build: **exit 0**.
- Typecheck: **11 erros pré-existentes**, nenhum novo nos arquivos desta entrega.
- Dry-run prévio: 10 atualizações, 144 públicos, 24 internos, 3 → 144 elegíveis.
- Dry-run pós-commit: 0 atualizações, 12 categorias públicas, 144 elegíveis.
- Pré-voo: `approved-with-warning` apenas pela ressalva de privilégios abaixo.
- Busca estática no executor: 0 ocorrências de `DELETE`, `TRUNCATE`, `DROP`, `deleteMany` ou `truncate`.

## 9. Divergências e pendências

### 9.1 Privilégios excessivos de `cardapio_dev_app` — pendente

O pré-voo real confirmou que `cardapio_dev_app` possui `INSERT`, `SELECT`, `UPDATE` e `DELETE` em `categories` e `products` (`TRUNCATE` = false). A migration `20261031000000_rf004_fix_permissions` concede SELECT, mas não revoga ACLs anteriores; o banco mantém privilégios mais amplos que o menor privilégio documentado.

- Isso **não afetou** a publicação: a escrita usou `cardapio_migrator` e atualizou somente 10 linhas de `categories`.
- Nenhuma role, permissão, credencial ou `.env` foi alterada nesta entrega.
- A correção de privilégios fica registrada como pendência separada, fora do escopo desta publicação.

### 9.2 Validador HTTP

A primeira execução do script de validação HTTP teve um erro de condição no próprio PowerShell (comparação de array com escalar). Os dados retornados já estavam corretos; a verificação foi repetida com `.Count` e terminou `HTTP_VALIDATION=OK`. Não foi uma falha da aplicação.

### 9.3 Outras falhas

- Nenhuma falha de contagem, identidade, chave, categoria, produto ou preço.
- Nenhuma duplicação ou exclusão.
- Nenhuma divergência de dados.

## 10. Parecer final

**Publicação concluída com sucesso.** O estado final atende aos critérios:

- 12 categorias públicas.
- 144 produtos públicos retornados via paginação.
- 24 produtos internos inacessíveis.
- 168 produtos persistidos.
- `PA062240` acessível a R$ 50,00.
- IDs, nomes e preços preservados.
- Nenhuma duplicação ou exclusão.
- 10 linhas alteradas, exclusivamente em `categories.public_key`.

A pendência de privilégios excessivos de `cardapio_dev_app` permanece registrada para tratamento separado. Nenhuma integração frontend foi iniciada. Nenhum Seed, migration ou alteração de credenciais/permissões foi executado.

## 11. Artefatos

- `backend/scripts/preflight-category-publication.ts` — pré-voo somente leitura.
- `backend/scripts/publish-category-publication.ts` — executor guardado.
- `backend/src/domain/categoryPublication.ts` — plano puro.
- `backend/tests/categoryPublication.test.ts` — 5 testes.
- `RELATORIO-ENTREGA-3D.3.4.md` — este relatório.
- Backup: `C:\Users\u1n3c\AppData\Local\CardapioDigital\backups\cardapio_digital_dev_pre_3d34_20261103_124004.backup`.

Não houve commit.
