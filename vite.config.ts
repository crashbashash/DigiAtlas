import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

const DATA_DIR = resolve(process.env.DIGIATLAS_DATA ?? 'data/generated/ps2');
const TYPES: Record<string, string> = { '.json': 'application/json', '.png': 'image/png' };

/** Serves the exporter's output folder at /data during development (the desktop app reads it natively). */
function exportedData(): Plugin {
  return {
    name: 'digiatlas-data',
    configureServer(server) {
      server.middlewares.use('/data', (req, res, next) => {
        const rel = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^([/\\])+/, '');
        const file = join(DATA_DIR, rel);
        if (rel.startsWith('..') || !file.startsWith(DATA_DIR) || !existsSync(file) || !statSync(file).isFile()) {
          next();
          return;
        }
        res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  clearScreen: false,
  plugins: [exportedData()],
  server: { port: 5175, strictPort: true },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
  test: { include: ['src/**/*.test.ts'] },
});
