/**
 * Capa de red hacia el origen.
 *
 * Añade lo que el fetch plano no tiene: timeout real, reintentos con
 * backoff y rotación de User-Agent.
 */

/** Error de red/origen con contexto para los logs y el modo debug. */
export class UpstreamError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'UpstreamError';
    Object.assign(this, details);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Descarga un recurso de texto con reintentos.
 *
 * @returns {Promise<{text:string,status:number,finalUrl:string,attempts:number,elapsedMs:number}>}
 */
export async function fetchText(url, cfg, { accept = '*/*' } = {}) {
  const attempts = Math.max(1, cfg.upstreamRetries + 1);
  const started = Date.now();
  const errors = [];

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(Math.min(1500, 200 * 2 ** (attempt - 1)));

    const userAgent = cfg.userAgents[attempt % cfg.userAgents.length];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.upstreamTimeoutMs);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': userAgent,
          Referer: cfg.referer,
          Accept: accept,
          'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        },
        cf: { cacheTtl: 0 }, // HTML/playslist siempre frescos desde el origen
      });

      if (!res.ok) {
        errors.push(`HTTP ${res.status}`);
        continue;
      }

      return {
        text: await res.text(),
        status: res.status,
        finalUrl: res.url || url,
        attempts: attempt + 1,
        elapsedMs: Date.now() - started,
      };
    } catch (err) {
      errors.push(err?.name === 'AbortError' ? `timeout ${cfg.upstreamTimeoutMs}ms` : String(err?.message ?? err));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new UpstreamError(`No se pudo descargar ${url}`, {
    url,
    attempts,
    elapsedMs: Date.now() - started,
    errors,
  });
}
