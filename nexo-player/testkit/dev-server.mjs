/**
 * Arranca el Worker REAL (workerd vía `wrangler dev`) para pruebas e2e.
 */

import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import path from 'node:path';

/** Puerto libre elegido por el SO. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');

/**
 * @param {object} o
 * @param {number} o.port
 * @param {Record<string,string>} [o.vars]  Sobrescritos con `--var`
 * @param {number} [o.timeoutMs]
 */
export async function startWorker({ port, vars = {}, timeoutMs = 90_000 }) {
  const args = ['dev', '--ip', '127.0.0.1', '--port', String(port), '--local'];
  for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);

  const bin =
    process.platform === 'win32'
      ? path.join(REPO_ROOT, 'node_modules', '.bin', 'wrangler.cmd')
      : path.join(REPO_ROOT, 'node_modules', '.bin', 'wrangler');

  const child = spawn(bin, args, {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });

  let out = '';
  child.stdout.on('data', (d) => {
    out += d;
  });
  child.stderr.on('data', (d) => {
    out += d;
  });

  const deadline = Date.now() + timeoutMs;
  while (!/Ready on/.test(out)) {
    if (child.exitCode !== null) {
      throw new Error(`wrangler dev terminó con código ${child.exitCode}\n${out}`);
    }
    if (Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error(`wrangler dev no arrancó en ${timeoutMs}ms\n${out}`);
    }
    await delay(250);
  }

  return {
    url: `http://127.0.0.1:${port}`,
    get output() {
      return out;
    },
    stop: () => {
      child.kill('SIGTERM');
    },
  };
}
