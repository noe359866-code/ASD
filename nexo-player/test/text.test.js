import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeEntities, unescapeSource, collapseWhitespace } from '../src/text.js';

test('decodeEntities: entidades numéricas decimales y hexadecimales', () => {
  assert.equal(decodeEntities('El Se&#241;or'), 'El Señor');
  assert.equal(decodeEntities('&#x41;&#x42;'), 'AB');
  assert.equal(decodeEntities('&#x1F600;'), '😀');
});

test('decodeEntities: entidades con nombre', () => {
  assert.equal(decodeEntities('&quot;hola&quot;'), '"hola"');
  assert.equal(decodeEntities('a&amp;b'), 'a&b');
  assert.equal(decodeEntities('a&nbsp;b'), 'a b');
  assert.equal(decodeEntities('&lt;b&gt;'), '<b>');
  assert.equal(decodeEntities('it&#39;s'), "it's");
  // &amp; va el último: &amp;amp; -> &amp; (un solo paso)
  assert.equal(decodeEntities('&amp;amp;'), '&amp;');
});

test('decodeEntities: no explota con códigos inválidos', () => {
  // Fuera del rango de Unicode: String.fromCodePoint lanzaría, lo atrapamos.
  assert.equal(decodeEntities('&#999999999999;'), '');
  // "ZZZZ" no es hexadecimal: el regex no lo toca y queda intacto.
  assert.equal(decodeEntities('&#xZZZZ;'), '&#xZZZZ;');
});

test('decodeEntities: entradas no-string devuelven cadena vacía', () => {
  assert.equal(decodeEntities(undefined), '');
  assert.equal(decodeEntities(null), '');
  assert.equal(decodeEntities(42), '');
});

test('unescapeSource: deshace los escapes típicos del JS embebido', () => {
  assert.equal(unescapeSource('https:\\/\\/cdn.test\\/a.m3u8'), 'https://cdn.test/a.m3u8');
  assert.equal(unescapeSource('a\\u0026b'), 'a&b');
  assert.equal(unescapeSource('a\\u002Fb'), 'a/b');
  assert.equal(unescapeSource("it\\'s"), "it's");
  assert.equal(unescapeSource('x&amp;y'), 'x&y');
});

test('unescapeSource: entradas no-string devuelven cadena vacía', () => {
  assert.equal(unescapeSource(undefined), '');
  assert.equal(unescapeSource({}), '');
});

test('collapseWhitespace: colapsa saltos de línea y espacios', () => {
  assert.equal(collapseWhitespace('  a\n\n  b\t c '), 'a b c');
  assert.equal(collapseWhitespace(undefined), '');
});
