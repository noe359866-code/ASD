/**
 * Configuración del addon.
 *
 * Todo valor puede sobrescribirse desde Cloudflare (Settings -> Variables,
 * o el bloque "vars" de wrangler.jsonc) sin tocar el código.
 */

export const VERSION = '1.1.0';

export const DEFAULT_USER_AGENTS = Object.freeze([
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
]);

export const DEFAULT_CONFIG = Object.freeze({
  addonId: 'com.cf.nexoplayer.proxy',
  addonName: 'Nexo Player',
  addonDescription:
    'Reproductor inteligente y proxy HLS de alta velocidad para Películas, Series y Anime',
  version: VERSION,

  origin: 'https://unlimplay.com',
  embedMoviePath: '/f/embed/movie/{id}',
  embedSeriesPath: '/f/embed/tv/{id}/{season}/{episode}',

  userAgents: DEFAULT_USER_AGENTS,
  cacheTtlSeconds: 1800,
  negativeCacheTtlSeconds: 120,
  upstreamTimeoutMs: 12000,
  upstreamRetries: 2,
  maxStreams: 6,
  debug: false,
});

/* ------------------------------------------------------------------ */
/* Coerción segura de variables de entorno                             */
/* ------------------------------------------------------------------ */

function str(env, key, fallback) {
  const raw = env?.[key];
  if (typeof raw !== 'string') return fallback;
  const value = raw.trim();
  return value.length > 0 ? value : fallback;
}

function int(env, key, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env?.[key];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number.parseInt(String(raw), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function bool(env, key, fallback) {
  const raw = env?.[key];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const v = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return fallback;
}

/** Quita la barra final de un origen: "https://x.com/" -> "https://x.com" */
function normalizeOrigin(origin) {
  return origin.replace(/\/+$/, '');
}

/**
 * Fusiona las variables de entorno con los valores por defecto.
 * Nunca lanza: cualquier valor inválido cae de vuelta al default.
 */
export function resolveConfig(env = {}) {
  const origin = normalizeOrigin(str(env, 'ORIGIN', DEFAULT_CONFIG.origin));
  const singleUA = str(env, 'USER_AGENT', '');

  return {
    ...DEFAULT_CONFIG,
    addonName: str(env, 'ADDON_NAME', DEFAULT_CONFIG.addonName),
    addonDescription: str(env, 'ADDON_DESCRIPTION', DEFAULT_CONFIG.addonDescription),
    origin,
    referer: `${origin}/`,
    embedMoviePath: str(env, 'EMBED_MOVIE_PATH', DEFAULT_CONFIG.embedMoviePath),
    embedSeriesPath: str(env, 'EMBED_SERIES_PATH', DEFAULT_CONFIG.embedSeriesPath),
    userAgents: singleUA ? Object.freeze([singleUA]) : DEFAULT_USER_AGENTS,
    cacheTtlSeconds: int(env, 'CACHE_TTL_SECONDS', DEFAULT_CONFIG.cacheTtlSeconds, {
      min: 0,
      max: 86400,
    }),
    negativeCacheTtlSeconds: int(
      env,
      'NEGATIVE_CACHE_TTL_SECONDS',
      DEFAULT_CONFIG.negativeCacheTtlSeconds,
      { min: 0, max: 86400 }
    ),
    upstreamTimeoutMs: int(env, 'UPSTREAM_TIMEOUT_MS', DEFAULT_CONFIG.upstreamTimeoutMs, {
      min: 1000,
      max: 60000,
    }),
    upstreamRetries: int(env, 'UPSTREAM_RETRIES', DEFAULT_CONFIG.upstreamRetries, {
      min: 0,
      max: 5,
    }),
    maxStreams: int(env, 'MAX_STREAMS', DEFAULT_CONFIG.maxStreams, { min: 1, max: 20 }),
    debug: bool(env, 'DEBUG', DEFAULT_CONFIG.debug),
  };
}

/** Rellena con ceros a la izquierda: 3 -> "03". */
export function pad2(n) {
  return String(n).padStart(2, '0');
}
