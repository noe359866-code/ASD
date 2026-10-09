/**
 * Nexo Player — Addon proxy de Stremio para Cloudflare Workers.
 *
 * Rutas:
 *   GET /                          -> Página de instalación
 *   GET /health                    -> Estado y configuración activa
 *   GET /manifest.json             -> Manifest del addon
 *   GET /stream/movie/{id}.json    -> Streams de película  (tt1234567 / tmdb:550)
 *   GET /stream/series/{id}.json   -> Streams de serie     (tt0903747:3:10 / tmdb:1396:1:1)
 */

import { resolveConfig } from './config.js';
import { getMovieStreams, getSeriesStreams } from './streams.js';
import { landingPage, healthPayload } from './pages.js';
import { UpstreamError } from './upstream.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

function jsonResponse(data, { status = 200, cfg, ttl = 0, cacheState = null } = {}) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    ...CORS_HEADERS,
  };
  if (cfg) headers['X-Nexo-Version'] = cfg.version;
  if (cacheState) headers['X-Nexo-Cache'] = cacheState;
  if (ttl > 0) {
    headers['Cache-Control'] = `public, max-age=${ttl}, s-maxage=${ttl}`;
  } else {
    headers['Cache-Control'] = 'no-store';
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function htmlResponse(html, { status = 200 } = {}) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      ...CORS_HEADERS,
    },
  });
}

function buildManifest(cfg) {
  return {
    id: cfg.addonId,
    version: cfg.version,
    name: cfg.addonName,
    description: cfg.addonDescription,
    resources: [
      { name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb:'] },
    ],
    types: ['movie', 'series'],
    idPrefixes: ['tt', 'tmdb:'],
    catalogs: [],
    behaviorHints: { adult: false, configurable: false, configurationRequired: false },
  };
}

/** La cache se escribe con la URL "limpia": los query no forman parte de la clave. */
function cacheKeyFor(url) {
  return new Request(`${url.origin}${url.pathname}`, { method: 'GET' });
}

async function handleStream({ kind, rawId, url, cfg, ctx, query }) {
  const bypass = query.get('nocache') === '1' || query.get('debug') === '1';
  const cacheAvailable = typeof caches !== 'undefined' && caches?.default;
  const key = cacheKeyFor(url);

  if (cacheAvailable && !bypass) {
    const hit = await caches.default.match(key);
    if (hit) {
      const headers = new Headers(hit.headers);
      headers.set('X-Nexo-Cache', 'HIT');
      return new Response(hit.body, { status: hit.status, headers });
    }
  }

  const handler = kind === 'movie' ? getMovieStreams : getSeriesStreams;
  let result;
  let status = 200;

  try {
    result = await handler(rawId, cfg);
  } catch (err) {
    // Un UpstreamError trae el detalle de cada intento (HTTP 403, timeout, red…).
    // Se registra como JSON plano porque el stack no incluye esos datos.
    const detail =
      err instanceof UpstreamError
        ? { url: err.url, attempts: err.attempts, elapsedMs: err.elapsedMs, errors: err.errors }
        : { message: err?.message ?? String(err) };
    console.error(JSON.stringify({ event: 'upstream_failed', kind, rawId, ...detail }));
    result = { streams: [], error: 'Fallo consultando el origen' };
  }

  if (result.invalid) status = 400;

  const payload = { streams: result.streams };
  if (result.error) payload.error = result.error;
  if (query.get('debug') === '1' && cfg.debug) {
    payload.debug = result.diagnostics ?? { error: result.error ?? null };
  }

  const ttl = result.streams.length > 0 ? cfg.cacheTtlSeconds : cfg.negativeCacheTtlSeconds;
  const response = jsonResponse(payload, {
    status,
    cfg,
    ttl,
    cacheState: bypass ? 'BYPASS' : 'MISS',
  });

  if (cacheAvailable && !bypass && status === 200 && ttl > 0 && ctx?.waitUntil) {
    ctx.waitUntil(caches.default.put(key, response.clone()));
  }

  return response;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const cfg = resolveConfig(env);
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (path === '/') return htmlResponse(landingPage({ cfg, manifestUrl: `${url.origin}/manifest.json` }));
      if (path === '/favicon.ico') return new Response(null, { status: 204 });
      if (path === '/health') return jsonResponse(healthPayload(cfg), { cfg });
      if (path === '/manifest.json') return jsonResponse(buildManifest(cfg), { cfg, ttl: 300 });

      if (path.startsWith('/stream/movie/') || path.startsWith('/stream/series/')) {
        const kind = path.startsWith('/stream/movie/') ? 'movie' : 'series';
        const prefix = `/stream/${kind}/`;
        const rawId = decodeURIComponent(path.slice(prefix.length));
        return handleStream({ kind, rawId, url, cfg, ctx, query: url.searchParams });
      }

      return jsonResponse({ error: 'Ruta no encontrada' }, { status: 404, cfg });
    } catch (err) {
      console.error('fetch error:', err);
      return jsonResponse({ streams: [], error: 'Error interno' }, { status: 500, cfg });
    }
  },
};
