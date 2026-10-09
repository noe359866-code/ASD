/**
 * Utilidades de texto: entidades HTML y escapes de JavaScript embebido.
 */

/** Decodifica las entidades HTML más comunes (incluidas las numéricas). */
export function decodeEntities(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const cp = parseInt(hex, 16);
      return Number.isFinite(cp) ? safeCodePoint(cp) : '';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const cp = parseInt(dec, 10);
      return Number.isFinite(cp) ? safeCodePoint(cp) : '';
    })
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&');
}

/** String.fromCodePoint que no explota con códigos inválidos. */
function safeCodePoint(cp) {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

/** Normaliza un HTML escapado dentro de JS (\/, \u0026, &amp;) a texto plano. */
export function unescapeSource(html) {
  if (typeof html !== 'string') return '';
  return html
    .replace(/\\\//g, '/') // \/     -> /
    .replace(/\\u0026/gi, '&') // \u0026 -> &
    .replace(/\\u002F/gi, '/') // \u002F -> /
    .replace(/\\'/g, "'")
    .replace(/&amp;/g, '&');
}

/** Colapsa espacios y recorta extremos. */
export function collapseWhitespace(str) {
  return String(str ?? '').replace(/\s+/g, ' ').trim();
}
