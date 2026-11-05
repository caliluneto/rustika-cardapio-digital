# RF004 2.3D.2B.4 — executor após auditoria independente

Esta revisão corrige os oito achados altos/médios da auditoria 2.3D.2B.3 e a explicação documental de atomicidade. O executor existente é backend/scripts/Invoke-Rf004InitialLab.ps1. Não autoriza deploy. A próxima etapa admissível é inspeção supervisionada **somente leitura**, autorizada separadamente.

## Contrato preservado

- Allowlist exclusiva: rf004_lab_pos_20261027_01 e rf004_lab_neg_20261027_01.
- DryRun padrão: arquivos locais, sem criar staging, chamar subprocessos ou conectar.
- Execute exige confirmação literal e SHA-256 aprovado externamente. Hash calculado no teste não é aprovação operacional.
- Staging novo em C:\Users\<USUARIO>\AppData\Local\Temp\opencode, com config e package.json controlados e apenas 20261023000000_initial_schema.
- Sem segunda migration, geração de cliente, retry, reset, concessão de privilégios ou limpeza automática. Staging preservado após sua criação.
- migration.sql e schema.prisma não foram alterados nesta revisão. DEV, TEST e SHADOW não são destinos.

    & '.\backend\scripts\Invoke-Rf004InitialLab.ps1' -Lab 'rf004_lab_pos_20261027_01' -DryRun

## Correções por achado

| Achado | Correção efetiva |
| --- | --- |
| Autenticação psql/CONIN$ | psql -X -w, sem prompt, recebe PGPASSWORD somente no ambiente privado do filho; PGPASSFILE aponta para arquivo inexistente. Não usa stdin para senha. Exige cliente 18.6 por --version antes de solicitar o segredo. |
| ACL por coluna | pg_attribute.attacl/aclexplode rejeitam não proprietários; has_any_column_privilege verifica SELECT/INSERT/UPDATE/REFERENCES das duas aplicações. Mantém inspeção de ACL de tabela. |
| Memberships/SET ROLE | Pre/postflight exigem as aplicações, percorrem pg_auth_members transitivamente com UNION e recusam qualquer caminho ao migrator, inclusive sem INHERIT/SET. Também verificam pg_has_role com MEMBER/USAGE/SET. |
| Morte do supervisor | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE configurado antes do Start; TerminateJobObject permanece no finally. Tipo Rf004ProcessGuardB4 evita reutilizar o guard antigo carregado numa sessão. |
| Estrutura | Manifesto estático de 60 colunas: 52 de domínio e 8 do histórico. Compara posição, nome, OID do tipo, typmod, NOT NULL e default. FULL JOIN recusa extras/ausentes/removidas; identity/generated inesperados são recusados. PK do histórico recebe a mesma validação das PKs de domínio. |
| Representação SQL | SET LOCAL search_path = pg_catalog, public e quote_all_identifiers = off nas duas transações. Defaults, PKs e índices são comparados nessa sessão normalizada. |
| Ancestrais do staging | Caminho local absoluto, pai/nome controlados; inspeção de cima para baixo de todos os ancestrais antes da criação e novamente na validação. Junctions/reparse points recusados, incluindo arquivos internos. |
| Diagnóstico | Códigos RF004 e fase segura, sem publicar exceção externa, senha, URL ou saídas brutas. Distinção entre falhas de processo, catálogo, hash, versão e staging. |

Memberships são tratados conservadoramente: mesmo um caminho atualmente desativado é recusado. Roles alcançáveis com SUPERUSER/CREATEROLE/REPLICATION/BYPASSRLS, acesso global a dados/manutenção ou arquivos/programas do servidor também são recusadas. O script não modifica roles ou privilégios.

## Autenticação e segredos

A estratégia final não depende de simple_prompt, CONIN$, CONOUT$ ou stdin. CreateNoWindow evita janelas, mas não garante transporte da senha. O ensaio com o cliente instalado apresentou timeout da alternativa -W/stdin mesmo sem janela; ela foi descartada.

**Restrição funcional:** senha de 1 a 256 caracteres ASCII imprimíveis (U+0020–U+007E), incluindo espaços e símbolos. Vazio, controles, excesso de tamanho e Unicode são recusados antes de conectar. O ensaio Unicode no ambiente do cliente Windows não preservou os bytes esperados. O executor não altera credenciais reais. Caso a credencial autorizada não satisfaça essa restrição, interromper e revisar o mecanismo em outra etapa.

PGPASSWORD é atribuído somente ao ProcessStartInfo do psql, após limpar o ambiente herdado. Prisma recebe DATABASE_URL escapada e SHADOW_DATABASE_URL controlada em seu próprio ambiente, sem PGPASSWORD. A configuração de ambiente é limpa em finally; o PowerShell pai não recebe a senha em variável de ambiente. Nenhum segredo vai para argv ou arquivos.

