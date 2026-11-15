# Manifesto de arquivos para entrega ao professor

**Pacote:** `docs/entrega-academica/pacote-final/`  
**Repositório:** `https://github.com/caliluneto/rustika-cardapio-digital` · branch `main` — versão publicada mais recente  
**Regra:** o pacote referencia os documentos existentes; não duplica relatório, evidências ou código.

## 1. Estrutura sugerida da pasta de entrega

Criar uma pasta externa ao repositório, por exemplo `RUSTIKA-entrega-academica/`, com esta organização:

```
RUSTIKA-entrega-academica/
├── 01-relatorio/
│   ├── RELATORIO-FINAL.pdf
│   └── RELATORIO-FINAL.docx            (somente se a rubrica exigir)
├── 02-video/
│   └── RUSTIKA-demonstracao.mp4        (até 5:00)
├── 03-anexos/
│   ├── termo-consentimento-assinado.pdf
│   ├── questionario-proprietario-assinado.pdf
│   ├── autorizacao-uso-imagem.pdf
│   └── foto-cardapio-fisico.jpg
├── 04-evidencias/
│   ├── rf007-01-filtro-entregue.png
│   ├── rf008-01-tracking-final.png
│   ├── rf008-02-admin-delivered.png
│   ├── rf009-01-docs.png
│   └── README-RF008.md
├── 05-documentacao-tecnica/
│   ├── MATRIZ-REQUISITOS.md
│   ├── CHECKLIST-ENTREGA.md
│   ├── GUIA-EXECUCAO.md
│   └── ROTEIRO-VIDEO-5MIN.md
└── 06-repositorio.txt
```

> Documentos internos de apoio (`README.md`, `CHECKLIST-FINAL.md`, `DADOS-ESTABELECIMENTO.md`,
> `ESTRUTURA-RELATORIO-FINAL.md`, `GUIA-GRAVACAO-VIDEO.md` e este `MANIFESTO-ARQUIVOS.md`) permanecem no repositório
> e não integram a pasta entregue ao professor.

`06-repositorio.txt` deve conter apenas:

```
Repositório: https://github.com/caliluneto/rustika-cardapio-digital
Branch: main
Commit de referência: branch main — versão publicada mais recente
Acesso: [público ou convite nominal — preencher após decisão]
```

Não incluir token, senha, cookie ou convite de repositório no arquivo.

## 2. Origem de cada arquivo

| Arquivo de entrega | Origem no repositório | Situação |
| --- | --- | --- |
| `RELATORIO-FINAL.pdf/.docx` | `docs/entrega-academica/RELATORIO-FINAL.md` | Exportar após preencher campos humanos |
| `RUSTIKA-demonstracao.mp4` | ainda não existe | Gravar conforme o guia |
| `termo-consentimento-assinado.pdf` | modelo oficial + dados reais | Pendente |
| `questionario-proprietario-assinado.pdf` | seção 6 do relatório | Pendente |
| `autorizacao-uso-imagem.pdf` | modelo da disciplina | Pendente |
| `foto-cardapio-fisico.jpg` | foto autorizada | Pendente |
| `rf007-01-filtro-entregue.png` | `docs/entrega-academica/evidencias/` | Pronto |
| `rf008-01-tracking-final.png` | `docs/entrega-academica/evidencias/` | Pronto, com ressalva |
| `rf008-02-admin-delivered.png` | `docs/entrega-academica/evidencias/` | Pronto |
| `rf009-01-docs.png` | `docs/entrega-academica/evidencias/` | Pronto |
| `README-RF008.md` | `docs/entrega-academica/evidencias/` | Pronto |
| `MATRIZ-REQUISITOS.md` | `docs/entrega-academica/` | Pronto |
| `CHECKLIST-ENTREGA.md` | `docs/entrega-academica/` | Pronto |
| `GUIA-EXECUCAO.md` | `docs/entrega-academica/` | Pronto |
| `ROTEIRO-VIDEO-5MIN.md` | `docs/entrega-academica/` | Pronto |
| `06-repositorio.txt` | criado na entrega | Pendente da decisão de acesso |

## 3. O que NÃO incluir na pasta ou no commit

- `.env`, `.env.*`, arquivos de segredos e `backend/.env`.
- Dumps, backups `.dump`, `.bak`, `.bak2` e logs de teste.
- `_not-for-publication/` e qualquer material interno.
- Scripts locais não versionados em `backend/ops/homolog/` (provisionadores Neon, recuperação de ACL, replay de
  segredos e testes de credenciais) e em `backend/ops/homolog/sql/neon/`; os arquivos versionados de `ci/` e `sql/`
  fazem parte do repositório.
- `backend/scripts/Invoke-Rf006RestoreIsolatedTest.ps1` e scripts locais equivalentes.
- `node_modules/`, `dist/`, `coverage/`, caches e artefatos gerados.
- Cookies, tokens de convite, capturas de DevTools com headers, connection strings e hashes de sessão.
- Dados pessoais de clientes, notas fiscais ou informações bancárias.
- Capturas intermediárias do RF008 sem rótulo: elas estão em `evidencias/nao-utilizadas/` e não são prova de estado.

## 4. Evidências e rótulos obrigatórios

| Evidência | O que mostra | Rótulo ao apresentar |
| --- | --- | --- |
| `rf007-01-filtro-entregue.png` | filtro `ENTREGUE` e lista de pedidos | “Captura real de 14/11/2026” |
| `rf008-01-tracking-final.png` | estado final `Entregue` e histórico do #5 | “Captura real de 14/11/2026; transições observadas sem F5” |
| `rf008-02-admin-delivered.png` | painel com o #5 entregue | “Captura real de 14/11/2026” |
| `rf009-01-docs.png` | índice `/api/docs` | “Índice próprio sobre OpenAPI 3.1, não Swagger UI” |
| `nao-utilizadas/*.png` | capturas fora de enquadramento | Não usar como prova; identificar como descartadas |

## 5. Checklist de empacotamento

- [ ] Relatório exportado e revisado, sem `[PENDENTE]`.
- [ ] Vídeo com até 5:00, áudio audível e link testado.
- [ ] Termo, questionário e autorização assinados e digitalizados.
- [ ] Foto autorizada com legenda e crédito.
- [ ] Evidências com os rótulos da seção 4.
- [ ] `06-repositorio.txt` com URL, branch, commit e forma de acesso.
- [ ] Nenhum segredo, dump, backup ou dado pessoal indevido na pasta.
- [ ] Arquivo compactado abre em outro computador e mantém a estrutura.
- [ ] Cópia final preservada em local seguro, além do GitHub.

## 6. Separação entre GitHub e ambiente de entrega

| Conteúdo | GitHub | Pasta de entrega |
| --- | --- | --- |
| Código, docs e evidências | Sim | Sim, se a rubrica pedir |
| Relatório exportado | Opcional | Sim |
| Vídeo | Não | Sim |
| Termo, questionário e foto assinados | **Não** (dados pessoais) | Sim |
| Segredos, dumps e backups | **Não** | **Não** |
| `_not-for-publication/` e scripts locais | **Não** | **Não** |

O repositório permanece **privado** e nenhum deploy foi executado. A decisão de tornar público ou conceder acesso
nominal ao avaliador depende de autorização do proprietário e do grupo.
