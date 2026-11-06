# Provisionamento inicial — procedimento sujeito à aprovação humana

**Nenhuma conta é criada ao iniciar o backend, fazer login ou executar testes.**
Este documento prepara uma operação separada; não autoriza acesso ou escrita
no banco. Não existe senha padrão, seed ou endpoint público de criação de contas.

## Antes de executar

Obter aprovação explícita para banco de destino, nome/e-mail do administrador,
operador autorizado e criação de uma conta. Verificar schema, privilégios mínimos
e ausência de conta com o mesmo e-mail. Não substituir, reativar ou redefinir uma
conta existente automaticamente. Não executar essa operação com role de aplicação
elevada a migrator.

## Procedimento após aprovação específica

1. O titular escolhe senha exclusiva de 12–256 caracteres, guardada em gerenciador
   de senhas. Normalizar somente e-mail com trim/lowercase. Não enviar senha no chat.
2. Usar ferramenta local controlada fora do repositório/OneDrive com entrada de
   senha oculta. Não passar senha em argumentos, histórico de terminal, `.env`,
   logs, clipboard compartilhado ou arquivo de texto puro.
3. Gerar o hash com `hashPassword` de `src/security/password.ts`. Essa função usa
   scrypt/sal aleatório e não cria contas nem acessa banco. Encaminhar o resultado
   em memória à operação aprovada; não imprimir/versionar senha ou hash.
4. No destino aprovado, inserir Admin com nome, e-mail normalizado, passwordHash
   gerado e isActive=true. Usar Prisma/operação parametrizada, deixando UUID e
   datas a cargo de defaults/Prisma. Conflito de e-mail interrompe sem sobrescrever.
5. Encerrar a ferramenta e conferir login por HTTPS. Registrar aprovação, operador,
   destino e resultado sem credenciais/tokens/hashes. Entregar credenciais somente
   ao titular por canal seguro.

Não foi criado script operacional nesta entrega. A ferramenta com entrada oculta
deve ser preparada na etapa autorizada, sem criar uma via automática de escrita
no banco antes dessa aprovação.

## Contas anteriores

Formato suportado: `scrypt$v1$32768$8$3$<sal>$<hash>`. Contas reais não foram
inspecionadas. Outro algoritmo requer compatibilidade explícita ou redefinição
segura aprovada; não converter hashes automaticamente nem tratá-los como senha.
Troca de senha por Prisma deve atualizar `updatedAt`, invalidando as sessões
administrativas anteriores.

## Atualização 3D.5.2

A ferramenta com entrada oculta foi preparada (`npm run homolog:bootstrap-admin`) para o ambiente de homologação, com perfil, role e janela de bootstrap próprios. Veja `docs/homologation-environment.md`. Nenhuma conta foi criada e o procedimento ainda depende de autorização explícita.
