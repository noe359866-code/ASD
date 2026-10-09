import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseMovieId,
  parseSeriesId,
  getMovieStreams,
  getSeriesStreams,
} from '../src/streams.js';
import { UpstreamError } from '../src/upstream.js';
import { resolveConfig } from '../src/config.js';
import { stubFetch } from '../testkit/fetch-stub.mjs';
import { embedPage, MOVIE_PAGE, MOVIE_STREAM_URL, MASTER_PLAYLIST } from '../testkit/fixtures.mjs';

const cfg = (over = {}) => resolveConfig({ UPSTREAM_RETRIES: '0', ...over });

const MOVIE_EMBED = 'https://unlimplay.com/f/embed/movie/tt1234567';

test('parseMovieId: acepta IMDb y TMDB', () => {
  assert.deepEqual(parseMovieId('tt1234567'), {
    ok: true,
    id: 'tt1234567',
    externalId: 'tt1234567',
    provider: 'imdb',
  });
  assert.deepEqual(parseMovieId('tt1234567.json'), {
    ok: true,
    id: 'tt1234567',
    externalId: 'tt1234567',
    provider: 'imdb',
  });
  assert.deepEqual(parseMovieId('tmdb:550'), {
    ok: true,
    id: 'tmdb:550',
    externalId: '550',
    provider: 'tmdb',
  });
  assert.deepEqual(parseMovieId('TMDB:550'), {
    ok: true,
    id: 'tmdb:550',
    externalId: '550',
    provider: 'tmdb',
  });
});

test('parseMovieId: rechaza cualquier cosa que pueda inyectar ruta', () => {
  for (const bad of [
    '',
    'abc',
    '../../etc/passwd',
    'tt123/../../admin',
    'tt123?x=1',
    'tt123#frag',
    'tt123 ',
    'tmdb:',
    'tt12345678901',
    'https://evil.test/x',
  ]) {
    const r = parseMovieId(bad);
    assert.equal(r.ok, false, `debería rechazar "${bad}"`);
  }
});

test('parseSeriesId: separa temporada y episodio', () => {
  assert.deepEqual(parseSeriesId('tt0903747:3:10'), {
    ok: true,
    id: 'tt0903747',
    externalId: 'tt0903747',
    provider: 'imdb',
    season: 3,
    episode: 10,
  });
  // El prefijo tmdb: es parte del ID: no puede perderse al partir por ":".
  assert.deepEqual(parseSeriesId('tmdb:1396:1:1.json'), {
    ok: true,
    id: 'tmdb:1396',
    externalId: '1396',
    provider: 'tmdb',
    season: 1,
    episode: 1,
  });
});

test('parseSeriesId: rechaza formatos rotos y fuera de rango', () => {
  for (const bad of ['tt123:1', 'tt123:0:1', 'tt123:1:0', 'tt123:1:1:1', 'x:1:1', '']) {
    assert.equal(parseSeriesId(bad).ok, false, `debería rechazar "${bad}"`);
  }
});

test('película feliz: desglosa las calidades del playlist master', async (t) => {
  const stub = stubFetch((url) =>
    url === MOVIE_EMBED
      ? { status: 200, body: MOVIE_PAGE }
      : { status: 200, body: MASTER_PLAYLIST }
  );
  t.after(stub.restore);

  const { streams } = await getMovieStreams('tt1234567.json', cfg());

  assert.equal(streams.length, 4, 'una variante por altura');
  assert.equal(streams[0].title, 'El Señor de los Anillos · 1080p · 9.0 Mbps [Nexo Player]');
  assert.equal(
    streams[0].url,
    'https://cdn.test-video.com/hls/abc123/1080p-high/index.m3u8'
  );
  assert.equal(streams[streams.length - 1].title, 'El Señor de los Anillos · 360p · 0.8 Mbps [Nexo Player]');
  assert.equal(streams[0].type, 'hls');
});

test('el stream lleva las cabeceras para el proxy de Stremio', async (t) => {
  const stub = stubFetch((url) =>
    url === MOVIE_EMBED ? { status: 200, body: MOVIE_PAGE } : { status: 200, body: MASTER_PLAYLIST }
  );
  t.after(stub.restore);

  const { streams } = await getMovieStreams('tt1234567', cfg());
  const hints = streams[0].behaviorHints;

  assert.equal(hints.notSupported, false);
  assert.equal(hints.proxyHeaders.request.Referer, 'https://unlimplay.com/');
  assert.match(hints.proxyHeaders.request['User-Agent'], /Mozilla\/5\.0/);
  // Clientes antiguos leen requestHeaders
  assert.deepEqual(hints.requestHeaders, hints.proxyHeaders.request);
});

test('MAX_STREAMS recorta la lista', async (t) => {
  const stub = stubFetch((url) =>
    url === MOVIE_EMBED ? { status: 200, body: MOVIE_PAGE } : { status: 200, body: MASTER_PLAYLIST }
  );
  t.after(stub.restore);

  const { streams } = await getMovieStreams('tt1234567', cfg({ MAX_STREAMS: '2' }));
  assert.equal(streams.length, 2);
});

