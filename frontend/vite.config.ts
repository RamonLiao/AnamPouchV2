import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const ENOKI_ZKP_URL = 'https://api.enoki.mystenlabs.com/v1/zklogin/zkp';

/**
 * Dev-only mirror of `api/zklogin/zkp.ts` (the Vercel serverless fn).
 * `vite dev` doesn't run Vercel functions, so without this the local
 * `/api/zklogin/zkp` 404s and zkLogin falls back to the public prover.
 */
function enokiZkpDevProxy(apiKey: string): Plugin {
  return {
    name: 'enoki-zkp-dev-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/zklogin/zkp', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }
        if (!apiKey) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'ENOKI_API_KEY is not configured' }));
          return;
        }
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', async () => {
          try {
            const { jwt, ephemeralPublicKey, maxEpoch, randomness, network = 'testnet' } =
              JSON.parse(raw || '{}');
            if (!jwt || !ephemeralPublicKey || maxEpoch === undefined || !randomness) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Missing jwt, ephemeralPublicKey, maxEpoch, or randomness' }));
              return;
            }
            const enokiRes = await fetch(ENOKI_ZKP_URL, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'zklogin-jwt': jwt,
              },
              body: JSON.stringify({
                network,
                ephemeralPublicKey,
                maxEpoch: Number(maxEpoch),
                randomness,
              }),
            });
            const text = await enokiRes.text();
            res.statusCode = enokiRes.ok ? 200 : enokiRes.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(enokiRes.ok ? text : JSON.stringify({ error: 'Enoki ZKP request failed', details: text }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(e) }));
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      react(),
      enokiZkpDevProxy(env.ENOKI_API_KEY ?? ''),
      {
        name: 'spa-rewrite',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url) {
              const url = req.url.split('?')[0] || '';
              if (url === '/patient' || url.startsWith('/patient/') ||
                  url === '/doctor' || url.startsWith('/doctor/') ||
                  url === '/zklogin' || url.startsWith('/zklogin/')) {
                req.url = '/app.html' + (req.url.includes('?') ? '?' + req.url.split('?')[1] : '');
              }
            }
            next();
          });
        }
      }
    ],
    server: { port: 5173 },
    build: {
      target: 'es2022',
      rollupOptions: {
        input: {
          main: 'index.html',
          app: 'app.html',
        }
      }
    },
  };
});
