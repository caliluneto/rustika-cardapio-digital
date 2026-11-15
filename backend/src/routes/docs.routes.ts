import express, { Router } from 'express';
import path from 'node:path';
import { openApiDocument } from '../openapi/document';

/**
 * Swagger UI é servido a partir de `swagger-ui-dist` (assets locais, sem CDN). A política de conteúdo
 * permite apenas scripts e estilos da própria origem; o inicializador é um arquivo servido por esta rota,
 * portanto não há script inline. O JSON OpenAPI continua disponível em `/api/openapi.json`.
 */
const swaggerAssetsDir = path.dirname(require.resolve('swagger-ui-dist/package.json'));

const initializer = `'use strict';
window.addEventListener('load', function () {
  window.ui = SwaggerUIBundle({
    url: '/api/openapi.json',
    dom_id: '#swagger-ui',
    deepLinking: true,
    displayRequestDuration: true,
    tryItOutEnabled: true,
    withCredentials: true,
    requestInterceptor: function (request) {
      var method = (request.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
        request.headers['X-Rustika-Request'] = '1';
      }
      return request;
    }
  });
});`;

const docsHtml = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RÚSTIKA API — Swagger UI</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="/api/docs/swagger-ui.css">
</head>
<body>
<div id="swagger-ui"></div>
<noscript>Ative o JavaScript para usar o Swagger UI.</noscript>
<script src="/api/docs/swagger-ui-bundle.js"></script>
<script src="/api/docs/swagger-initializer.js"></script>
</body>
</html>`;

const docsCsp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'";

export const docsRouter = Router();

docsRouter.get('/openapi.json', (_request, response) => {
  response.set('Cache-Control', 'no-store').json(openApiDocument);
});

docsRouter.get('/docs', (_request, response) => {
  response
    .set('Cache-Control', 'no-store')
    .set('Content-Security-Policy', docsCsp)
    .type('html')
    .send(docsHtml);
});

docsRouter.get('/docs/swagger-initializer.js', (_request, response) => {
  response
    .set('Cache-Control', 'no-store')
    .set('Content-Security-Policy', "default-src 'none'")
    .type('application/javascript')
    .send(initializer);
});

// Assets estáticos do Swagger UI: mesmos nomes de arquivo do pacote, servidos somente nesta rota.
docsRouter.use('/docs', express.static(swaggerAssetsDir, {
  index: false,
  maxAge: '1h',
}));
