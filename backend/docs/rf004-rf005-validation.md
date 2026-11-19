# RF004/RF005 — validação local no Windows

Este procedimento valida o frontend e as rotas mockadas sem conectar a um banco. Execute em um PowerShell normal, fora do sandbox que bloqueia o loopback com `EACCES`. Não usa Neon, seeds, migrations ou deploy.

```powershell
Set-Location 'C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\frontend'
npm test
if ($LASTEXITCODE -ne 0) { throw 'Testes frontend falharam.' }
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Typecheck frontend falhou.' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build frontend falhou.' }

Set-Location '..\backend'
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Typecheck backend falhou.' }
& .\node_modules\.bin\vitest.cmd run --config vitest.unit.config.mts tests/access.test.ts tests/orders.test.ts tests/order-admin.test.ts --maxWorkers=1
if ($LASTEXITCODE -ne 0) { throw 'Testes HTTP mockados falharam.' }
```

Se o Vitest receber `EPERM` ao renomear arquivos temporários, defina `$env:TEMP` e `$env:TMP` para uma pasta vazia criada sob `backend/` nesta sessão, repita somente o último comando e remova a pasta depois de confirmar seu caminho absoluto. `EACCES 127.0.0.1` significa que o ambiente impediu o Supertest de abrir uma porta local; não é uma resposta da aplicação nem prova de falha das rotas.

## Validação real ainda pendente

O [E2E com PostgreSQL Test](e2e-real.md) cobre login por e-mail/senha, convite, resgate da comanda, `POST /api/orders`, total calculado no servidor, confirmação com número, pedido no painel, logout, rota protegida e novo login. Seu setup **escreve fixtures sintéticas e o teardown as remove** em `cardapio_digital_test` local; por isso não foi executado nesta etapa e depende de autorização específica para esse banco. O arquivo `frontend/playwright.config.ts` exige `RUSTIKA_E2E_CONFIRM` antes de subir servidores. Não apontar esse teste para Neon.

Na homologação definitiva, o banco precisa conter catálogo público com produtos `AVAILABLE` e um admin criado por bootstrap autorizado. O build deve usar `VITE_CATALOG_MODE=api` e `VITE_ORDER_SUBMISSION=enabled`; a API deve estar em `/api` na mesma origem, ou `VITE_API_URL` deve apontar para a API correta. O backend deve ter `CORS_ORIGIN` **exatamente** igual à origem do navegador, pois todas as escritas exigem `Origin` exata, JSON e `X-Rustika-Request: 1`. Verificar cookies seguros, TLS, prontidão da API, `POST` 201, total, número, persistência e visibilidade no painel antes de considerar RF004/RF005 completos.
