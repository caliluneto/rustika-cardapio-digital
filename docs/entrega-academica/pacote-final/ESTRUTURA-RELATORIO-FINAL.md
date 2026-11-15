# Estrutura do relatório acadêmico final

**Relatório-base:** [`../RELATORIO-FINAL.md`](../RELATORIO-FINAL.md)  
**Regra:** preservar todo o conteúdo técnico já preenchido. Este documento apenas mapeia a estrutura, o que está
pronto e o que depende de informação humana. Não reescrever resultados, datas, hashes ou contagens sem nova evidência.

## 1. Estrutura atual (preservar)

| Seção | Conteúdo já preenchido | Situação | O que falta |
| --- | --- | --- | --- |
| Capa | Curso, disciplina, projeto, cidade/ano | Parcial | Nomes completos, códigos acadêmicos e docente |
| 1. Contextualização | Problema, escopo, stack, segurança, resumo da validação de 14/11/2026, pedidos preservados | Pronto | Dados comerciais do estabelecimento, se a rubrica exigir |
| 2. Resultado do desenvolvimento | Banco/migrations, RF006, jornada RF004/005/007/008/009, RF008 detalhado, encerramento dos dados, incidente do #1, testes e segurança | Pronto | Nada técnico; conferir apenas ortografia |
| 3. Termo de consentimento | Minuta com campos em branco | Pendente | Modelo oficial do professor, dados reais e assinatura |
| 4. Links da entrega | Repositório e commits publicados | Parcial | Link do vídeo e forma de acesso do avaliador |
| 5. Foto do cardápio físico | Placeholder | Pendente | Foto autorizada, legenda, data e crédito |
| 6. Avaliação do proprietário | Sete perguntas objetivas | Pendente | Respostas, nome, função, data e assinatura |
| 7. Pendências e autorizações | Ressalvas de RF002/RF007/RF008/RF009, materiais humanos, publicação segura, backup/ambientes | Pronto | Atualizar somente se algo mudar de estado |

## 2. Ordem de montagem sugerida

1. **Capa** — preencher integrantes, códigos e docente com os dados reais da matrícula.
2. **Seções 1 e 2** — manter como estão; revisar apenas português, pontuação e numeração.
3. **Seção 3** — substituir a minuta pelo termo oficial, preencher, assinar e digitalizar em PDF.
4. **Seção 4** — inserir o link do vídeo após upload e teste em janela anônima; registrar a decisão de acesso ao
   repositório.
5. **Seção 5** — inserir a foto autorizada com legenda “Cardápio físico do RÚSTIKA — foto de [data], crédito
   [autor]”.
6. **Seção 6** — imprimir, colher respostas e assinatura do proprietário/responsável e digitalizar.
7. **Seção 7** — revisar se as pendências listadas ainda correspondem à realidade após a gravação.
8. **Anexos** — adicionar evidências, termo, questionário e foto conforme [`MANIFESTO-ARQUIVOS.md`](MANIFESTO-ARQUIVOS.md).
9. **Exportação** — gerar PDF/DOCX no formato exigido, revisar ortografia e paginação e preservar uma cópia.

## 3. Conteúdo que não deve ser reescrito

Os trechos abaixo foram verificados em 14/11/2026 e devem ser mantidos, salvo nova evidência:

- Pedido **#5**: comanda `000126`, `TESTE_RF004_PEDIDO` ×1, total **R$ 1,00**, `DELIVERED`, histórico com quatro
  entradas.
- Pedidos **#1–#4** preservados: #1 `CANCELLED`; #2–#4 `DELIVERED`.
- Produto **`TESTE_RF004_PEDIDO`**: `UNAVAILABLE`, fora do catálogo público, identidade preservada.
- Testes: backend **1.237 aprovados / 9 ignorados**; frontend **174/174**; typecheck e builds aprovados.
- `secrets:audit`: **`POLICY_OK`**, exit 0, 7 segredos conformes.
- Banco: `cardapio_digital_dev`, PostgreSQL 18.6, **9/9 migrations** na validação documentada.
- Commits publicados: `435c3d4`, `902c3b9`, `1d71979` e `1e49371` (organização final); `origin/main` sincronizado.
- RF008: quatro transições observadas sem F5, com captura final e registro de horários; capturas intermediárias
  fora de enquadramento não são prova de estado.
- RF009: OpenAPI 3.1 em `/api/openapi.json`; `/api/docs` é índice próprio, não Swagger UI clássico.

## 4. Dados humanos a inserir

- [ ] Nome completo e código acadêmico de cada integrante.
- [ ] Nome do docente responsável.
- [ ] Dados do estabelecimento exigidos pela rubrica (razão social, endereço, responsável, contato).
- [ ] Termo de consentimento oficial, preenchido e assinado.
- [ ] Questionário da seção 6 respondido e assinado.
- [ ] Foto autorizada do cardápio físico.
- [ ] Link do vídeo, testado em janela anônima.
- [ ] Forma de acesso do avaliador ao repositório privado.

Nenhum desses campos deve ser preenchido com suposição, exemplo ou assinatura simulada.

## 5. Checklist de revisão antes de exportar

- [ ] Todos os `[PENDENTE]` foram substituídos por informação real.
- [ ] Nenhuma senha, token, cookie, connection string ou hash de sessão aparece no texto ou nos anexos.
- [ ] As contagens de teste e os hashes de commit conferem com [`CHECKLIST-FINAL.md`](CHECKLIST-FINAL.md).
- [ ] As ressalvas de RF002, RF007, RF008 e RF009 continuam explícitas.
- [ ] O sumário e a numeração de páginas correspondem ao PDF final.
- [ ] O arquivo exportado abre em outro computador e mantém imagens e acentuação.
- [ ] A versão final foi arquivada em local seguro, além do repositório.
