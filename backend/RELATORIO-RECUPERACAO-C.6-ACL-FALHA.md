# Relatório de Recuperação C.6-FIX01 — ACL do banco de replay

- Data (UTC): 2026-11-08T19:28:49.226Z
- Modo: SOMENTE LEITURA (--check)
- Escopo: ACL do banco de replay; nenhuma role/banco é criado, renomeado ou removido.


## FALHA
- Erro: password authentication failed for user 'cardapio_migrator'
- Estado observado (somente leitura):
  - Bancos do projeto: cardapio_digital_test
  - Roles do projeto: cardapio_dev_app, cardapio_homolog_bootstrap, cardapio_migrator, cardapio_test_app, rustika_homolog_marker
  - Banco definitivo: ausente
  - Replay: cardapio_digital_test owner=cardapio_migrator allowconn=true connlimit=40 publicConnect=true publicTemp=true publicCreate=false

Status: FALHA — nenhuma escrita além da transação com ROLLBACK (quando aplicável).