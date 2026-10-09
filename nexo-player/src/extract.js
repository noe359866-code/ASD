/**
 * Extracción de datos desde el HTML del reproductor embebido.
 */

import { decodeEntities, unescapeSource, collapseWhitespace } from './text.js';

/** Sufijos de "basura" que el sitio pega al título. */
const TITLE_NOISE = [
  /\s*[|·•]\s*(unlimplay|ver|watch|online|gratis|free|peliculas|movies|series|hd|full).*$/i,
  /\s+[-–—]\s*(ver|watch|online|gratis|free|en linea|en línea|pelicula|película|serie).*$/i,
  /\s*\|\s*$/i,
];

/**
 * Extrae el título real del contenido.
 * Prioridad: og:title -> twitter:title -> <title> -> fallback.
 */
export function extractTitle(html, fallback = '') {
  if (typeof html !== 'string' || html.length === 0) return fallback;

  const match =
    html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i) ||
    html.match(/<meta[^>]+name=["']twitter:title["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  if (!match) return fallback;

  let title = collapseWhitespace(decodeEntities(match[1]));
  for (const re of TITLE_NOISE) title = title.replace(re, '');
  title = title.trim();

  return title.length > 0 ? title : fallback;
}

/**
 * Devuelve TODAS las URLs .m3u8 encontradas, sin duplicados.
 * Orden: primero las que parecen playlist "master", luego por longitud.
 */
export function findAllM3u8(html) {
  const flat = unescapeSource(html);
  const matches = flat.match(/https?:\/\/[^\s"'<>\\]+?\.m3u8[^\s"'<>\\]*/gi);
  if (!matches || matches.length === 0) return [];

  const cleaned = matches.map((u) => u.replace(/\\/g, '').replace(/[),;]+$/, ''));
  const unique = [...new Set(cleaned)];

  const isMaster = (u) => /master|index|playlist|main/i.test(u);
  return unique.sort((a, b) => {
    const ma = isMaster(a) ? 1 : 0;
    const mb = isMaster(b) ? 1 : 0;
    if (ma !== mb) return mb - ma;
    return b.length - a.length;
  });
}

/** La URL .m3u8 "más probable", o null si no hay ninguna. */
export function extractM3u8(html) {
  const all = findAllM3u8(html);
  return all.length > 0 ? all[0] : null;
}
