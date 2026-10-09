/**
 * Núcleo del addon: convierte un ID de Stremio en una lista de streams.
 */

import { pad2 } from './config.js';
import { extractM3u8, findAllM3u8, extractTitle } from './extract.js';
import { isMasterPlaylist, parseMasterPlaylist, qualityLabel } from './playlist.js';
import { fetchText, UpstreamError } from './upstream.js';

/* ------------------------------------------------------------------ */
/* Validación de IDs                                                   */
/* ------------------------------------------------------------------ */

/**
 * Los IDs llegan desde Stremio y se interpolan en una URL del origen,
 * así que se validan estrictamente: nada de "..", "/", "?" o "#".
 *
 * Se devuelven dos formas del ID:
 *   id         -> normalizado completo, p.ej. "tmdb:550" (para logs/debug)
 *   externalId -> lo que entiende el origen, p.ej. "550" (para la URL)
 */
const MOVIE_ID_RE = /^(tt\d{1,9}|tmdb:\d{1,9})$/i;
const SERIES_ID_RE = /^(tt\d{1,9}|tmdb:\d{1,9}):(\d{1,3}):(\d{1,4})$/i;

function splitId(full) {
  const lower = full.toLowerCase();
  const isTmdb = lower.startsWith('tmdb:');
  return {
    id: lower,
    externalId: isTmdb ? lower.slice('tmdb:'.length) : lower,
    provider: isTmdb ? 'tmdb' : 'imdb',
  };
}

export function parseMovieId(raw) {
  const id = String(raw ?? '').replace(/\.json$/i, '');
  const m = MOVIE_ID_RE.exec(id);
  if (!m) return { ok: false, reason: `ID de película inválido: "${id}"` };
  return { ok: true, ...splitId(m[1]) };
}

export function parseSeriesId(raw) {
  const id = String(raw ?? '').replace(/\.json$/i, '');
  const m = SERIES_ID_RE.exec(id);
  if (!m) return { ok: false, reason: `ID de serie inválido: "${id}"` };

  const season = parseInt(m[2], 10);
  const episode = parseInt(m[3], 10);
  if (season < 1 || episode < 1) {
    return { ok: false, reason: `Temporada/episodio fuera de rango: "${id}"` };
  }
  return { ok: true, ...splitId(m[1]), season, episode };
}

/* ------------------------------------------------------------------ */
/* Construcción de streams                                             */
/* ------------------------------------------------------------------ */

function buildStream({ title, url, cfg, quality = null }) {
  const requestHeaders = {
    Referer: cfg.referer,
    'User-Agent': cfg.userAgents[0],
  };

  return {
    name: cfg.addonName,
    title,
    description: quality ? qualityLabel(quality) : undefined,
    type: 'hls',
    url,
    behaviorHints: {
      notSupported: false,
      bingeGroup: 'nexo-player',
      // Stremio moderno
      proxyHeaders: { request: requestHeaders },
      // Clientes antiguos
      requestHeaders,
    },
  };
}

function fillTemplate(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ''));
}

/** Mensaje que ve Stremio cuando el origen no responde. */
export const ORIGIN_ERROR = 'Fallo consultando el origen';

/**
 * Descarga la página embebida, extrae el .m3u8 y —si es una playlist master—
 * desglosa las variantes de calidad en streams separados.
 *
 * Nunca lanza por un fallo del origen: devuelve `{ streams: [], error, transient: true }`
 * para que la capa HTTP no lo cachee.
 */
export async function resolveStreams(embedUrl, cfg, { titlePrefix, tag }) {
  const diag = { embedUrl, candidates: [], variants: 0, steps: [] };

  let page;
  try {
    page = await fetchText(embedUrl, cfg, {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    });
  } catch (err) {
    const errors = err instanceof UpstreamError ? err.errors : [String(err?.message ?? err)];
    diag.steps.push(`página no disponible (${errors.join(', ')})`);
    // Detalle para `wrangler tail`: qué respondió el origen en cada intento.
    console.error(
      JSON.stringify({
        event: 'upstream_failed',
        url: embedUrl,
        attempts: err?.attempts ?? null,
        elapsedMs: err?.elapsedMs ?? null,
        errors,
      })
    );
    return { streams: [], error: ORIGIN_ERROR, transient: true, diagnostics: diag };
  }
  diag.steps.push(`page:${page.status} en ${page.elapsedMs}ms (intentos ${page.attempts})`);

  const all = findAllM3u8(page.text);
  diag.candidates = all;
  if (all.length === 0) {
    diag.steps.push('sin .m3u8 en el HTML');
    return { streams: [], diagnostics: diag };
  }

  const name = extractTitle(page.text, titlePrefix);
  const primary = extractM3u8(page.text);

  // Intento de desglose por calidades.
  let variants = [];
  try {
    const playlist = await fetchText(primary, cfg, { accept: 'application/vnd.apple.mpegurl,*/*' });
    diag.steps.push(`playlist:${playlist.status} en ${playlist.elapsedMs}ms`);
    if (isMasterPlaylist(playlist.text)) {
      variants = parseMasterPlaylist(playlist.text, primary);
      diag.variants = variants.length;
      diag.steps.push(`${variants.length} variantes de calidad`);
    } else {
      diag.steps.push('playlist media (sin variantes)');
    }
  } catch (err) {
    // Sin desglose no pasa nada: seguimos con el stream único.
    diag.steps.push(`playlist no disponible (${err instanceof UpstreamError ? err.errors?.join(', ') : err.message})`);
  }

  const streams = [];
  const usable = variants.slice(0, cfg.maxStreams);

  if (usable.length > 0) {
    for (const v of usable) {
      const quality = qualityLabel(v);
      streams.push(
        buildStream({
          title: `${name}${tag ? ` ${tag}` : ''} · ${quality} [${cfg.addonName}]`,
          url: v.url,
          cfg,
          quality: v,
        })
      );
    }
  } else {
    streams.push(
      buildStream({
        title: `${name}${tag ? ` ${tag}` : ''} [${cfg.addonName}]`,
        url: primary,
        cfg,
      })
    );
  }

  return { streams, diagnostics: diag };
}

/* ------------------------------------------------------------------ */
/* Handlers por tipo                                                   */
/* ------------------------------------------------------------------ */

/** GET /stream/movie/{id}.json */
export async function getMovieStreams(rawId, cfg) {
  const parsed = parseMovieId(rawId);
  if (!parsed.ok) return { streams: [], error: parsed.reason, invalid: true };

  const embedUrl = cfg.origin + fillTemplate(cfg.embedMoviePath, { id: parsed.externalId });
  const result = await resolveStreams(embedUrl, cfg, { titlePrefix: `Película ${parsed.id}` });
  return {
    ...result,
    diagnostics: { ...result.diagnostics, id: parsed.id, provider: parsed.provider },
  };
}

/** GET /stream/series/{id}.json — id = serie:temporada:episodio */
export async function getSeriesStreams(rawId, cfg) {
  const parsed = parseSeriesId(rawId);
  if (!parsed.ok) return { streams: [], error: parsed.reason, invalid: true };

  const code = `S${pad2(parsed.season)}E${pad2(parsed.episode)}`;
  const embedUrl =
    cfg.origin +
    fillTemplate(cfg.embedSeriesPath, {
      id: parsed.externalId,
      season: parsed.season,
      episode: parsed.episode,
    });

  const result = await resolveStreams(embedUrl, cfg, {
    titlePrefix: `Serie ${parsed.id}`,
    tag: code,
  });
  return {
    ...result,
    diagnostics: { ...result.diagnostics, id: parsed.id, provider: parsed.provider },
  };
}
