const orderStatuses = ['RECEIVED', 'IN_PREPARATION', 'READY', 'DELIVERED', 'CANCELLED'] as const;
const availabilityStates = ['UNKNOWN', 'AVAILABLE', 'UNAVAILABLE'] as const;

const success = (schema: unknown, description = 'Operação concluída.') => ({
  description,
  content: { 'application/json': { schema: { type: 'object', required: ['success', 'data'], properties: {
    success: { type: 'boolean', const: true }, data: schema,
  } } } },
});

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
});

const csrfHeader = {
  name: 'X-Rustika-Request', in: 'header', required: true,
  description: 'Cabeçalho anti-CSRF exigido em operações de escrita.',
  schema: { type: 'string', enum: ['1'] },
};

const idempotencyHeader = {
  name: 'Idempotency-Key', in: 'header', required: true,
  description: 'UUID v4 reutilizável somente para repetir exatamente o mesmo pedido.',
  schema: { type: 'string', format: 'uuid' },
};

const jsonBody = (schema: unknown) => ({ required: true, content: { 'application/json': { schema } } });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const parameterRef = (name: string) => ({ $ref: `#/components/parameters/${name}` });

/** Contrato HTTP versionado junto ao código. Não contém tokens, senhas nem exemplos de credenciais. */
export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'RÚSTIKA Cardápio Digital API',
    version: '1.0.0',
    description: 'Catálogo, sessões de comanda, pedidos e operações administrativas. Escritas exigem origem permitida, Content-Type JSON e X-Rustika-Request: 1.',
  },
  servers: [{ url: '/api', description: 'Mesma origem da aplicação' }],
  tags: [
    { name: 'Catálogo' }, { name: 'Comanda' }, { name: 'Pedidos' },
    { name: 'Administração' }, { name: 'Produtos administrativos' },
  ],
  paths: {
    '/categories': {
      get: { tags: ['Catálogo'], summary: 'Listar categorias ativas', responses: {
        200: success({ type: 'array', items: ref('Category') }), 400: errorResponse('Parâmetros inválidos.'),
      } },
    },
    '/products': {
      get: { tags: ['Catálogo'], summary: 'Listar produtos ativos', parameters: [
        { name: 'categoryId', in: 'query', schema: { type: 'string' } },
        { name: 'availability', in: 'query', schema: { type: 'string', enum: availabilityStates } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 30 } },
        { name: 'cursor', in: 'query', schema: { type: 'string', pattern: '^rustika-[0-9A-Z]{1,64}$' } },
      ], responses: { 200: success(ref('ProductPage')), 400: errorResponse('Filtros inválidos.') } },
    },
    '/products/{productId}': {
      get: { tags: ['Catálogo'], summary: 'Consultar produto', parameters: [parameterRef('ProductIdParameter')], responses: {
        200: success(ref('Product')), 400: errorResponse('Identificador inválido.'), 404: errorResponse('Produto não encontrado.'),
      } },
    },
    '/comanda-sessions': {
      post: { tags: ['Comanda'], summary: 'Resgatar convite e iniciar sessão', parameters: [csrfHeader],
        requestBody: jsonBody({ type: 'object', additionalProperties: false, required: ['inviteToken'], properties: {
          inviteToken: { type: 'string', pattern: '^[0-9a-f]{64}$', writeOnly: true },
        } }), responses: { 201: success(ref('ComandaSession')), 400: errorResponse('Corpo inválido.'), 401: errorResponse('Convite inválido.'), 429: errorResponse('Limite excedido.') } },
    },
    '/comanda-sessions/current': {
      get: { tags: ['Comanda'], summary: 'Consultar sessão atual', security: [{ comandaCookie: [] }], responses: {
        200: success(ref('ComandaSession')), 401: errorResponse('Sessão ausente, expirada ou revogada.'),
      } },
    },
    '/orders': {
      post: { tags: ['Pedidos'], summary: 'Criar pedido', security: [{ comandaCookie: [] }], parameters: [csrfHeader, idempotencyHeader],
        requestBody: jsonBody(ref('CreateOrderInput')), responses: {
          200: success(ref('Order'), 'Repetição idempotente.'), 201: success(ref('Order'), 'Pedido criado.'),
          400: errorResponse('Entrada inválida.'), 401: errorResponse('Sessão inválida.'),
          409: errorResponse('Conflito de preço, disponibilidade ou idempotência.'), 422: errorResponse('Limites do pedido excedidos.'),
        } },
    },
    '/orders/{orderId}': {
      get: { tags: ['Pedidos'], summary: 'Acompanhar o próprio pedido', security: [{ comandaCookie: [] }],
        parameters: [parameterRef('OrderIdParameter')], responses: {
          200: success(ref('Order')), 400: errorResponse('Identificador inválido.'),
          401: errorResponse('Sessão inválida.'), 404: errorResponse('Pedido não encontrado para esta sessão.'),
        } },
    },
    '/admin/auth/login': {
      post: { tags: ['Administração'], summary: 'Autenticar administrador', parameters: [csrfHeader],
        requestBody: jsonBody({ type: 'object', additionalProperties: false, required: ['email', 'password'], properties: {
          email: { type: 'string', format: 'email', maxLength: 254 }, password: { type: 'string', writeOnly: true },
        } }), responses: { 200: success(ref('AdminSession')), 400: errorResponse('Entrada inválida.'), 401: errorResponse('Credenciais inválidas.'), 429: errorResponse('Limite excedido.') } },
    },
    '/admin/auth/session': {
      get: { tags: ['Administração'], summary: 'Consultar sessão administrativa', security: [{ adminCookie: [] }], responses: {
        200: success(ref('AdminSession')), 401: errorResponse('Sessão inválida.'),
      } },
    },
    '/admin/auth/logout': {
      post: { tags: ['Administração'], summary: 'Encerrar sessão administrativa', security: [{ adminCookie: [] }], parameters: [csrfHeader],
        requestBody: jsonBody({ type: 'object', additionalProperties: false }), responses: { 204: { description: 'Sessão encerrada.' }, 401: errorResponse('Sessão inválida.') } },
    },
    '/admin/comanda-invitations': {
      post: { tags: ['Administração'], summary: 'Emitir convite de comanda', security: [{ adminCookie: [] }], parameters: [csrfHeader],
        requestBody: jsonBody({ type: 'object', additionalProperties: false, required: ['comandaNumber'], properties: {
          comandaNumber: { type: 'string', pattern: '^\\d{1,6}$' }, expiresInMinutes: { type: 'integer', minimum: 1, maximum: 30, default: 10 },
        } }), responses: { 201: success(ref('ComandaInvitation')), 400: errorResponse('Entrada inválida.'), 401: errorResponse('Administrador não autenticado.'), 409: errorResponse('Comanda indisponível.') } },
    },
    '/admin/orders': {
      get: { tags: ['Administração'], summary: 'Listar pedidos para operação', security: [{ adminCookie: [] }], parameters: [
        { name: 'status', in: 'query', schema: { type: 'string', enum: orderStatuses } },
        { name: 'cursor', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 30 } },
      ], responses: { 200: success(ref('AdminOrderPage')), 400: errorResponse('Filtros inválidos.'), 401: errorResponse('Administrador não autenticado.') } },
    },
    '/admin/orders/{orderId}/status': {
      patch: { tags: ['Administração'], summary: 'Atualizar status com controle otimista', security: [{ adminCookie: [] }],
        parameters: [parameterRef('OrderIdParameter'), csrfHeader], requestBody: jsonBody({ type: 'object', additionalProperties: false,
          required: ['expectedStatus', 'toStatus'], properties: {
            expectedStatus: { type: 'string', enum: orderStatuses }, toStatus: { type: 'string', enum: orderStatuses },
            notes: { type: 'string', minLength: 1, maxLength: 300 },
          } }), responses: { 200: success({ type: 'object', required: ['order'], properties: { order: ref('AdminOrder') } }),
          400: errorResponse('Entrada inválida.'), 401: errorResponse('Administrador não autenticado.'),
          409: errorResponse('Status alterado concorrentemente.'), 422: errorResponse('Transição não permitida.') } },
    },
    '/admin/products': {
      get: { tags: ['Produtos administrativos'], summary: 'Listar produtos para administração', security: [{ adminCookie: [] }], responses: {
        200: success({ type: 'array', items: ref('AdminProduct') }), 401: errorResponse('Administrador não autenticado.'),
      } },
      post: { tags: ['Produtos administrativos'], summary: 'Criar produto', security: [{ adminCookie: [] }], parameters: [csrfHeader],
        requestBody: jsonBody(ref('ProductCreateInput')), responses: { 201: success(ref('ProductCrudResult')), 400: errorResponse('Entrada inválida.'), 401: errorResponse('Administrador não autenticado.'), 409: errorResponse('Conflito de produto.') } },
    },
    '/admin/products/{productId}': {
      patch: { tags: ['Produtos administrativos'], summary: 'Editar produto', security: [{ adminCookie: [] }], parameters: [parameterRef('ProductIdParameter'), csrfHeader],
        requestBody: jsonBody(ref('ProductUpdateInput')), responses: { 200: success(ref('ProductCrudResult')), 400: errorResponse('Entrada inválida.'), 401: errorResponse('Administrador não autenticado.'), 404: errorResponse('Produto não encontrado.') } },
      delete: { tags: ['Produtos administrativos'], summary: 'Excluir produto sem referências', security: [{ adminCookie: [] }], parameters: [parameterRef('ProductIdParameter'), csrfHeader], responses: {
        200: success(ref('ProductDeleteResult')), 400: errorResponse('Identificador inválido.'), 401: errorResponse('Administrador não autenticado.'),
        404: errorResponse('Produto não encontrado.'), 409: errorResponse('Produto referenciado por pedido.'),
      } },
    },
    '/admin/products/{productId}/availability': {
      patch: { tags: ['Produtos administrativos'], summary: 'Alterar disponibilidade com controle otimista', security: [{ adminCookie: [] }],
        parameters: [parameterRef('ProductIdParameter'), csrfHeader], requestBody: jsonBody({ type: 'object', additionalProperties: false,
          required: ['expectedState', 'toState'], properties: {
            expectedState: { type: 'string', enum: availabilityStates }, toState: { type: 'string', enum: availabilityStates },
          } }), responses: { 200: success(ref('AdminProduct')), 400: errorResponse('Entrada inválida.'), 401: errorResponse('Administrador não autenticado.'), 409: errorResponse('Estado alterado concorrentemente.') } },
    },
  },
  components: {
    securitySchemes: {
      adminCookie: { type: 'apiKey', in: 'cookie', name: 'rustika_admin', description: 'Cookie HttpOnly; o valor nunca é exposto pelo corpo da API.' },
      comandaCookie: { type: 'apiKey', in: 'cookie', name: 'rustika_session', description: 'Cookie HttpOnly vinculado à sessão de comanda.' },
    },
    parameters: {
      ProductIdParameter: { name: 'productId', in: 'path', required: true, schema: { type: 'string', pattern: '^rustika-[0-9A-Z]{1,64}$' } },
      OrderIdParameter: { name: 'orderId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    },
    schemas: {
      ErrorResponse: { type: 'object', required: ['success', 'error'], properties: {
        success: { type: 'boolean', const: false }, error: { type: 'object', required: ['code', 'message'], properties: {
          code: { type: 'string' }, message: { type: 'string' },
        } },
      } },
      Category: { type: 'object', required: ['id', 'name', 'description', 'displayOrder'], properties: {
        id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, displayOrder: { type: 'integer' },
      } },
      Product: { type: 'object', required: ['id', 'sourceCode', 'sourceName', 'sourceGroup', 'categoryId', 'name', 'priceInCents', 'isAvailable'], properties: {
        id: { type: 'string' }, sourceCode: { type: 'string' }, sourceName: { type: 'string' }, sourceGroup: { type: 'string' },
        categoryId: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, ingredients: { type: 'string' },
        priceInCents: { type: 'integer', minimum: 0 }, imageUrl: { type: 'string' }, imageAlt: { type: 'string' },
        isAvailable: { type: ['boolean', 'null'] },
      } },
      ProductPage: { type: 'object', required: ['items', 'nextCursor'], properties: {
        items: { type: 'array', items: ref('Product') }, nextCursor: { type: ['string', 'null'] },
      } },
      ComandaSession: { type: 'object', required: ['comanda', 'expiresAt'], properties: {
        comanda: { type: 'object', required: ['number', 'status'], properties: { number: { type: 'string' }, status: { type: 'string', enum: ['OPEN', 'CLOSED', 'CANCELLED'] } } },
        expiresAt: { type: 'string', format: 'date-time' },
      } },
      ComandaInvitation: { type: 'object', required: ['comanda', 'inviteToken', 'expiresAt'], properties: {
        comanda: { type: 'object', required: ['number'], properties: { number: { type: 'string' } } },
        inviteToken: { type: 'string', writeOnly: true }, expiresAt: { type: 'string', format: 'date-time' },
      } },
      CreateOrderInput: { type: 'object', additionalProperties: false, required: ['customerName', 'items'], properties: {
        customerName: { type: 'string', minLength: 2, maxLength: 120 }, customerPhone: { type: 'string', minLength: 7, maxLength: 25 },
        tableOrReference: { type: 'string', maxLength: 80 }, notes: { type: 'string', maxLength: 500 },
        items: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false,
          required: ['productId', 'quantity', 'expectedUnitPriceInCents'], properties: {
            productId: { type: 'string' }, quantity: { type: 'integer', minimum: 1 }, expectedUnitPriceInCents: { type: 'integer', minimum: 1 }, notes: { type: 'string' },
          } } },
      } },
      OrderItem: { type: 'object', required: ['productId', 'productNameSnapshot', 'unitPriceInCentsSnapshot', 'quantity', 'subtotalInCents'], properties: {
        productId: { type: 'string' }, productNameSnapshot: { type: 'string' }, unitPriceInCentsSnapshot: { type: 'integer' },
        quantity: { type: 'integer' }, subtotalInCents: { type: 'integer' }, notes: { type: 'string' },
      } },
      OrderHistory: { type: 'object', required: ['fromStatus', 'toStatus', 'createdAt'], properties: {
        fromStatus: { type: ['string', 'null'], enum: [null, ...orderStatuses] }, toStatus: { type: 'string', enum: orderStatuses }, createdAt: { type: 'string', format: 'date-time' },
      } },
      Order: { type: 'object', required: ['id', 'orderNumber', 'status', 'customerName', 'comandaNumber', 'totalInCents', 'createdAt', 'updatedAt', 'items', 'history'], properties: {
        id: { type: 'string', format: 'uuid' }, orderNumber: { type: 'integer' }, status: { type: 'string', enum: orderStatuses }, customerName: { type: ['string', 'null'] },
        comandaNumber: { type: 'string' }, totalInCents: { type: 'integer' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
        items: { type: 'array', items: ref('OrderItem') }, history: { type: 'array', items: ref('OrderHistory') },
      } },
      Admin: { type: 'object', required: ['id', 'name', 'email'], properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, email: { type: 'string', format: 'email' } } },
      AdminSession: { type: 'object', required: ['admin', 'expiresAt'], properties: { admin: ref('Admin'), expiresAt: { type: 'string', format: 'date-time' } } },
      AdminOrder: { allOf: [ref('Order'), { type: 'object', required: ['allowedTransitions'], properties: {
        tableOrReference: { type: ['string', 'null'] }, notes: { type: ['string', 'null'] }, allowedTransitions: { type: 'array', items: { type: 'string', enum: orderStatuses } },
      } }] },
      AdminOrderPage: { type: 'object', required: ['truncated', 'nextCursor', 'orders'], properties: {
        truncated: { type: 'boolean' }, nextCursor: { type: ['string', 'null'], format: 'uuid' }, orders: { type: 'array', items: ref('AdminOrder') },
      } },
      AdminProduct: { type: 'object', required: ['id', 'sourceCode', 'name', 'categoryId', 'categoryName', 'priceInCents', 'availabilityState', 'updatedAt'], properties: {
        id: { type: 'string' }, sourceCode: { type: 'string' }, name: { type: 'string' }, categoryId: { type: 'string' }, categoryName: { type: 'string' },
        priceInCents: { type: 'integer' }, availabilityState: { type: 'string', enum: availabilityStates }, updatedAt: { type: 'string', format: 'date-time' },
        description: { type: 'string' }, ingredients: { type: 'string' }, imageUrl: { type: 'string' }, imageAlt: { type: 'string' },
      } },
      ProductCreateInput: { type: 'object', additionalProperties: false, required: ['name', 'priceInCents', 'categoryId'], properties: {
        name: { type: 'string', minLength: 1 }, description: { type: ['string', 'null'] }, ingredients: { type: ['string', 'null'] },
        priceInCents: { type: 'integer', minimum: 1, maximum: 99999999 }, categoryId: { type: 'string' }, imageUrl: { type: ['string', 'null'] }, imageAlt: { type: ['string', 'null'] },
      } },
      ProductUpdateInput: { type: 'object', additionalProperties: false, properties: {
        name: { type: 'string', minLength: 1 }, description: { type: ['string', 'null'] }, ingredients: { type: ['string', 'null'] },
        priceInCents: { type: 'integer', minimum: 1, maximum: 99999999 }, imageUrl: { type: ['string', 'null'] }, imageAlt: { type: ['string', 'null'] },
      } },
      ProductCrudResult: { type: 'object', required: ['id', 'publicKey', 'sourceCode', 'sourceName', 'sourceGroup', 'name', 'priceInCents', 'categoryId', 'categoryName'], properties: {
        id: { type: 'string' }, publicKey: { type: 'string' }, sourceCode: { type: 'string' }, sourceName: { type: 'string' }, sourceGroup: { type: 'string' },
        name: { type: 'string' }, priceInCents: { type: 'integer' }, categoryId: { type: 'string' }, categoryName: { type: 'string' },
      } },
      ProductDeleteResult: { type: 'object', required: ['deleted'], properties: { deleted: { type: 'boolean' }, reason: { type: 'string' }, message: { type: 'string' } } },
    },
  },
} as const;
