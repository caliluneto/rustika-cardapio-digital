# RELATÓRIO DE ENTREGA — Etapa 3D.3.28

**Preparação de histórico Git independente e seguro para publicação privada**
Projeto: RÚSTIKA — Cardápio Digital · Data: 2026-11-05

> Fora dos commits do repositório original. Nenhum valor de credencial aparece aqui.

## 1. Estratégia utilizada

1. `git archive HEAD` (com `core.autocrlf=false`, para exportar os bytes exatos dos blobs) extraído em pasta nova: só os 234 arquivos rastreados de `3b857ad`. Sem `.git`, sem commits/branches/tags/refs Cline/Codex, sem planilha, segredos, dumps, backups, ignorados ou relatórios não versionados. Não foi usado `clone`, `--mirror`, `filter-repo`, `filter-branch`, `reset` nem `clean`.
2. Comparação byte a byte (hash de blob) com `HEAD`.
3. Varredura de segredos no conteúdo exportado; **sanitização apenas na cópia** (valores sintéticos independentes; asserções preservadas).
4. Testes, typecheck, builds e validação do workflow **na cópia**.
5. `git init` na cópia (já provado fora de qualquer repositório) e um único commit inicial, depois de snapshot validado.

## 2. Local da cópia isolada

`C:\Users\u1n3c\RustikaPublish\cardapio-digital-snapshot` — fora do OneDrive e fora do repositório original (antes do `git init`, `git rev-parse --show-toplevel` falhou: nenhum repositório pai).

## 3. Arquivos exportados

234 arquivos (todos os rastreados em `3b857ad`), incluindo `backend/` (src, prisma e migrações, scripts, testes, fixtures sintéticas, docs), `frontend/`, `.github/` (workflow e `ci/*`), `.gitignore`, `.gitattributes`, `README.md`. `node_modules` foi copiado do original **apenas** para rodar os testes e fica ignorado pelo Git (não entra no commit).

## 4. Conferência de hashes

Exportação vs `git ls-tree -r HEAD`: 234 = 234 caminhos, **hashes de blob idênticos**. (Uma primeira extração, feita com `autocrlf=true`, gerou CRLF e hashes diferentes; foi descartada e refeita.)

## 5. Resultado da varredura de segredos

| Verificação (234 arquivos) | Antes da sanitização | Depois |
|---|---|---|
| Senha de 8 caracteres (3 roles) | 0 | 0 |
| Senha de 26 caracteres (fixtures) | 0 | 0 |
| Valor de 6 caracteres / prefixo sensível | **5 linhas em 4 testes** (confirma que exportar só `HEAD` **não** o eliminava) | **0** |
| Chave privada / token | 0 | 0 |
| URL PostgreSQL com credencial literal | 9 arquivos | 9 (todos placeholders/mocks: senhas "palavra" de 4–31 caracteres, `127.0.0.1`/`localhost`/`host`, usuários `fake`, `secret`, `usuario`, `disabled`; nenhuma coincide com segredo real) |
| Nome de usuário local nos arquivos | 9 | 2 (mocks de diretório temporário `...\Temp\opencode` em dois `.ps1` de laboratório; risco desprezível) |
| Nomes proibidos (`.env`, dump, backup, `.xlsx`, `Calil-Notebook`, `secrets/`) | 0 | 0 |

## 6. Diferenças entre snapshot e origem

Exatamente **11 arquivos** diferem de `HEAD` (confirmado por hash):

