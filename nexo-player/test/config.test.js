import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveConfig, pad2, DEFAULT_CONFIG, VERSION } from '../src/config.js';

test('resolveConfig: sin env devuelve los valores por defecto', () => {
  const cfg = resolveConfig();
  assert.equal(cfg.origin, DEFAULT_CONFIG.origin);
  assert.equal(cfg.cacheTtlSeconds, 1800);
  assert.equal(cfg.upstreamRetries, 2);
  assert.equal(cfg.debug, false);
  assert.equal(cfg.referer, 'https://unlimplay.com/');
  assert.equal(cfg.userAgents.length, 3);
});

test('resolveConfig: acepta env vacío o nulo', () => {
  assert.equal(resolveConfig({}).origin, DEFAULT_CONFIG.origin);
  assert.equal(resolveConfig(null).origin, DEFAULT_CONFIG.origin);
  assert.equal(resolveConfig(undefined).origin, DEFAULT_CONFIG.origin);
});

test('resolveConfig: quita la barra final del ORIGIN', () => {
  assert.equal(resolveConfig({ ORIGIN: 'https://otro.test///' }).origin, 'https://otro.test');
  assert.equal(resolveConfig({ ORIGIN: 'https://otro.test' }).referer, 'https://otro.test/');
});

test('resolveConfig: ignora valores vacíos o basura', () => {
  const cfg = resolveConfig({
    ORIGIN: '   ',
    CACHE_TTL_SECONDS: 'no-es-numero',
    MAX_STREAMS: '',
    DEBUG: 'quizá',
  });
  assert.equal(cfg.origin, DEFAULT_CONFIG.origin);
  assert.equal(cfg.cacheTtlSeconds, DEFAULT_CONFIG.cacheTtlSeconds);
  assert.equal(cfg.maxStreams, DEFAULT_CONFIG.maxStreams);
  assert.equal(cfg.debug, false);
});

test('resolveConfig: acota los números a rangos razonables', () => {
  assert.equal(resolveConfig({ CACHE_TTL_SECONDS: '999999999' }).cacheTtlSeconds, 86400);
  assert.equal(resolveConfig({ UPSTREAM_TIMEOUT_MS: '5' }).upstreamTimeoutMs, 1000);
  assert.equal(resolveConfig({ UPSTREAM_RETRIES: '99' }).upstreamRetries, 5);
  assert.equal(resolveConfig({ MAX_STREAMS: '0' }).maxStreams, 1);
});

test('resolveConfig: DEBUG acepta varias formas de "sí"', () => {
  for (const v of ['1', 'true', 'YES', 'on']) {
    assert.equal(resolveConfig({ DEBUG: v }).debug, true, `DEBUG=${v}`);
  }
  for (const v of ['0', 'false', 'off']) {
    assert.equal(resolveConfig({ DEBUG: v }).debug, false, `DEBUG=${v}`);
  }
});

test('resolveConfig: USER_AGENT sustituye la rotación por uno fijo', () => {
  const cfg = resolveConfig({ USER_AGENT: 'MiBot/1.0' });
  assert.deepEqual([...cfg.userAgents], ['MiBot/1.0']);
});

test('resolveConfig: plantillas de embed configurables', () => {
  const cfg = resolveConfig({
    ORIGIN: 'https://x.test',
    EMBED_MOVIE_PATH: '/ver/{id}',
    EMBED_SERIES_PATH: '/ver/{id}/t{season}/e{episode}',
  });
  assert.equal(cfg.embedMoviePath, '/ver/{id}');
  assert.equal(cfg.embedSeriesPath, '/ver/{id}/t{season}/e{episode}');
});

test('pad2: rellena a dos dígitos', () => {
  assert.equal(pad2(3), '03');
  assert.equal(pad2(10), '10');
  assert.equal(pad2(0), '00');
});

test('VERSION coincide con la versión del manifest por defecto', () => {
  assert.equal(DEFAULT_CONFIG.version, VERSION);
});
