/**
 * Servidor de origen falso para las pruebas end-to-end.
 * Sin efectos secundarios al importarlo: hay que llamar a startMockOrigin().
 */

import http from 'node:http';
import { MASTER_PLAYLIST, MEDIA_PLAYLIST, embedPage } from './fixtures.mjs';

/**
 * Levanta un "UnlimPlay" de mentira en un puerto libre.
 *
 * @returns {Promise<{origin:string, port:number, hits:string[], stop:()=>Promise<void>}>}
 */
export function startMockOrigin() {
  const hits = [];
  const self = { port: 0 };

  const playlistUrl = (path) => `http://127.0.0.1:${self.port}${path}`;

  const server = http.createServer((req, res) => {
    hits.push(req.url);

    const send = (status, type, body) => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(body);
    };

    if (req.url?.startsWith('/hls/master')) {
      return send(200, 'application/vnd.apple.mpegurl', MASTER_PLAYLIST);
    }

    if (req.url?.startsWith('/hls/media')) {
      return send(200, 'application/vnd.apple.mpegurl', MEDIA_PLAYLIST);
    }

    if (req.url?.startsWith('/hls/none')) {
      return send(404, 'text/plain', 'nope');
    }

    if (req.url?.startsWith('/f/embed/movie/')) {
      const id = req.url.split('/').pop();
      // IDs reservados para probar los caminos degradados de punta a punta.
      if (id === 'tt0000000') {
        // El origen responde pero no trae ningún flujo.
        return send(200, 'text/html; charset=utf-8', '<html><title>Sin nada</title></html>');
      }
      if (id === 'tt0000001') {
        // El flujo existe pero su playlist da 404 -> un único stream.
        return send(200, 'text/html; charset=utf-8', embedPage({
          title: 'Sin variantes | UnlimPlay',
          m3u8: [playlistUrl('/hls/none.m3u8')],
        }));
      }
      if (id === 'tt0000002') {
        // El origen está caído.
        return send(503, 'text/plain', 'service unavailable');
      }
      return send(
        200,
        'text/html; charset=utf-8',
        embedPage({
          title: `Pelicula ${id} | UnlimPlay`,
          m3u8: [playlistUrl('/hls/master.m3u8')],
        })
      );
    }

    if (req.url?.startsWith('/f/embed/tv/')) {
      const [id, season, episode] = req.url.split('/').slice(-3);
      return send(
        200,
        'text/html; charset=utf-8',
        embedPage({
          title: `Serie ${id} - Capitulo ${episode} | UnlimPlay`,
          m3u8: [playlistUrl(`/hls/master.m3u8?s=${season}&e=${episode}`)],
        })
      );
    }

    return send(404, 'text/plain', 'not found');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      self.port = server.address().port;
      resolve({
        origin: `http://127.0.0.1:${self.port}`,
        port: self.port,
        hits,
        stop: () =>
          new Promise((r) => {
            server.closeAllConnections?.();
            server.close(r);
          }),
      });
    });
  });
}
