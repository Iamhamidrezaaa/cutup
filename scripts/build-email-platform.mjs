/**
 * Bundle React Email templates + email service layer for Vercel API runtime.
 * Output: api/email-platform/index.js
 */
import * as esbuild from 'esbuild';
import { mkdirSync, writeFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outfile = join(root, 'api', 'email-platform', 'index.js');

mkdirSync(dirname(outfile), { recursive: true });

await esbuild.build({
  entryPoints: [join(root, 'services', 'email', 'runtime-entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  packages: 'bundle',
  external: [
    'resend',
    'nodemailer',
    'pg',
    'react',
    'react-dom',
    '../../api/email-platform/send-log-bridge.js',
  ],
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
  jsx: 'automatic',
  target: 'node18',
  logLevel: 'info',
});

const stampPath = join(dirname(outfile), 'BUILD_STAMP.json');
const st = statSync(outfile);
writeFileSync(
  stampPath,
  JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      templateVersion: 'V3.1',
      bundleMtime: st.mtime.toISOString(),
      bundleSize: st.size,
      entry: 'services/email/runtime-entry.ts',
      outfile: 'api/email-platform/index.js',
    },
    null,
    2,
  ),
);

console.log('[build-email-platform] wrote', outfile);
console.log('[build-email-platform] wrote', stampPath);