test('si el playlist master no está disponible, devuelve un único stream', async (t) => {
  const stub = stubFetch((url) =>
    url === MOVIE_EMBED ? { status: 200, body: MOVIE_PAGE } : { status: 404, body: 'nope' }
  );
  t.after(stub.restore);

  const { streams, diagnostics } = await getMovieStreams('tt1234567', cfg());

  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, MOVIE_STREAM_URL);
  assert.equal(streams[0].title, 'El Señor de los Anillos [Nexo Player]');
  assert.match(diagnostics.steps.join(' | '), /playlist no disponible/);
});

test('si el HTML no trae .m3u8, devuelve streams vacío (no un error)', async (t) => {
  const stub = stubFetch(() => ({ status: 200, body: '<html><title>Nada</title></html>' }));
  t.after(stub.restore);

  const { streams, diagnostics } = await getMovieStreams('tt1234567', cfg());

  assert.deepEqual(streams, []);
  assert.equal(diagnostics.candidates.length, 0);
});

test('ID inválido: no se hace ni una sola petición al origen', async (t) => {
  const stub = stubFetch(() => {
    throw new Error('no debería llegar aquí');
  });
  t.after(stub.restore);

  const result = await getMovieStreams('../../admin', cfg());

  assert.equal(result.invalid, true);
  assert.deepEqual(result.streams, []);
  assert.match(result.error, /inválido/);
  assert.equal(stub.calls.length, 0);
});

test('serie: construye la URL de embed con temporada/episodio y etiqueta SxxExx', async (t) => {
  const page = embedPage({
    title: 'Breaking Bad | UnlimPlay',
    m3u8: ['https://cdn.test/s/master.m3u8'],
  });
  const stub = stubFetch((url) =>
    url.startsWith('https://unlimplay.com/f/embed/tv/')
      ? { status: 200, body: page }
      : { status: 200, body: MASTER_PLAYLIST }
  );
  t.after(stub.restore);

  const { streams } = await getSeriesStreams('tt0903747:3:10.json', cfg());

  assert.equal(
    stub.calls[0].url,
    'https://unlimplay.com/f/embed/tv/tt0903747/3/10'
  );
  assert.equal(streams[0].title, 'Breaking Bad S03E10 · 1080p · 9.0 Mbps [Nexo Player]');
});

test('IDs TMDB: el prefijo se quita al construir la URL del origen', async (t) => {
  const stub = stubFetch(() => ({ status: 200, body: '<html></html>' }));
  t.after(stub.restore);

  await getMovieStreams('tmdb:550', cfg());
  assert.equal(stub.calls[0].url, 'https://unlimplay.com/f/embed/movie/550');

  await getSeriesStreams('tmdb:1396:1:1', cfg());
  assert.equal(stub.calls[1].url, 'https://unlimplay.com/f/embed/tv/1396/1/1');
});

test('el origen caído (503): reintenta lo configurado y devuelve error transitorio', async (t) => {
  const stub = stubFetch(() => ({ status: 503, body: 'down' }));
  t.after(stub.restore);

  const result = await getMovieStreams('tt1234567', cfg({ UPSTREAM_RETRIES: '2' }));
  assert.deepEqual(result.streams, []);
  assert.equal(result.error, 'Fallo consultando el origen');
  assert.equal(result.transient, true);
  assert.deepEqual(result.diagnostics.steps, [
    'página no disponible (HTTP 503, HTTP 503, HTTP 503)',
  ]);
  assert.equal(stub.calls.length, 3, 'un intento inicial + dos reintentos');
});

test('un 404 del origen no se reintenta', async (t) => {
  const stub = stubFetch(() => ({ status: 404, body: 'nope' }));
  t.after(stub.restore);

  const result = await getMovieStreams('tt1234567', cfg({ UPSTREAM_RETRIES: '3' }));
  assert.equal(result.transient, true);
  assert.equal(stub.calls.length, 1, 'un 404 no se reintenta');
});

test('un 403 (bloqueo de seguridad) no se reintenta y no lanza excepción', async (t) => {
  const stub = stubFetch(() => ({ status: 403, body: 'Acceso Bloqueado' }));
  t.after(stub.restore);

  const result = await getSeriesStreams('tt1844624:1:1', cfg({ UPSTREAM_RETRIES: '2' }));
  assert.deepEqual(result.streams, []);
  assert.equal(result.error, 'Fallo consultando el origen');
  assert.equal(stub.calls.length, 1);
});

test('ORIGIN configurable: el embed se construye contra el origen indicado', async (t) => {
  const stub = stubFetch(() => ({ status: 200, body: '<html></html>' }));
  t.after(stub.restore);

  await getMovieStreams('tt9999999', cfg({ ORIGIN: 'https://otro.test/' }));

  assert.equal(stub.calls[0].url, 'https://otro.test/f/embed/movie/tt9999999');
  assert.equal(stub.calls[0].init.headers.Referer, 'https://otro.test/');
});
