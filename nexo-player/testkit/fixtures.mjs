/**
 * Fixtures realistas. Imitan lo que devuelve el reproductor embebido:
 * HTML con JavaScript escapado (\/, \u0026) y playlists HLS.
 */

export const MASTER_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"
360p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=842x480
480p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=9000000,RESOLUTION=1920x1080
1080p-high/index.m3u8
`;

export const MEDIA_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXTINF:6.006,
segment-0.ts
#EXTINF:6.006,
segment-1.ts
#EXT-X-ENDLIST
`;

/** Escapa una URL como lo haría un minificador dentro de un string JS. */
export function jsEscape(url) {
  return url.replace(/\//g, '\\/').replace(/&/g, '\\u0026');
}

/**
 * Página de reproductor embebido.
 * @param {object} o
 * @param {string} o.title        Título en og:title
 * @param {string[]} o.m3u8       URLs de flujo (se escapan solas)
 * @param {string} [o.pageTitle]  Contenido de <title>
 */
export function embedPage({ title, m3u8 = [], pageTitle }) {
  const sources = m3u8.map((u) => `  source: "${jsEscape(u)}",`).join('\n');
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta property="og:title" content="${title}" />
  <title>${pageTitle ?? title}</title>
</head>
<body>
<script>
  var player = new Player({
${sources}
    poster: "${jsEscape('https://cdn.test-video.com/img/poster.jpg')}"
  });
</script>
</body>
</html>`;
}

export const MOVIE_STREAM_URL =
  'https://cdn.test-video.com/hls/abc123/master.m3u8?token=deadbeef&exp=1700000000';

export const MOVIE_PAGE = embedPage({
  title: 'El Se&#241;or de los Anillos | UnlimPlay',
  pageTitle: 'El Señor de los Anillos - Ver online',
  m3u8: [MOVIE_STREAM_URL],
});
