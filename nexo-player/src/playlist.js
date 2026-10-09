/**
 * Parseo de playlists HLS (.m3u8).
 *
 * Una playlist "master" lista variantes de calidad (#EXT-X-STREAM-INF);
 * una playlist "media" lista segmentos (#EXTINF). Solo la master nos sirve
 * para ofrecer varias calidades al usuario.
 */

/** ¿Es una playlist master (con variantes)? */
export function isMasterPlaylist(text) {
  return typeof text === 'string' && /#EXT-X-STREAM-INF/i.test(text);
}

/**
 * Parser mínimo de atributos de HLS, respetando comillas:
 *   RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",BANDWIDTH=5000000
 */
export function parseAttributes(raw) {
  const attrs = {};
  if (typeof raw !== 'string') return attrs;

  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let m;
  while ((m = re.exec(raw)) !== null) {
    attrs[m[1].toUpperCase()] = m[2].replace(/^"|"$/g, '');
  }
  return attrs;
}

/**
 * Convierte una playlist master en variantes ordenadas por altura (desc).
 * Resuelve URIs relativas contra `baseUrl`.
 *
 * @returns {Array<{url:string,width:number|null,height:number|null,bandwidth:number|null,codecs:string|null,name:string}>}
 */
export function parseMasterPlaylist(text, baseUrl) {
  if (!isMasterPlaylist(text)) return [];

  const lines = String(text).split(/\r?\n/);
  const variants = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!/^#EXT-X-STREAM-INF:/i.test(line)) continue;

    const attrs = parseAttributes(line.slice('#EXT-X-STREAM-INF:'.length));

    // El URI va en la siguiente línea que no sea comentario ni vacía.
    let uri = null;
    for (let j = i + 1; j < lines.length; j += 1) {
      const candidate = lines[j].trim();
      if (candidate.length === 0) continue;
      if (candidate.startsWith('#')) continue;
      uri = candidate;
      break;
    }
    if (!uri) continue;

    let url;
    try {
      url = new URL(uri, baseUrl).toString();
    } catch {
      continue;
    }

    const [w, h] = (attrs.RESOLUTION || '').split('x').map((n) => parseInt(n, 10));
    const bandwidth = attrs.BANDWIDTH ? parseInt(attrs.BANDWIDTH, 10) : null;

    variants.push({
      url,
      width: Number.isFinite(w) ? w : null,
      height: Number.isFinite(h) ? h : null,
      bandwidth: Number.isFinite(bandwidth) ? bandwidth : null,
      codecs: attrs.CODECS || null,
      name: attrs.NAME || null,
    });
  }

  return dedupeByHeight(variants);
}

/** Deja la variante de mayor bitrate por cada altura, ordenadas de mayor a menor. */
export function dedupeByHeight(variants) {
  const byHeight = new Map();

  for (const v of variants) {
    const key = v.height ?? `noheight:${v.url}`;
    const prev = byHeight.get(key);
    if (!prev || (v.bandwidth ?? 0) > (prev.bandwidth ?? 0)) byHeight.set(key, v);
  }

  return [...byHeight.values()].sort(
    (a, b) => (b.height ?? -1) - (a.height ?? -1) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0)
  );
}

/** Etiqueta legible de la calidad: "1080p · 5.0 Mbps" */
export function qualityLabel(variant) {
  const parts = [];
  if (variant?.height) parts.push(`${variant.height}p`);
  else if (variant?.width) parts.push(`${variant.width}px`);
  if (variant?.bandwidth) parts.push(`${(variant.bandwidth / 1_000_000).toFixed(1)} Mbps`);
  return parts.join(' · ');
}
