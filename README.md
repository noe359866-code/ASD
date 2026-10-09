# Nexo Player

Addon proxy de [Stremio](https://stremio.com) desplegado como **Cloudflare Worker**.
Extrae flujos HLS (`.m3u8`) desde el reproductor embebido de UnlimPlay y los expone
en el formato `streams` que Stremio espera.

## Estructura

```
.
├── nexo-player/
│   └── worker.js       # Código del Worker (ES Module)
├── wrangler.jsonc      # Configuración de despliegue  ← necesaria para `wrangler deploy`
├── package.json
└── package-lock.json
```

## Despliegue

El comando de build de Cloudflare (`npx wrangler deploy`) se ejecuta **desde la raíz
del repositorio**, y `wrangler.jsonc` apunta al worker que está en la subcarpeta:

```jsonc
{
  "name": "nexo-player",
  "main": "nexo-player/worker.js",
  "compatibility_date": "2026-10-09"
}
```

Con eso basta para que el build pase. Si prefieres configurar la **Root directory**
en el panel de Cloudflare, usa `nexo-player` y mueve ahí el `wrangler.jsonc`
(ajustando `main` a `worker.js`) — pero no hagas ambas cosas a la vez.

### Local

```bash
npm install
npm run dev      # http://localhost:8787
```

### Manual (sin el build automático)

```bash
npx wrangler login
npx wrangler deploy
```

## Uso en Stremio

Una vez desplegado, la URL del addon es:

```
https://<name>.<tu-subdominio>.workers.dev/manifest.json
```

Pégala en Stremio → *Addons* → *Community addons* → campo de URL.

### Rutas

| Ruta                       | Ejemplo                          | Descripción                  |
| -------------------------- | -------------------------------- | ---------------------------- |
| `GET /manifest.json`       | `/manifest.json`                 | Manifest del addon           |
| `GET /stream/movie/{id}`   | `/stream/movie/tt1234567.json`   | Streams de película          |
| `GET /stream/series/{id}`  | `/stream/series/tt0903747:3:10.json` | Streams de serie (id:temp:epi) |

También acepta IDs de TMDB (`tmdb:550`, `tmdb:1396:1:1`).

## Solución de problemas

- **`Could not detect a directory containing static files (e.g. html, css and js)`**
  Wrangler no encontró `wrangler.jsonc`/`wrangler.toml` y asumió un proyecto de
  *static assets*. Se arregla con el archivo de configuración de la raíz (ver arriba).
- **`streams: []` en las respuestas** — el origen no devolvió ningún `.m3u8` para ese
  ID. Revisa con `npm run tail` (o `wrangler tail`) los logs en producción.

## Licencia

BSD 2-Clause — ver [LICENSE](LICENSE).