Ambiente de processo não é um cofre: processos da mesma identidade, administradores e dumps podem expor segredos. Strings gerenciadas não têm apagamento garantido; o BSTR é zerado/liberado. O custo de exposição transitória deve ser considerado na revisão operacional, assim como para a URL Prisma. Não preservar dumps com credenciais.

Referências: [prompt 18.6](https://raw.githubusercontent.com/postgres/postgres/REL_18_6/src/common/sprompt.c), [psql -w](https://www.postgresql.org/docs/18/app-psql.html), [libpq e ressalva sobre PGPASSWORD](https://www.postgresql.org/docs/18/libpq-envars.html).

## SQL e Prisma

Pre/postflight usam BEGIN TRANSACTION READ ONLY, SET LOCAL e ROLLBACK. Mantêm identidade de banco/usuário/host/porta, versão 180006, ownership, direitos necessários, vazio inicial, default ACLs de tabelas e inventário esperado. Postflight exige uma linha concluída do histórico, checksum aprovado, seis tabelas de domínio, cinco FKs, cinco CHECKs, sete PKs, 20 índices, enum de quatro valores e sequência SERIAL vinculada. Constraints relevantes devem estar validadas/enforced; NOT NULL não validado também é recusado.

O manifesto de colunas é independente do schema posterior. Não é introspecção genérica de todos os objetos possíveis: o inventário não substitui revisão de triggers, policies, atributos de roles e demais condições reais. As consultas não foram executadas contra PostgreSQL nesta etapa.

CLI local Prisma 6.19.3 usa migrate deploy, --schema e --config explícitos, com cwd no staging. O config e o marcador package.json delimitam o lookup; não há datasource alternativo. O schema usa as duas variáveis controladas. Config carregado de arquivo faz o CLI 6.19.3 pular o carregamento automático de .env. A suíte verifica a API real de resolução em processo com ambiente isolado.

Migrate deploy aplica os SQLs disponíveis, não gera um delta para todo o schema posterior. A inicial pode ser aplicada isoladamente; isso não torna o banco inicial compatível com endpoints/PrismaClient posteriores. SHADOW_DATABASE_URL aponta para 127.0.0.1:1/no_shadow, sem pressupor que a porta seja inacessível. Esse fluxo de deploy não usa shadow para gerar/detectar diferenças.

## Atomicidade e falhas

O engine nativo correspondente ao commit declarado pelos pacotes locais (c2990dca591cba766e3b7ef5d9e8a84796e47ab7) envia o script inteiro por simple_query(script). No PostgreSQL, múltiplas instruções nessa mensagem, sem divisões explícitas, executam em transação implícita. Ausência de BEGIN/COMMIT não prova DDL parcial da inicial em caso de erro SQL.

O fluxo completo não é uma transação única: criação/registro de _prisma_migrations, aplicação do script, registro de conclusão e postflight são etapas distintas. Pode haver histórico incompleto, commit com resposta perdida ou falha de postflight/hash depois do commit. O executor não desfaz o que já foi confirmado. Encerrar clientes não comprova término da sessão do servidor nem rollback.

Preservar staging/laboratório e inspecionar antes de outra autorização. Não repetir deploy automaticamente. Identidade física do servidor e recuperação exigem evidência independente.

Referências: [engine nativo](https://raw.githubusercontent.com/prisma/prisma-engines/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/schema-engine/connectors/sql-schema-connector/src/flavour/postgres/connector/native/mod.rs), [transação de Simple Query](https://www.postgresql.org/docs/18/protocol-flow.html#PROTOCOL-FLOW-MULTI-STATEMENT).

## Diagnósticos seguros

| Código ou família | Interpretação |
| --- | --- |
| RF004_PROCESS_TIMEOUT / RF004_PROCESS_OUTPUT_LIMIT / RF004_PROCESS_PIPE | Tempo, volume somado ou pipes. |
| RF004_JOB_CREATE / RF004_JOB_LIMITS / RF004_JOB_ASSIGN / RF004_JOB_TERMINATE | Falha na proteção Windows. |
| RF004_PSQL_EXIT / RF004_PRISMA_EXIT | Filho terminou com falha; saída bruta omitida. |
| RF004_CATALOG_REJECTED / RF004_CATALOG_OUTPUT | Resultado falso ou formato diferente de t/f. A fase distingue pre/post; não identifica cada predicado individualmente. |
| RF004_SOURCE_HASH / RF004_STAGING_HASH / RF004_HASH_REQUIRED | Hash ausente/inválido ou divergente. |
| RF004_STAGING_* | Caminho, reparse point, conteúdo, config, schema, lock ou pgpass inesperado. |
| RF004_PRISMA_VERSION / RF004_PSQL_VERSION | Versão local incompatível. |
| RF004_PASSWORD_FORMAT / RF004_CONFIRMATION / RF004_MODE | Entrada local recusada. |
| RF004_SOURCE_MISSING / RF004_UNEXPECTED | Arquivo ausente ou falha não classificada, sem detalhes externos. |

Pipes drenados em paralelo. Psql: 30 s/4 KiB; Prisma: 180 s/1 MiB. O monitor começa após Start/associação; inicialização e espera limitada de encerramento podem acrescentar tempo. Não é limite absoluto da função inteira.

## Testes offline

    & '.\backend\scripts\Test-Rf004InitialLab.Offline.ps1'

A suíte usa senha fictícia e processos temporários. PsqlPath permite indicar o cliente; padrão C:\Program Files\PostgreSQL\18\bin\psql.exe, versão 18.6 obrigatória no ensaio. O executor operacional continua descobrindo psql.exe/node.exe pelo PATH; conferir caminhos e procedência antes de uso real.

- Parser PowerShell 5.1, DryRun padrão nos dois labs, recusa de banco protegido/hash divergente/formato de senha.
- Mocks de sucesso, preflight falso, deploy falho, postflight falso e psql com exit não zero; ordem de chamadas e ausência de segredos nas saídas.
- Timeout, excesso de saída e descendentes, com código esperado.
- Kill do PowerShell supervisor, verificando encerramento de filho e neto fictícios por handles próprios.
- Junction real somente na raiz temporária da suíte, recusada como ancestral; diretório normal aceito.
- Inspeção estática de ACL por coluna, memberships/SET ROLE, sessão normalizada e manifesto de 60 colunas, confrontado com as colunas da migration inicial.
- API real @prisma/config, sem deploy ou conexão.
- Cliente real psql 18.6 com -w contra listener fictício em loopback/porta efêmera própria. O listener valida usuário/banco fictícios, pede senha fictícia e fecha sem AuthenticationOk: nenhum SQL é aceito. Testa ASCII simples e espaços/símbolos. SSL/GSS são desabilitados somente nesse ensaio; perfis/passfile apontam para o diretório fictício.

Esse ensaio comprova transporte da senha no cliente/Windows testado, não autenticação SCRAM/TLS, ACLs, catálogos, migration ou comportamento do servidor PostgreSQL. Mocks/inspeção estática não comprovam SQL real. Artefatos são preservados. Falha de infraestrutura, inclusive bloqueio do Controle de Aplicativo do Windows, reprova a execução da suíte e não deve ser ignorada ou contornada.

### Resultado desta revisão — 28/10/2026

Execução final da suíte no PowerShell 5.1: **exit code 0**, todos os grupos acima aprovados. Artefatos preservados em C:\Users\<USUARIO>\AppData\Local\Temp\opencode\rf004_mock_e1f269a72daf4c88811a4dd9e30b4667. Tentativas anteriores revelaram timeout de -W/stdin, incompatibilidade Unicode e um bloqueio de carregamento de assembly pelo Controle de Aplicativo; não foram contabilizadas como aprovações. Nenhuma política de segurança foi desabilitada. A suíte final foi executada integralmente após as correções.

SHA-256 antes/depois, idênticos (identificação, **não aprovação operacional**):

- Migration inicial: 1A9CD08B9D49FA9F70EABCCEAA4A696F5AEE07555F6A88562EC789340F0D3983.
- schema.prisma: 8231D63706F61A56C7ED4C146D734A3A461B002AAD88431C0EE1703056CD4A8C.

Parecer desta revisão: **APTO para avançar à inspeção supervisionada somente leitura**. Isso não autoriza Execute e não atesta o estado real dos laboratórios.

## Riscos restantes e próximo passo

- Conexões separadas: nome/IP/porta não fixam identidade física. Confirmar serviço e impedir troca entre conexões.
- Hash/reparse são verificações pontuais; não travam arquivos/ancestrais. Há TOCTOU e possibilidade de alteração seguida de restauração entre verificações. Controlar escritores e ACLs; verificação posterior não desfaz execução anterior.
- O filho inicia antes de ser associado ao job. Binário hostil pode gerar descendente nessa janela. KILL_ON_JOB_CLOSE protege processos já associados; não elimina a janela. Binários confiáveis/integridade do host continuam obrigatórios.
- Timeout do cliente não comprova término do trabalho no servidor. Não repetir automaticamente.
- Senha ASCII é restrição funcional; segredos permanecem transitoriamente em memória/ambiente. Não há proteção contra administrador/mesma identidade comprometida.
- Política conservadora de roles pode rejeitar memberships sem acesso imediato. Investigar, sem ampliar privilégios para fazer o teste passar.
- Inspeção real somente leitura ainda deve verificar identidade física, roles, ACLs, configurações e valores dos catálogos. Nenhum Execute está autorizado.
