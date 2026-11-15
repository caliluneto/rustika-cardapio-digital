import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { RequestHandler, Router } from 'express';

/**
 * Serve o build do Vite (`frontend/dist`) na mesma origem da API.
 *
 * Montado DEPOIS de todas as rotas `/api` e ANTES do `notFound`:
 *  - qualquer caminho `/api…` (inclusive desconhecido) nunca chega aqui: segue para o 404 JSON;
 *  - não há *fallback* de SPA: o roteamento do frontend é por hash (`#admin`), então só `/` devolve `index.html` e um
 *    caminho inexistente continua sendo 404 (nunca HTML com status 200);
 *  - somente GET/HEAD; dotfiles, mapas de código e extensões de chave/segredo nunca são servidos;
 *  - a raiz é exclusivamente a pasta de saída do frontend (nenhum outro diretório do repositório fica exposto).
 */
const API_PATH = /^\/api(?:[/?#]|$)/i;
const BLOCKED_FILE = /(?:\.map|\.env|\.pem|\.key|\.crt|\.p12|\.sql|\.log)$/i;
const IMMUTABLE_PREFIX = /^\/assets\//;

export class FrontendBuildMissingError extends Error {
  constructor() { super('Build do frontend ausente (index.html não encontrado em frontend/dist). Rode o build do frontend.'); this.name = 'FrontendBuildMissingError'; }
}

/**
 * `privateCache`: com o portão ativo, o conteúdo é autenticado; `public` permitiria a um cache compartilhado reutilizá-lo sem
 * credencial (RFC 9111 §3.5), então as respostas passam a `private`.
 */
export function createStaticFrontend(rootDir: string, options: { privateCache?: boolean } = {}): Router {
  const scope = options.privateCache ? 'private' : 'public';
  const root = path.resolve(rootDir);
  const indexFile = path.join(root, 'index.html');
  if (!fs.existsSync(indexFile) || !fs.statSync(indexFile).isFile()) throw new FrontendBuildMissingError();

  const router = express.Router();

  /** Decide se a requisição é do frontend estático. Testa o caminho DECODIFICADO (evita `x.%6dap`). */
  const eligible = (request: express.Request): boolean => {
    if ((request.method !== 'GET' && request.method !== 'HEAD') || API_PATH.test(request.originalUrl)) return false;
    let decoded: string;
    try { decoded = decodeURIComponent(request.path); } catch { return false; }
    return !BLOCKED_FILE.test(decoded) && !decoded.includes('\0');
  };

  const guard: RequestHandler = (request, response, next) => {
    if (!eligible(request)) { next(); return; }
    response.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  };
  router.use(guard);

  const sendIndex: RequestHandler = (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-cache');
    // `root` + nome relativo: só o caminho relativo é avaliado por `dotfiles` (um diretório com ponto acima da raiz não bloqueia).
    response.sendFile('index.html', { root, dotfiles: 'deny' }, (error) => { if (error) next(error); });
  };
  router.get('/', (request, response, next) => (eligible(request) ? sendIndex(request, response, next) : next()));

  router.use((request, response, next) => {
    if (!eligible(request)) { next(); return; }
    express.static(root, {
      dotfiles: 'ignore', index: false, redirect: false, fallthrough: true, extensions: false,
      setHeaders: (res, filePath) => {
        const relative = `/${path.relative(root, filePath).split(path.sep).join('/')}`;
        if (relative === '/index.html') res.setHeader('Cache-Control', 'no-cache');
        else if (IMMUTABLE_PREFIX.test(relative)) res.setHeader('Cache-Control', `${scope}, max-age=31536000, immutable`);
        else res.setHeader('Cache-Control', `${scope}, max-age=3600`);
      },
    })(request, response, next);
  });

  return router;
}
