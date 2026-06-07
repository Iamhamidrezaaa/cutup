import * as esbuild from 'esbuild';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outfile = join(root, 'api', 'notifications-service', 'index.js');

mkdirSync(dirname(outfile), { recursive: true });

await esbuild.build({
  entryPoints: [join(root, 'services', 'notifications', 'runtime-entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  packages: 'bundle',
  external: [
    'pg',
    '../../api/notifications-repository.js',
    '../../api/billing-repository.js',
  ],
  loader: { '.ts': 'ts' },
  target: 'node18',
  logLevel: 'info',
});

console.log('[build-notifications] wrote', outfile);
