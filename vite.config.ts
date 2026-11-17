import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const MAX_BODY = 64 * 1024;

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Request body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

/** Serves POST /api/resolve from the dev and preview servers. The Anthropic SDK is loaded only when a request arrives. */
function resolveApi(): Plugin {
  let root = process.cwd();
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url !== '/api/resolve') return next();
    const send = (status: number, json: unknown) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(json));
    };
    if (req.method !== 'POST') return send(405, { error: 'Use POST.' });
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      return send(400, { error: 'Malformed request.' });
    }
    if (!process.env.ANTHROPIC_API_KEY) return send(503, { error: 'Set ANTHROPIC_API_KEY on the server to enable Claude suggestions.' });
    try {
      // Imported at request time from the project root, so the config bundle never needs the SDK.
      const mod = (await import(/* @vite-ignore */ pathToFileURL(join(root, 'server', 'resolve.ts')).href)) as typeof import('./server/resolve.ts');
      const { handleResolve } = mod;
      const out = await handleResolve(body);
      send(out.status, out.json);
    } catch (e) {
      console.error(e);
      send(500, { error: 'The suggestion service failed. Check the server log.' });
    }
  };
  return {
    name: 'bidlevel-resolve-api',
    configResolved: (config) => {
      root = config.root;
    },
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  };
}

export default defineConfig({
  plugins: [react(), resolveApi()],
});
