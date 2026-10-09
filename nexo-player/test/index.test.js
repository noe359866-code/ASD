import { test } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';
import { stubFetch } from '../testkit/fetch-stub.mjs';

const ENV = { UPSTREAM_RETRIES: '0' };
const call = (path, env = ENV) =>
  worker.fetch(new Request(`https://addon.test${path}`), env, undefined);

test('un ID con % mal formado responde 400, no 500', async () => {
  const res = await call('/stream/movie/%E0%A4%A.json');
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.deepEqual(body.streams, []);
  assert.match(body.error, /inválido/);
});

test('un fallo transitorio del origen no se cachea (Cache-Control: no-store)', async (t) => {
  const stub = stubFetch(() => ({ status: 503, body: 'down' }));
  t.after(stub.restore);

  const res = await call('/stream/movie/tt1234567.json');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const body = await res.json();
  assert.deepEqual(body, { streams: [], error: 'Fallo consultando el origen' });
});

test('un 403 del origen (bloqueo) devuelve el error controlado, sin reintentos', async (t) => {
  const stub = stubFetch(() => ({ status: 403, body: 'Acceso Bloqueado' }));
  t.after(stub.restore);

  const res = await call('/stream/series/tt1844624%3A1%3A1.json', { UPSTREAM_RETRIES: '2' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).error, 'Fallo consultando el origen');
  assert.equal(stub.calls.length, 1);
});
