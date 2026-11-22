# RÚSTIKA — Cardápio Digital

Aplicação web desenvolvida para o **Rústika Estúdio Bar**, em Ribeirão Preto (SP), como projeto da disciplina Prática Extensionista VII do curso de Engenharia da Computação da UNAERP.

O sistema reúne um cardápio digital organizado por categorias, carrinho de compras, envio e acompanhamento de pedidos e um painel administrativo para gestão dos produtos e do atendimento.

**Aplicação de demonstração:** https://rustika-homolog.onrender.com

> O ambiente publicado é de homologação e utiliza o plano gratuito do Render. O primeiro acesso após um período de inatividade pode demorar enquanto o serviço é iniciado. A disponibilidade e a aceitação de pedidos dependem da configuração dos produtos e das comandas.

## Funcionalidades

### Para clientes
- Consulta ao cardápio por categoria, com preços e detalhes dos produtos.
- Seleção de itens, ajuste de quantidades e revisão do carrinho.
- Envio de pedidos vinculados a uma sessão de comanda autorizada.
- Acompanhamento do estado do pedido, do recebimento à entrega.

### Para a administração
- Login protegido, manutenção de sessão e logout.
- Cadastro, edição e exclusão de produtos, respeitando vínculos com pedidos existentes.
- Controle de disponibilidade de itens.
- Gestão de categorias.
- Consulta e filtragem de pedidos, atualização de status e histórico das alterações.
- Atualização periódica da lista de pedidos.

## Tecnologias

| Camada | Tecnologias |
| --- | --- |
| Interface | React, TypeScript e Vite |
| API | Node.js, Express e TypeScript |
| Persistência | PostgreSQL e Prisma |
| Comunicação | HTTP e API REST |
| Hospedagem de homologação | Render (aplicação) e Neon (PostgreSQL) |

O frontend utiliza a API do backend para consultar o catálogo e executar as operações. Em homologação, ambos são servidos pela mesma origem HTTP.

## Estrutura do repositório

```text
.
├── frontend/                 # Interface do cliente e painel administrativo
├── backend/
│   ├── src/                  # API, serviços, regras de negócio e segurança
│   ├── prisma/               # Schema e migrations de desenvolvimento
│   ├── prisma-homolog/       # Migrations específicas da homologação
│   ├── config/               # Configurações e exemplos, sem credenciais reais
│   ├── docs/                 # Documentação técnica da API e da infraestrutura
│   ├── scripts/              # Ferramentas de validação e operação
│   └── tests/                # Testes automatizados
├── docs/entrega-academica/   # Relatório, matriz de requisitos e material de apresentação
└── render.yaml               # Configuração declarativa de implantação
```

## Execução local

**Requisitos:** Node.js 22, npm e acesso a uma instância PostgreSQL de desenvolvimento previamente configurada.

```bash
git clone https://github.com/caliluneto/rustika-cardapio-digital.git
cd rustika-cardapio-digital

cd backend
npm ci
npx prisma generate

cd ../frontend
npm ci
```

Configure o backend conforme os exemplos de `backend/config/` e `backend/.env.example`, usando apenas um **banco de desenvolvimento** e os perfis permitidos. Credenciais devem permanecer fora do Git; não utilize o banco de homologação para testes locais.

Execute a API e a interface em terminais separados:

```bash
# Terminal 1: na pasta backend
npm run dev

# Terminal 2: na pasta frontend
npm run dev
```

Por padrão, a interface utiliza `http://localhost:5173` e a API `http://localhost:4000/api`. Para a integração local, configure `VITE_API_URL=http://localhost:4000/api` e `VITE_CATALOG_MODE=api` no ambiente do frontend, conforme os exemplos do projeto.

**Observação:** a instalação das dependências não cria bancos, usuários nem administra migrations automaticamente. Consulte [Guia de execução](docs/entrega-academica/GUIA-EXECUCAO.md) e [Homologação](backend/docs/homologation-environment.md) para os pré-requisitos de cada ambiente.

## Testes e validação

```bash
# Backend
cd backend
npm run typecheck
npm run build
npm run test:ci

# Frontend (em outro terminal)
cd frontend
npm run typecheck
npm test
npm run build
```

Testes de integração com PostgreSQL exigem um ambiente isolado e configurado especificamente para essa finalidade; não os execute no Neon de homologação.

## API

Entre as rotas disponíveis estão:

| Método | Rota | Finalidade |
| --- | --- | --- |
| GET | `/api/health` | Saúde do processo |
| GET | `/api/ready` | Prontidão da aplicação e do banco |
| GET | `/api/categories` | Categorias do catálogo |
| GET | `/api/products` | Produtos do catálogo |
| GET | `/api/products/:productId` | Detalhes de um produto |
| POST | `/api/orders` | Registro de pedido autenticado por comanda |
| GET | `/api/orders/:orderId` | Acompanhamento do próprio pedido |
| POST | `/api/admin/auth/login` | Login administrativo |
| GET | `/api/admin/orders` | Listagem administrativa de pedidos |

A especificação OpenAPI está disponível em `/api/openapi.json` e o visualizador de rotas em `/api/docs` **no ambiente de desenvolvimento**. Essas rotas não são disponibilizadas pelo servidor no modo `production`. Consulte [Documentação da API](backend/docs/openapi.md) para mais detalhes.

## Origem do catálogo

Os produtos foram organizados a partir de materiais fornecidos pelo Rústika Estúdio Bar. O cardápio de referência orientou a identificação e a categorização dos itens; a versão eletrônica do estabelecimento foi consultada como referência de preços. Produtos inativos, insumos e itens ainda não classificados não devem ser publicados automaticamente no catálogo.

Informações não fornecidas pelo estabelecimento, como ingredientes, descrições e fotografias, não devem ser presumidas.

## Segurança e ambientes

A autenticação administrativa é independente do acesso ao catálogo público. A aplicação emprega sessões protegidas, validações de entrada, controles anti-CSRF, limites de requisição e perfis de banco com privilégios específicos.

O arquivo `render.yaml` descreve a hospedagem de homologação. As credenciais, os parâmetros de identidade do Neon e as demais variáveis sensíveis devem ser configurados diretamente no provedor, nunca versionados.

Antes de tornar o repositório público ou utilizar dados reais de clientes, revise a política de segredos, dependências e demais requisitos aplicáveis.
