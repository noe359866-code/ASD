import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractTitle, findAllM3u8, extractM3u8 } from '../src/extract.js';
import { embedPage, MOVIE_PAGE, MOVIE_STREAM_URL } from '../testkit/fixtures.mjs';

test('extractTitle: usa og:title y descodifica entidades', () => {
  assert.equal(extractTitle(MOVIE_PAGE, 'fallback'), 'El Señor de los Anillos');
});

test('extractTitle: quita el sufijo "| UnlimPlay"', () => {
  const html = '<meta property="og:title" content="Dune | UnlimPlay">';
  assert.equal(extractTitle(html, 'x'), 'Dune');
});

test('extractTitle: quita el sufijo "- Ver online"', () => {
  const html = '<html><head><title>Oppenheimer - Ver online</title></head></html>';
  assert.equal(extractTitle(html, 'x'), 'Oppenheimer');
});

test('extractTitle: acepta el orden invertido de atributos en la meta', () => {
  const html = '<meta content="Coco" property="og:title">';
  assert.equal(extractTitle(html, 'x'), 'Coco');
});

test('extractTitle: twitter:title como tercera opción', () => {
  const html = '<meta name="twitter:title" content="Up">';
  assert.equal(extractTitle(html, 'x'), 'Up');
});

test('extractTitle: cae al fallback si no hay nada útil', () => {
  assert.equal(extractTitle('<html></html>', 'Película tt123'), 'Película tt123');
  assert.equal(extractTitle('', 'fallback'), 'fallback');
  assert.equal(extractTitle(null, 'fallback'), 'fallback');
});

test('extractTitle: si el título queda vacío tras limpiar, usa el fallback', () => {
  const html = '<title>| UnlimPlay</title>';
  assert.equal(extractTitle(html, 'FB'), 'FB');
});

test('findAllM3u8: descarta los escapes y encuentra la URL completa con query', () => {
  const all = findAllM3u8(MOVIE_PAGE);
  assert.deepEqual(all, [MOVIE_STREAM_URL]);
});

test('findAllM3u8: deduplica y prioriza las que parecen master', () => {
  const html = [
    'var a = "https:\\/\\/cdn.test\\/seg\\/chunk.m3u8";',
    'var b = "https:\\/\\/cdn.test\\/hls\\/master.m3u8";',
    'var c = "https:\\/\\/cdn.test\\/seg\\/chunk.m3u8";',
  ].join('\n');

  assert.deepEqual(findAllM3u8(html), [
    'https://cdn.test/hls/master.m3u8',
    'https://cdn.test/seg/chunk.m3u8',
  ]);
});

test('findAllM3u8: devuelve [] cuando no hay flujos', () => {
  assert.deepEqual(findAllM3u8('<html><p>nada</p></html>'), []);
  assert.equal(extractM3u8('<html></html>'), null);
});

test('findAllM3u8: no se traga comillas ni paréntesis del HTML', () => {
  const html = 'src="https://cdn.test/a.m3u8" data-x="1"';
  assert.deepEqual(findAllM3u8(html), ['https://cdn.test/a.m3u8']);
});

test('embedPage: la fixture produce HTML con el flujo escapado', () => {
  const html = embedPage({ title: 'Test', m3u8: ['https://x.test/a.m3u8?p=1&q=2'] });
  assert.match(html, /https:\\\/\\\/x\.test\\\/a\.m3u8\?p=1\\u0026q=2/);
  assert.deepEqual(findAllM3u8(html), ['https://x.test/a.m3u8?p=1&q=2']);
});
