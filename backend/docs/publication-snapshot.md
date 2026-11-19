# Publicação segura: repositório de desenvolvimento × snapshot publicado — 3D.3.30

## Situação

| | Repositório de desenvolvimento ("original") | Snapshot de publicação |
| --- | --- | --- |
| Local | pasta do projeto no OneDrive | pasta fora do OneDrive (`RustikaPublish\cardapio-digital-snapshot`) |
| Histórico | completo (inclui refs de ferramentas com credenciais reais em commits antigos) | independente, começa em um commit inicial sanitizado |
| Remote | **nenhum, nunca** | `origin` = GitHub privado |
| Papel | onde se desenvolve e se testa localmente | única origem de tudo que vai ao GitHub |

Os dois históricos **nunca são unidos**: sem `git merge`, `git pull`, `git fetch` entre eles, sem copiar `.git`, sem
adicionar o remote do GitHub ao original, sem `git push --all/--mirror`. Qualquer um desses atos pode levar credenciais
antigas ao GitHub.

## Fluxo recomendado (por entrega)

1. **Desenvolver no original**, em um commit local por entrega (histórico do original continua útil).
2. **Testar localmente sem escrita não autorizada:** `typecheck`, `build`, `test:ci` (backend), `npm test` (frontend).
   Testes com escrita em PostgreSQL só no CI efêmero.
3. **Revisar o diff** da entrega (`git diff <base>..HEAD --name-status`) e fixar a lista exata de arquivos.
4. **Transferir só esses arquivos** para o snapshot, copiando-os (nunca a pasta inteira, nunca `.git`). Registrar a lista.
5. **Sanitizar e verificar os arquivos transferidos:** varredura de segredos (senhas reais carregadas só em memória,
   chaves, tokens, URLs com credencial), nomes proibidos (`.env`, planilha, dumps, backups, cópias `*-Calil-Notebook*`),
   caminhos locais do usuário em documentação, valores que coincidam com segredos reais (substituir por sintéticos).
6. **Rodar no snapshot** `typecheck`, `build`, `test:ci`, testes do frontend e validação do workflow.
7. **Commit no snapshot** (mensagem própria; sem `--amend` do que já foi publicado).
8. **Push exclusivo** de `main`: `git push --no-tags origin main:main` (sem `--force`, `--all`, `--mirror`).
9. **Disparar os workflows no GitHub** (backend/frontend; E2E só com `run_e2e=true`) e registrar o resultado.

## Regras de divergência

- Correções feitas **diretamente no snapshot** (como as de CI da 3D.3.29: contexto `runner` e saída estruturada do
  `e2e:inspect`) devem ser **portadas de volta** ao original na entrega seguinte, senão a próxima transferência as
  sobrescreve ou o original fica defasado. Manter uma lista "snapshot → original" em cada relatório.
- Arquivos que existem só no original (relatórios locais, scripts legados, planilha, cópias de conflito do OneDrive)
  **não** são transferidos.
- Se um arquivo transferido contiver valor sensível, a sanitização acontece **na cópia do snapshot**, nunca no original;
  registre a substituição para repeti-la na próxima transferência.

## Riscos

| Risco | Mitigação |
| --- | --- |
| Copiar arquivo com credencial/valor sensível | passo 5 obrigatório antes do commit |
| Copiar pasta inteira ou `.git` | transferir só a lista de arquivos do diff |
| Divergência entre os dois códigos | portar correções do snapshot ao original; comparar `git ls-tree`/hashes por arquivo antes do push |
| Push errado (remote no repositório original) | o original não tem remote; conferir `git remote -v` antes de cada push |
| Falso conforto de "CI verde" | CI cobre testes unitários e uma jornada E2E; não equivale a prontidão para produção |

## Não faz parte deste procedimento

Sincronização automática, scripts que copiem arquivos sozinhos, mesclagem de históricos e publicação do histórico
completo. Se um dia for necessário, exige decisão própria (limpeza do histórico e rotação de credenciais antes).
