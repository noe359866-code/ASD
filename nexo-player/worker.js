/**
 * Nexo Player — Addon Proxy de Stremio para Cloudflare Workers
 * ------------------------------------------------------------
 * Extrae flujos HLS (.m3u8) desde el reproductor embebido de UnlimPlay
 * y los expone en el formato de "streams" que Stremio espera.
 *
 * Formato: ES Module (listo para copiar y pegar en el panel de
 * Cloudflare Workers o desplegar con Wrangler).
 *
 * Rutas:
 *   GET /manifest.json            -> Manifest oficial del addon
 *   GET /stream/movie/{id}.json   -> Streams de película  (tt1234567 / tmdb:550)
 *   GET /stream/series/{id}.json  -> Streams de serie     (tt0903747:3:10 / tmdb:1396:1:1)
 */

/* ------------------------------------------------------------------ */
/* Configuración                                                       */
/* ------------------------------------------------------------------ */

const ORIGIN = 'https://unlimplay.com';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

const MANIFEST = {
  id: 'com.cf.nexoplayer.proxy',
  version: '1.0.0',
  name: 'Nexo Player',
  description:
    'Reproductor inteligente y proxy HLS de alta velocidad para Películas, Series y Anime',
  resources: ['stream'],
  types: ['movie', 'series'],
  idPrefixes: ['tt', 'tmdb:'],
  catalogs: [],
};

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

/** Envuelve cualquier objeto en una Response JSON con cabeceras CORS. */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
    },
  });
}

/** Decodifica las entidades HTML más comunes (incluidas las numéricas). */
function decodeEntities(str) {
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
}

/** Normaliza un HTML escapado en JS (\/, \u0026, &amp;) a texto plano. */
function unescapeSource(html) {
  return html
    .replace(/\\\//g, '/') // \/  -> /
    .replace(/\\u0026/gi, '&') // \u0026 -> &
    .replace(/\\u002F/gi, '/') // \u002F -> /
    .replace(/\\'/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Extrae el título real del contenido desde el HTML.
 * Prioridad: meta og:title / twitter:title -> <title> -> valor por defecto.
 * Se eliminan sufijos típicos del sitio (" | UnlimPlay", " - Ver online", etc.).
 */
function extractTitle(html, fallback) {
  let match =
    html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i) ||
    html.match(/<meta[^>]+name=["']twitter:title["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  if (!match) return fallback;

  let title = decodeEntities(match[1]).replace(/\s+/g, ' ').trim();

  // Limpieza de sufijos habituales del sitio / "ver online" / calidad, etc.
  title = title
    .replace(/\s*[|·•]\s*(unlimplay|ver|watch|online|gratis|free|peliculas|movies|series).*$/i, '')
    .replace(/\s+[-–—]\s*(ver|watch|online|gratis|free|en linea|pelicula|serie).*$/i, '')
    .replace(/\s*\|\s*$/i, '')
    .trim();

  return title || fallback;
}

/**
 * Extrae la URL del flujo .m3u8 desde el HTML del reproductor embebido.
 * Devuelve null si no se encuentra ningún flujo.
 */
function extractM3u8(html) {
  const flat = unescapeSource(html);
  const matches = flat.match(/https?:\/\/[^\s"'<>\\]+?\.m3u8[^\s"'<>\\]*/gi);
  if (!matches || matches.length === 0) return null;

  // Preferir playlists "master"/"index"/"playlist"; si no, la más larga.
  const preferred =
    matches.find((u) => /master|index|playlist/i.test(u)) ||
    matches.slice().sort((a, b) => b.length - a.length)[0];

  // Limpieza final: fuera cualquier carácter de escape residual.
  return preferred.replace(/\\/g, '');
}

/** Descarga el HTML de la página de origen con cabeceras de navegador. */
async function fetchSourcePage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Referer: `${ORIGIN}/`,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    },
    cf: { cacheTtl: 0 }, // siempre HTML fresco desde el origen
  });
  if (!res.ok) {
    throw new Error(`El origen respondió con HTTP ${res.status}`);
  }
  return res.text();
}

/** Rellena con cero a la izquierda: 3 -> "03". */
function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Construye el objeto "stream" que Stremio mostrará en su lista. */
function buildStream(title, m3u8Url) {
  return {
    title,
    type: 'hls',
    url: m3u8Url.replace(/\\/g, ''),
    behaviorHints: {
      notSupported: false,
      requestHeaders: {
        Referer: 'https://unlimplay.com/',
        'User-Agent': USER_AGENT,
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* Handlers de rutas                                                   */
/* ------------------------------------------------------------------ */

/** GET /stream/movie/{id}.json  — id: tt1234567.json | tmdb:550.json */
async function handleMovie(rawId) {
  try {
    const movieId = rawId.replace(/\.json$/i, '').replace(/^tmdb:/i, '');
    if (!movieId) return jsonResponse({ streams: [] });

    const html = await fetchSourcePage(`${ORIGIN}/f/embed/movie/${movieId}`);

    const m3u8 = extractM3u8(html);
    if (!m3u8) return jsonResponse({ streams: [] });

    const name = extractTitle(html, `Película ${movieId}`);
    const title = `${name} | 1080p [Nexo Player]`;

    return jsonResponse({ streams: [buildStream(title, m3u8)] });
  } catch (err) {
    console.error('handleMovie error:', err);
    return jsonResponse({ streams: [] });
  }
}

/**
 * GET /stream/series/{id}.json
 * id: tt0903747:3:10.json | tmdb:1396:1:1.json  ->  seriesId:season:episode
 */
async function handleSeries(rawId) {
  try {
    let id = rawId.replace(/\.json$/i, '');
    id = id.replace(/^tmdb:/i, '');

    const parts = id.split(':');
    if (parts.length < 3) return jsonResponse({ streams: [] });

    const seriesId = parts[0];
    const season = parseInt(parts[1], 10);
    const episode = parseInt(parts[2], 10);

    if (!seriesId || Number.isNaN(season) || Number.isNaN(episode)) {
      return jsonResponse({ streams: [] });
    }

    const code = `S${pad2(season)}E${pad2(episode)}`;
    const html = await fetchSourcePage(
      `${ORIGIN}/f/embed/tv/${seriesId}/${season}/${episode}`
    );

    const m3u8 = extractM3u8(html);
    if (!m3u8) return jsonResponse({ streams: [] });

    const name = extractTitle(html, `Serie ${seriesId}`);
    const title = `${name} - ${code} | 1080p [Nexo Player]`;

    return jsonResponse({ streams: [buildStream(title, m3u8)] });
  } catch (err) {
    console.error('handleSeries error:', err);
    return jsonResponse({ streams: [] });
  }
}

/* ------------------------------------------------------------------ */
/* Punto de entrada del Worker                                         */
/* ------------------------------------------------------------------ */

export default {
  async fetch(request, env, ctx) {
    // Pre-vuelo CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // Manifest del addon
      if (path === '/manifest.json') {
        return jsonResponse(MANIFEST);
      }

      // Películas: /stream/movie/{id}.json
      if (path.startsWith('/stream/movie/')) {
        const id = decodeURIComponent(path.slice('/stream/movie/'.length));
        return handleMovie(id);
      }

      // Series / Anime: /stream/series/{id}.json
      if (path.startsWith('/stream/series/')) {
        const id = decodeURIComponent(path.slice('/stream/series/'.length));
        return handleSeries(id);
      }

      return jsonResponse({ error: 'Ruta no encontrada' }, 404);
    } catch (err) {
      console.error('fetch error:', err);
      return jsonResponse({ streams: [] });
    }
  },
};
