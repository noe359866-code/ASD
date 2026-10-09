/**
 * Modo demo: arranca el Worker real contra el origen falso, sin tocar la red.
 *
 *   npm run demo
 *
 * Útil para ver la página de instalación y las rutas /stream/* funcionando
 * cuando el origen real no está accesible o no quieres martillearlo.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startMockOrigin } from './mock-origin.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

const PORT = Number(process.env.PORT ?? 8787);
const IP = process.env.IP ?? '0.0.0.0';

const origin = await startMockOrigin();
console.log(`[demo] origen falso en ${origin.origin}`);

const bin =
  process.platform === 'win32'
    ? path.join(REPO_ROOT, 'node_modules', '.bin', 'wrangler.cmd')
    : path.join(REPO_ROOT, 'node_modules', '.bin', 'wrangler');

const child = spawn(
  bin,
  [
    'dev',
    '--ip', IP,
    '--port', String(PORT),
    '--local',
    '--var', `ORIGIN:${origin.origin}`,
    '--var', 'DEBUG:1',
  ],
  { cwd: REPO_ROOT, stdio: 'inherit' }
);

const shutdown = () => {
  child.kill('SIGTERM');
  origin.stop().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
child.on('exit', async (code) => {
  await origin.stop();
  process.exit(code ?? 0);
});