- **4 testes** com o valor sensível trocado por sintético (sem reutilizar nenhum valor real, nem prefixo/substring): `frontend/tests/checkout.test.mjs` (senha do login mock, nas duas ocorrências, mesmo valor), `backend/tests/domain/rules.test.ts`, `frontend/tests/cart.test.mjs`, `frontend/tests/order-review.test.mjs` (substituição de 6 dígitos por 6 dígitos, mesmo comprimento).
- **7 documentos** `.md` com o caminho local `C:\Users\<nome>\` trocado por `C:\Users\<USUARIO>\`: `README.md`, `RELATORIO-ENTREGA-3D.3.16.md`, `backend/docs/{e2e-real,fixture-role,integration-db,restore-backup,rf004-onda-2.3d2b-executor-baseline}.md`.

O repositório original não recebeu nenhuma dessas mudanças.

## 7. Testes executados (na cópia, sem PostgreSQL/migrations/seeds/Playwright)

- Backend unitário (`npm run test:ci`): 35 arquivos passaram, 1 ignorado; **746 passaram, 7 ignorados** (os 7 exigem a planilha privada, ausente na cópia).
- Frontend (`npm test`): **99/99**.
- Typecheck backend (`tsc --noEmit`): **0 erros** (os 2 erros do arquivo legado local não existem na cópia).
- Builds backend e frontend: OK.
- `ci.yml`: YAML válido; 23 blocos `run` aprovados em `bash -n`; 0 `uses:` sem SHA; 0 `secrets.*`; o teste `ci-config` faz parte dos 746.
- Auditoria de arquivos (nomes proibidos: 0) e de conteúdo (tabela da seção 5).

## 8. Segurança do histórico independente

- 1 commit: `68b0cc5edcefbd5a6c1cd348cc617fb746d6df1c` — `chore: initial public-safe snapshot of Rustika Cardapio Digital`, branch `main`, 234 arquivos, árvore limpa após o commit.
- Nenhum objeto do original: os commits `3b857ad`, `b8dd15a`, `96cbfa3` e `a39247b` **não existem** no novo repositório. 1 ref, 0 tags, **0 remotes**, nenhum push.
- Varredura de todo o histórico novo (`git log -p --all`, incluindo mensagem): 0 ocorrências das 3 senhas reais.
- Configuração local do commit: `core.autocrlf=false` (blobs LF, como no original), identidade do autor igual à do original.
- Avisos de espaço em branco do `git diff --cached --check` vêm de conteúdo já existente no original (ex.: SQL de migração, que não deve ser reformatado).

## 9. Estado do repositório original

`main`; HEAD `3b857ad` com `b8dd15a` e `96cbfa3` inalterados; 82 refs (hash agregado das refs de ferramenta igual ao anterior); 0 remotes; 0 tags; stage vazio; os mesmos 5 arquivos modificados preexistentes; planilha privada intacta (18254 bytes). Nenhuma credencial, role, banco ou `.env` tocado; nenhuma conexão PostgreSQL.

## 10. Riscos remanescentes

1. **As senhas em uso continuam fracas** (8 dígitos numéricos, compartilhadas por 3 roles) e a de shadow (6 dígitos) continua inconsistente; a cópia não resolve isso. Como o valor de 6 não está mais em nenhum lugar publicável, o prefixo deixa de ser exposto, mas a rotação continua recomendada (3D.3.27) e é independente desta publicação.
2. Os 7 testes da planilha real ficam ignorados em qualquer clone (comportamento desejado).
3. **Arquivos de higiene herdados** (rastreados desde commits antigos, mantidos para não alterar o snapshot): `$testRunner` (6 bytes), 4 `manifest*.txt` vazios, `manifest-3d315-pathspec.txt`, `Check-HealthProject.ps1`, `RELATORIO-ENTREGA-3D.3.15/3.16.md`. Sem segredos, mas convém decidir se vão ao repositório público/privado.
4. Menções ao nome de usuário local em 2 scripts `.ps1` (mocks de pasta temporária).
5. Itens já conhecidos e não validados em ambiente real: runner do GitHub, download do `xlsx` pelo CDN no Node 22/npm 10, PostgreSQL efêmero e Playwright.
6. A cópia contém `node_modules`/`dist` não versionados (ignorados); não devem ser copiados para fora.
7. Divergência intencional entre o histórico novo e o original: hashes e relatórios anteriores (3D.3.x) não mapeiam para o repositório novo.

## 11. Procedimento futuro de publicação (não executado; exige autorização)

1. Decidir sobre os arquivos de higiene (item 3 acima) e, idealmente, rotacionar as senhas antes de qualquer uso fora do notebook.
2. No GitHub, criar repositório **privado e vazio** (sem README/licença).
3. Na cópia (nunca no repositório original): conferir `git log` (1 commit) e `git status` limpo; `git remote add origin <URL>`.
4. `git push --no-tags -u origin main:main`; depois `git ls-remote --heads --tags origin` (só `refs/heads/main`).
5. Primeira execução do workflow: apenas jobs backend/frontend (`run_e2e=false`); o E2E exige autorização própria.
6. Nunca publicar o diretório do repositório original, nem `refs/cline/*`/`refs/codex/*`.

## 12. Parecer final

**Cópia independente criada, auditada e testada: PRONTA PARA FUTURA PUBLICAÇÃO PRIVADA, sujeita à autorização do usuário.** Snapshot idêntico a `HEAD` exceto 11 arquivos sanitizados; histórico novo com 1 commit sem objetos do original e sem segredos; testes/builds/workflow aprovados. Nenhum remote criado, nenhum push, nenhum workflow executado, nenhuma credencial alterada, nenhum PostgreSQL tocado e repositório original preservado.
