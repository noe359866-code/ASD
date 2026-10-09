/**
 * Prueba end-to-end: levanta el Worker REAL (workerd vía `wrangler dev`)
 * apuntando a un origen falso, y comprueba las rutas de verdad.
 *
 * Es la prueba más lenta del proyecto (~15 s) pero es la única que atraviesa
 * el mismo runtime que corre en Cloudflare, incluida la Cache API.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

import { startMockOrigin } from '../testkit/mock-origin.mjs';
import { startWorker, freePort } from '../testkit/dev-server.mjs';

let origin;
let worker;
let base;

before(async () => {
  origin = await startMockOrigin();
  const port = await freePort();
  worker = await startWorker({
    port,
    vars: {
      ORIGIN: origin.origin,
      DEBUG: '1',
      UPSTREAM_RETRIES: '0',
      UPSTREAM_TIMEOUT_MS: '5000',
      CACHE_TTL_SECONDS: '600',
      NEGATIVE_CACHE_TTL_SECONDS: '300',
    },
  });
  base = worker.url;
});

after(async () => {
  worker?.stop();
  await origin?.stop();
  await delay(300);
});

test('GET / devuelve la página de instalación con el deep link de Stremio', async () => {
  const res = await fetch(`${base}/`);
  const html = await res.text();

  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(html, /Nexo Player/);
  assert.match(html, /\/manifest\.json/);
  // Formato oficial del SDK: la URL del manifest con stremio:// en vez de https://
  assert.match(html, /stremio:\/\/127\.0\.0\.1:\d+\/manifest\.json/);
});

test('GET /health refleja la configuración activa', async () => {
  const res = await fetch(`${base}/health`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.origin, origin.origin, 'el --var ORIGIN llegó al worker');
  assert.equal(body.cacheTtlSeconds, 600);
  assert.equal(body.debug, true);
  assert.equal(body.version, '1.1.0');
});

test('GET /manifest.json cumple el protocolo de Stremio', async () => {
  const res = await fetch(`${base}/manifest.json`);
  const m = await res.json();

  assert.equal(res.status, 200);
  assert.equal(m.id, 'com.cf.nexoplayer.proxy');
  assert.deepEqual(m.types, ['movie', 'series']);
  assert.deepEqual(m.idPrefixes, ['tt', 'tmdb:']);
  assert.equal(m.resources[0].name, 'stream');
});

test('CORS: el preflight responde 204 con las cabeceras', async () => {
  const res = await fetch(`${base}/manifest.json`, { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('GET /stream/movie/{id}.json devuelve una variante por calidad', async () => {
  const res = await fetch(`${base}/stream/movie/tt1234567.json`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.streams.length, 4, `recibido: ${JSON.stringify(body.streams.map((s) => s.title))}`);
  assert.equal(res.headers.get('x-nexo-cache'), 'MISS');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(body.streams[0].title, /1080p/);
  assert.equal(body.streams[0].behaviorHints.proxyHeaders.request.Referer, `${origin.origin}/`);

  // El origen falso recibió la página de embed y luego el playlist.
  assert.ok(origin.hits.some((h) => h.startsWith('/f/embed/movie/tt1234567')));
  assert.ok(origin.hits.some((h) => h.startsWith('/hls/master')));
});

test('la segunda llamada sale de la Cache API', async () => {
  await delay(600); // cache.put corre en waitUntil
  const res = await fetch(`${base}/stream/movie/tt1234567.json`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-nexo-cache'), 'HIT');
  assert.equal((await res.json()).streams.length, 4);
});

test('?nocache=1 se salta la cache', async () => {
  const res = await fetch(`${base}/stream/movie/tt1234567.json?nocache=1`);
  assert.equal(res.headers.get('x-nexo-cache'), 'BYPASS');
});

test('?debug=1 incluye el diagnóstico cuando DEBUG está activo', async () => {
  const res = await fetch(`${base}/stream/movie/tt2222222.json?debug=1&nocache=1`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.ok(body.debug, 'falta el bloque debug');
  assert.match(body.debug.embedUrl, /\/f\/embed\/movie\/tt2222222$/);
  assert.equal(body.debug.variants, 4);
  assert.equal(body.debug.candidates.length, 1);
});

test('serie: etiqueta SxxExx en el título', async () => {
  const res = await fetch(`${base}/stream/series/tt0903747:3:10.json?nocache=1`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.match(body.streams[0].title, /S03E10/);
  assert.ok(origin.hits.some((h) => h.includes('/f/embed/tv/tt0903747/3/10')));
});

test('sin flujo en el origen: 200 con streams vacío, no un fallo', async () => {
  const res = await fetch(`${base}/stream/movie/tt0000000.json?nocache=1`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(body.streams, []);
});

test('playlist no disponible: degrada a un único stream', async () => {
  const res = await fetch(`${base}/stream/movie/tt0000001.json?nocache=1`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.streams.length, 1);
  assert.match(body.streams[0].title, /Sin variantes/);
});

test('origen caído: no revienta el worker', async () => {
  const res = await fetch(`${base}/stream/movie/tt0000002.json?nocache=1`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(body.streams, []);
  assert.match(body.error ?? '', /origen/i);
});

test('ID inválido: 400 y ninguna petición al origen', async () => {
  const before = origin.hits.length;
  const res = await fetch(`${base}/stream/movie/no-es-un-id.json`);
  const body = await res.json();

  assert.equal(res.status, 400);
  assert.deepEqual(body.streams, []);
  assert.match(body.error, /inválido/);
  assert.equal(origin.hits.length, before, 'no debería haber tocado el origen');
});

test('ruta desconocida: 404 en JSON', async () => {
  const res = await fetch(`${base}/no-existe`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Ruta no encontrada' });
});

test('el worker sobrevive a una ráfaga de peticiones', async () => {
  const ids = ['tt3000001', 'tt3000002', 'tt3000003', 'tt3000004', 'tt3000005'];
  const results = await Promise.all(
    ids.map((id) => fetch(`${base}/stream/movie/${id}.json?nocache=1`).then((r) => r.status))
  );
  assert.deepEqual(results, [200, 200, 200, 200, 200]);
});
