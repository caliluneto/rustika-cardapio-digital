import { Router } from 'express';
import { openApiDocument } from '../openapi/document';

const docsHtml = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RÚSTIKA API</title><style>
body{font:16px system-ui,sans-serif;max-width:1100px;margin:0 auto;padding:2rem;color:#241b16;background:#fffaf5}h1{margin-bottom:.25rem}
.route{background:#fff;border:1px solid #decfc3;border-radius:8px;margin:.75rem 0;padding:1rem}.method{font-weight:700;color:#7c321c;margin-right:.75rem}
code{background:#f2e8df;padding:.15rem .35rem;border-radius:4px}small{color:#65564d}</style></head>
<body><h1>RÚSTIKA API</h1><p id="intro">Carregando contrato local...</p><main id="routes"></main>
<script>'use strict';fetch('/api/openapi.json',{credentials:'same-origin'}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(function(spec){
document.getElementById('intro').textContent=spec.info.description;var root=document.getElementById('routes');
Object.keys(spec.paths).forEach(function(path){Object.keys(spec.paths[path]).forEach(function(method){var op=spec.paths[path][method];var article=document.createElement('article');article.className='route';
var title=document.createElement('div');var verb=document.createElement('span');verb.className='method';verb.textContent=method.toUpperCase();title.appendChild(verb);var code=document.createElement('code');code.textContent='/api'+path;title.appendChild(code);article.appendChild(title);
var summary=document.createElement('p');summary.textContent=op.summary||'';article.appendChild(summary);var tag=document.createElement('small');tag.textContent=(op.tags||[]).join(', ');article.appendChild(tag);root.appendChild(article)})})
}).catch(function(){document.getElementById('intro').textContent='Não foi possível carregar o contrato.'});</script></body></html>`;

export const docsRouter = Router();

docsRouter.get('/openapi.json', (_request, response) => {
  response.set('Cache-Control', 'no-store').json(openApiDocument);
});

docsRouter.get('/docs', (_request, response) => {
  response
    .set('Cache-Control', 'no-store')
    .set('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'")
    .type('html')
    .send(docsHtml);
});
