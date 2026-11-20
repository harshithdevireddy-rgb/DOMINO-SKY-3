import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { loadEnv } from 'vite';
import { handleDispatch } from './server/dispatchHandler.ts';

/** Mounts the same serverless handler used on Vercel at /api/dispatch during `vite dev` / `vite preview`. */
function devApi(env: Record<string, string>): Plugin {
  const mount = (server: { middlewares: { use: (p: string, fn: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void) => void } }) => {
    server.middlewares.use('/api/dispatch', (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end(JSON.stringify({ error: 'method_not_allowed' }));
        return;
      }
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', async () => {
        let body: unknown = null;
        try { body = JSON.parse(raw); } catch { /* handled below */ }
        const out = await handleDispatch(body, env);
        res.statusCode = out.status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(out.body));
      });
    });
  };
  return { name: 'domino-dev-api', configureServer: mount, configurePreviewServer: mount };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss(), devApi(env)],
    resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
    test: { environment: 'node', include: ['src/tests/**/*.test.ts'] },
  };
});
