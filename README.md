# Nexo Player

Addon proxy de [Stremio](https://stremio.com) desplegado como **Cloudflare Worker**.
Extrae flujos HLS (`.m3u8`) desde el reproductor embebido de UnlimPlay, desglosa sus
variantes de calidad y los expone en el formato `streams` que Stremio espera.

## Qué hace

1. Stremio pide `/stream/movie/tt1234567.json`.
2. El Worker valida el ID, descarga la página embebida del origen y localiza el `.m3u8`.
3. Si ese `.m3u8` es una *playlist master*, la parsea y devuelve **un stream por calidad**
   (1080p, 720p, 480p…) en lugar de uno solo.
4. Responde con las cabeceras `Referer`/`User-Agent` que el CDN del origen exige, tanto en
   `behaviorHints.proxyHeaders` (Stremio moderno) como en `requestHeaders` (clientes viejos).
5. Cachea la respuesta en la Cache API de Cloudflare (por defecto 30 min; los resultados
   vacíos solo 2 min).

## Estructura

```
.
├── nexo-player/
│   ├── src/
│   │   ├── index.js       # Router + cache (punto de entrada del Worker)
│   │   ├── config.js      # Variables de entorno -> configuración
│   │   ├── text.js        # Entidades HTML y escapes de JS
│   │   ├── extract.js     # Título y URLs .m3u8 desde el HTML
│   │   ├── playlist.js    # Parseo de playlists HLS master
│   │   ├── upstream.js    # fetch con timeout, reintentos y rotación de UA
│   │   ├── streams.js     # Validación de IDs y armado de la respuesta
│   │   └── pages.js       # Página de instalación y /health
│   ├── test/              # 71 pruebas (node:test, sin dependencias)
│   └── testkit/           # Origen falso, fixtures y lanzador de workerd
├── wrangler.jsonc         # Configuración de despliegue
├── package.json
└── .github/workflows/ci.yml
```

## Desarrollo

```bash
npm install
cp .dev.vars.example .dev.vars   # opcional
npm run dev                      # http://localhost:8787
```

Abre `http://localhost:8787/` y verás la página de instalación con un botón de estado.

## Pruebas

```bash
npm test          # 71 pruebas: 56 unitarias + 15 end-to-end
npm run test:unit # solo las unitarias (rápidas)
npm run test:e2e  # solo las end-to-end (arrancan workerd, ~15 s)
npm run check     # pruebas + bundle de producción (sin desplegar)
```

Las pruebas end-to-end levantan el **Worker real en workerd** (`wrangler dev`) apuntando
a un servidor HTTP falso que imita a UnlimPlay, así que atraviesan el mismo runtime que
corre en Cloudflare —incluida la Cache API— sin tocar la red externa.

## Despliegue

El comando de build de Cloudflare (`npx wrangler deploy`) se ejecuta **desde la raíz del
repositorio**; `wrangler.jsonc` apunta al entrypoint dentro de la subcarpeta:

```jsonc
{
  "name": "nexo-player",
  "main": "nexo-player/src/index.js",
  "compatibility_date": "2026-10-09"
}
```

Manual, sin el build automático:

```bash
npx wrangler login
npx wrangler deploy
```

## Configuración

Todo se cambia desde el panel de Cloudflare (*Settings → Variables*) o desde el bloque
`vars` de `wrangler.jsonc`, sin redesplegar código. Cualquier valor inválido cae de
vuelta al valor por defecto en lugar de romper el Worker.

| Variable                   | Por defecto                | Descripción                                       |
| -------------------------- | -------------------------- | ------------------------------------------------- |
| `ORIGIN`                   | `https://unlimplay.com`    | Origen del que se extraen los flujos              |
| `EMBED_MOVIE_PATH`         | `/f/embed/movie/{id}`      | Plantilla de la página embebida de película       |
| `EMBED_SERIES_PATH`        | `/f/embed/tv/{id}/{season}/{episode}` | Ídem para series                     |
| `CACHE_TTL_SECONDS`        | `1800`                     | Cache de resultados con streams                   |
| `NEGATIVE_CACHE_TTL_SECONDS` | `120`                    | Cache de resultados vacíos                        |
| `UPSTREAM_TIMEOUT_MS`      | `12000`                    | Timeout por petición al origen                    |
| `UPSTREAM_RETRIES`         | `2`                        | Reintentos extra (rota el User-Agent)             |
| `MAX_STREAMS`              | `6`                        | Máximo de calidades por título                    |
| `USER_AGENT`               | *(rota tres navegadores)*  | Fija un User-Agent concreto                       |
| `DEBUG`                    | `0`                        | Habilita `?debug=1` en `/stream/*`                |

## Uso en Stremio

La URL del addon es:

```
https://nexo-player.<tu-subdominio>.workers.dev/manifest.json
```

Ábrela en el navegador y pulsa **Abrir Stremio**, o pégala en
*Addons → lupa → campo de URL*.

### Rutas

| Ruta                      | Ejemplo                              | Descripción                      |
| ------------------------- | ------------------------------------ | -------------------------------- |
| `GET /`                   | `/`                                  | Página de instalación            |
| `GET /health`             | `/health`                            | Estado y configuración activa    |
| `GET /manifest.json`      | `/manifest.json`                     | Manifest del addon               |
| `GET /stream/movie/{id}`  | `/stream/movie/tt1234567.json`       | Streams de película              |
| `GET /stream/series/{id}` | `/stream/series/tt0903747:3:10.json` | Streams de serie (`id:temp:epi`) |

Se aceptan IDs de IMDb (`tt…`) y de TMDB (`tmdb:550`, `tmdb:1396:1:1`).

Query útiles: `?debug=1` (requiere `DEBUG=1`) añade un bloque de diagnóstico, y
`?nocache=1` se salta la Cache API.

### Cabeceras de respuesta

`X-Nexo-Cache` indica `HIT`, `MISS` o `BYPASS`, y `X-Nexo-Version` la versión en curso.

## Solución de problemas

- **`Could not detect a directory containing static files (e.g. html, css and js)`**
  Wrangler no encontró `wrangler.jsonc`/`wrangler.toml` y asumió un proyecto de
  *static assets*. Se arregla con el archivo de configuración de la raíz.
- **`streams: []`** — el origen no devolvió ningún `.m3u8` para ese ID. Con `DEBUG=1`
  pide `?debug=1` para ver qué URL se consultó y qué se encontró, o mira los logs en
  producción con `npm run tail`.
- **Solo aparece una calidad** — el `.m3u8` del origen no es una playlist master
  (no lista variantes). Es normal en algunos títulos; el Worker degrada a un único stream.
- **Los IDs de TMDB no resuelven** — el Worker quita el prefijo `tmdb:` antes de consultar
  el origen (`tmdb:550` → `/f/embed/movie/550`). Si el origen espera otra cosa, ajusta
  `EMBED_MOVIE_PATH`/`EMBED_SERIES_PATH`.

## Licencia

BSD 2-Clause — ver [LICENSE](LICENSE).
