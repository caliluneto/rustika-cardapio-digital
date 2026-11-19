# RELATÓRIO DE ENTREGA — 3D.5.3-C.4
## Preparação da execução supervisionada do Neon Probe (modo write)

Data: 2026-11-07. **Nenhum SQL de escrita foi executado nesta etapa. Nenhuma conexão ao Neon foi aberta.** Sem banco local, migrations, Render, `neon deploy`, commit ou push. `serverIdentity.ts` e as sete migrations históricas não foram tocados.

Esta etapa é só preparação: reconfirmei o estado do script e monto os comandos exatos. **A execução das operações A–H depende da sua autorização explícita**, dada na seção 2.

## 1. Pré-voo (o que já está comprovado vs. o que só você pode confirmar)

| Item | Status |
|---|---|
| Script `neon-probe.mjs` auditado na C.3, sintaticamente válido | **COMPROVADO** — `node --check` OK |
| Testes offline (nomes únicos por execução, lista fechada de SQL, limpeza por sinal) | **COMPROVADO** — 22/22 aprovados agora mesmo |
| Endpoint direto exigido (recusa `-pooler`) | COMPROVADO no código |
| TLS com validação de cadeia e hostname | COMPROVADO no código (ver C.2.2) |
| Identidade do projeto (`neon.project_id = aged-scene-47291697`) obrigatória no modo write | COMPROVADO no código |
| `serverIdentity.ts` e as 7 migrations inalterados | COMPROVADO — sem diferença desde a C.3 |
| Nenhuma migration do RÚSTIKA será executada | COMPROVADO — o script não referencia `prisma migrate` nem os scripts `01–05` |
| Nenhuma conexão com bancos locais | COMPROVADO — o script só aceita host `*.neon.tech`; a porta 5432 local nem entra na análise |
| **Credencial anteriormente exposta foi redefinida** | **PENDENTE — só você pode confirmar.** Na C.2.1/C.2.2 a connection string do `neondb_owner` foi usada neste terminal; ela não foi impressa nem gravada por mim, mas recomendo redefinir a senha no console do Neon antes deste ensaio, por precaução. |
| Nenhum objeto `zz_probe_*` preexistente / inventário inicial registrado | **PENDENTE — exige rodar o modo read agora** (comando na seção 5); não tenho acesso para confirmar eu mesmo |

**Eu não tenho (e não devo ter) a connection string do Neon nesta sessão.** Por isso os dois itens pendentes só você pode resolver, rodando os comandos da seção 5.

## 2. Autorização

**Ainda não concedida nesta etapa.** Antes de qualquer SQL de escrita, apresento (seção 5) os comandos exatos extraídos do relatório C.3. Preciso que você:
1. Confirme que redefiniu a senha do `neondb_owner` (ou decida que não é necessário).
2. Rode o pré-voo (modo read) e cole aqui o JSON mascarado.
3. Diga explicitamente "autorizo o modo write" (e se autoriza também `NEON_PROBE_ALLOW_GRANT=yes` — ver C.3 seção 3, provavelmente necessário para os testes E/F).

Sem isso, nada das seções 3–9 abaixo pode ser preenchido com resultado real.

## 3. Resultado de cada teste (A–H)

**NÃO EXECUTADO.** Nenhuma das operações A, A2, B, C, D, E, E2, E4, F, G, H foi rodada contra o Neon nesta etapa.

## 4. Privilégios efetivamente comprovados

**NÃO TESTADO.** Os privilégios declarados (`CREATEDB`, `CREATEROLE`) foram informados pelo proprietário na C.2.2; esta etapa não os exercitou.

## 5. Comandos exatos para a execução supervisionada (aguardando sua autorização)

**Passo 1 — pré-voo (modo read; pode rodar agora, sem autorização adicional, só confirma o estado):**
```powershell
cd "C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend"
$sec = Read-Host "Cole a connection string DIRETA do Neon (entrada oculta)" -AsSecureString
$env:NEON_PROBE_URL = [System.Net.NetworkCredential]::new('', $sec).Password
$env:NEON_PROBE_CONFIRM_ENDPOINT = "ep-SEU-ENDPOINT-AQUI"
node scripts/neon-probe.mjs read "$env:TEMP\neon-probe-preflight.json"
Get-Content "$env:TEMP\neon-probe-preflight.json"
```
Cole aqui **somente o conteúdo desse JSON** (sem a connection string). Se `TLS_EXTERNO`, `IDENTIDADE` e `PROJETO_NEON_ID` saírem COMPROVADO e `REMANESCENTES_zz_probe_ANTES` não aparecer (= nenhum resíduo), o pré-voo está aprovado.

**Passo 2 — modo write (SÓ rodar depois da sua autorização explícita no chat, na mesma sessão de terminal do passo 1, sem fechar a janela):**
```powershell
$env:NEON_PROBE_ALLOW_WRITE = "yes"
$env:NEON_PROBE_ALLOW_GRANT = "yes"
node scripts/neon-probe.mjs write "$env:TEMP\neon-probe-write.json"
"codigo de saida=$LASTEXITCODE"
Get-Content "$env:TEMP\neon-probe-write.json"
```
Cole aqui o JSON e o código de saída.

**Passo 3 — limpeza do ambiente local (sempre, inclusive se algo falhar):**
```powershell
Remove-Item Env:NEON_PROBE_URL, Env:NEON_PROBE_CONFIRM_ENDPOINT, Env:NEON_PROBE_ALLOW_WRITE, Env:NEON_PROBE_ALLOW_GRANT -ErrorAction SilentlyContinue
Remove-Variable sec
```

Interpretação dos códigos de saída (do relatório C.3): `0` tudo limpo; `2` abortou antes de qualquer alteração (nada foi tocado); `3` sobrou resíduo, inventário divergente, ou a limpeza falhou — **pare e me avise antes de qualquer limpeza manual**; `4` interrompido (Ctrl+C) com limpeza incompleta; `130` interrompido com limpeza concluída.

## 6. Resultado da limpeza

**NÃO APLICÁVEL.** Nada foi criado; nada a limpar.

## 7. Comparação de inventário

**NÃO TESTADO.** Depende do passo 2.

## 8. Resíduos, se houver

**NÃO APLICÁVEL** nesta etapa. Se o passo 2 for executado e `REMANESCENTES_zz_probe` ou `INVENTARIO_DEPOIS_IGUAL_ANTES` saírem `INCOMPATIVEL` (código de saída 3), **não faça limpeza manual antes de me mostrar o JSON** — o relatório C.3 traz o SQL de contingência restrito aos nomes `zz_probe_<id>_*` listados.

## 9. Impacto sobre as migrations

**Nenhum.** O modo write do probe não executa `prisma migrate`, não lê nem referencia as migrations históricas, e não toca `neondb`. As sete migrations continuam intactas (confirmado na seção 1).

## 10. Próxima etapa recomendada

1. Você roda o **passo 1** (pré-voo) e cola o JSON aqui.
2. Avalio o JSON e, se tudo estiver COMPROVADO, peço sua confirmação final para o **passo 2**.
3. Só com essa autorização explícita, você roda o passo 2 e cola o resultado — eu não executo nada por conta própria nesta sessão sem você rodar o comando no seu terminal, já que não tenho a credencial.
4. Depois de A–H avaliados: decidir sobre o gate `pg_stat_ssl` do RÚSTIKA (ainda incompatível com o Neon) antes de qualquer replay das sete migrations (3D.5.3-C.5, não iniciada) ou deploy no Render (3D.5.3-D, não iniciada).
