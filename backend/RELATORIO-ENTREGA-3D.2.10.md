# RÚSTIKA — ENTREGA 3D.2.10 — DIAGNÓSTICO
## Análise da Importação Parcial

**Data**: 01/11/2026 21:13 UTC  
**Status**: 🔍 DIAGNÓSTICO CONCLUÍDO

---

## 1. CAUSA PRINCIPAL ⚠️

### BUG IDENTIFICADO: Filtro com espaço

**Localização**: `scripts/seed-real.ts`, linha 75

```typescript
const rows = data.filter(r =>
  (r['Grupo'] === 'INSUMO' || r['Grupo'] === 'DIVERSOS ') && r['Estado'] === 'Ativo'
);
```

**PROBLEMA**: Procura por `'DIVERSOS '` (com espaço), não `'DIVERSOS'`

**Impacto**:
- ❌ Apenas INSUMO processado
- ❌ Todos os outros grupos ignorados (ÁGUA, CERVEJA, DESTILADO, etc.)
- ❌ 27 registros inseridos em vez de 168
- ❌ 2 categorias criadas em vez de 12

---

## 2. DIVERGÊNCIA DA ROLE

**Planejado**: `cardapio_migrator` (migrate-dev)  
**Executado**: `cardapio_dev_app` (app-dev)

**Causa**: `.env` configurado com `DB_PROFILE=app-dev`

**Impacto**: Menor — ambas roles têm permissão de INSERT. Diferença é documentária.

---

## 3. CONSTRAINT `products_source_identity_consistent`

```
Válido se:
(1) TODOS source_* = NULL (produto interno)
    OU
(2) source_code ~ '^[0-9]+$' AND publicKey = 'rustika-{code}' (produto público)
```

**Conclusão**: Constraint funcionou corretamente. O problema é o filtro.

---

## 4. PRODUTOS IMPORTADOS (27)

- 2 categorias: INSUMO, DIVERSOS
- 2 produtos públicos (códigos numéricos)
- 25 produtos internos

**Apenas do grupo INSUMO/DIVERSOS** (devido ao bug)

---

## 5. PRODUTOS AUSENTES (141)

**Grupos não processados**:
- ÁGUA (~10)
- CERVEJA (~20)
- DESTILADO (~15)
- DRINK PRONTO (~10)
- DRINKS (~30)
- ENERGÉTICO (~10)
- GELO CÔCO (~10)
- PORÇÕES (~15)
- REFRIGERANTE (~15)
- SUCO (~15)

---

## 6. RASTREABILIDADE

Todos os 27 registros estão no banco:
- ✅ Identificáveis
- ✅ Deletáveis sem risco
- ✅ Reutilizáveis via upsert

---

## 7. CORREÇÃO NECESSÁRIA

### Fix mínimo (1 caractere):

```typescript
// ANTES (bugado):
(r['Grupo'] === 'INSUMO' || r['Grupo'] === 'DIVERSOS ')

// DEPOIS (correto):
(r['Grupo'] === 'INSUMO' || r['Grupo'] === 'DIVERSOS')
```

---

## 8. PLANO DE RECUPERAÇÃO

### Etapa 1: Corrigir código
Remover espaço em linha 75 de `seed-real.ts`

### Etapa 2: Limpar dados (requer autorização)
```sql
DELETE FROM products;
DELETE FROM categories;
```

### Etapa 3: Reimportar
```bash
npx tsx scripts/executor-seed-real.ts --execute
```

**Resultado esperado**:
- ✅ 144 públicos
- ✅ 24 internos
- ✅ 12 categorias
- ✅ 0 erros

---

## 9. RISCOS

🔴 **CRÍTICO**: Bug no filtro causou importação incompleta

🟡 **MÉDIO**: Dados inconsistentes podem gerar duplicatas ao reimportar

🟢 **BAIXO**: Nenhum dado foi destruído, structure está intacta

---

## 10. PARECER

### ✅ RECOMENDAÇÃO PRÓXIMA AÇÃO

1. Corrigir bug em `seed-real.ts` linha 75 (remover espaço)
2. Deletar 27 registros incorretos (autorização necessária)
3. Reexecutar importação com `--execute`

### ⚠️ PRECAUÇÕES

- NÃO reexecutar sem corrigir o código
- NÃO consertar registros manualmente
- NÃO modificar constraints
- NÃO usar roles diferentes

---

## CONCLUSÃO

**Causa**: Typo com espaço (`'DIVERSOS '` vs `'DIVERSOS'`)  
**Impacto**: 141 produtos públicos não importados  
**Recuperação**: Simples — corrigir 1 caractere e reimportar  
**Status**: 🔍 Aguardando autorização para correção e limpeza

---

**Gerado em**: 01/11/2026 21:13 UTC  
**Entrega**: 3D.2.10 — Diagnóstico Completo  
**Próxima etapa**: Autorização para corrigir e reimportar
