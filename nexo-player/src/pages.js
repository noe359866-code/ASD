/**
 * Páginas HTML y endpoints de diagnóstico.
 */

import { VERSION } from './config.js';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Página de aterrizaje: sirve para comprobar que el deploy vive y para
 * instalar el addon en Stremio con un clic.
 */
export function landingPage({ cfg, manifestUrl }) {
  const deepLink = manifestUrl.replace(/^https?:\/\//, 'stremio://');

  const rows = [
    ['GET', '/manifest.json', 'Manifest del addon'],
    ['GET', '/stream/movie/{id}.json', 'Streams de película · <code>tt1234567</code> o <code>tmdb:550</code>'],
    ['GET', '/stream/series/{id}.json', 'Streams de serie · <code>tt0903747:3:10</code> o <code>tmdb:1396:1:1</code>'],
    ['GET', '/health', 'Estado del worker y configuración activa'],
  ]
    .map(
      ([m, p, d]) =>
        `<tr><td class="m">${m}</td><td><code>${esc(p)}</code></td><td>${d}</td></tr>`
    )
    .join('');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(cfg.addonName)} — addon de Stremio</title>
<style>
  :root{color-scheme:dark;--bg:#0b0e14;--card:#141925;--fg:#e6e9ef;--mut:#8b93a7;--acc:#7c5cff;--ok:#3ddc97}
  *{box-sizing:border-box}
  body{margin:0;font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--fg)}
  .wrap{max-width:760px;margin:0 auto;padding:48px 20px 80px}
  .badge{display:inline-block;padding:4px 10px;border:1px solid #2a3145;border-radius:999px;color:var(--mut);font-size:13px}
  h1{font-size:34px;margin:14px 0 6px;letter-spacing:-.02em}
  p.lead{color:var(--mut);margin:0 0 28px}
  .card{background:var(--card);border:1px solid #212838;border-radius:14px;padding:20px;margin-bottom:18px}
  .url{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .u{flex:1;min-width:220px;background:#0d111b;border:1px solid #262d40;border-radius:10px;padding:10px 12px;color:#a9e9ff;word-break:break-all;font-size:14px}
  button{background:var(--acc);color:#fff;border:0;border-radius:10px;padding:11px 18px;font-size:15px;font-weight:600;cursor:pointer}
  button:hover{filter:brightness(1.1)}
  a.btn{display:inline-block;background:transparent;border:1px solid #2f3750;color:var(--fg);text-decoration:none;border-radius:10px;padding:10px 16px;font-size:14px}
  table{width:100%;border-collapse:collapse;font-size:14px}
  td,th{text-align:left;padding:8px 6px;border-bottom:1px solid #1e2433;vertical-align:top}
  th{color:var(--mut);font-weight:500;font-size:12px;text-transform:uppercase;letter-spacing:.06em}
  .m{color:var(--ok);font-weight:600;width:52px}
  h2{font-size:15px;color:var(--mut);text-transform:uppercase;letter-spacing:.08em;margin:0 0 12px}
  #st{color:var(--mut);font-size:14px}
  #st.ok{color:var(--ok)}
  #st.bad{color:#ff7b7b}
  ol{color:var(--mut);padding-left:20px;margin:0}
  ol li{margin-bottom:6px}
</style>
</head>
<body>
<div class="wrap">
  <span class="badge">v${esc(VERSION)} · Cloudflare Worker</span>
  <h1>${esc(cfg.addonName)}</h1>
  <p class="lead">${esc(cfg.addonDescription)}</p>

  <div class="card">
    <h2>Instalar en Stremio</h2>
    <div class="url">
      <div class="u" id="mf">${esc(manifestUrl)}</div>
      <button id="cp" type="button">Copiar URL</button>
      <a class="btn" href="${esc(deepLink)}">Abrir Stremio</a>
    </div>
    <p style="color:var(--mut);font-size:14px;margin:14px 0 0">
      O en Stremio: <b>Addons</b> &rarr; lupa &rarr; pega la URL.
    </p>
  </div>

  <div class="card">
    <h2>Rutas</h2>
    <table>
      <thead><tr><th></th><th>Ruta</th><th>Descripción</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  <div class="card">
    <h2>Estado</h2>
    <div id="st">Comprobando…</div>
  </div>
</div>
<script>
document.getElementById('cp').addEventListener('click', async () => {
  const t = document.getElementById('mf').textContent;
  try { await navigator.clipboard.writeText(t); } catch (e) {}
  const b = document.getElementById('cp');
  b.textContent = '¡Copiado!';
  setTimeout(() => { b.textContent = 'Copiar URL'; }, 1600);
});
fetch('/health').then(r => r.json()).then(h => {
  const el = document.getElementById('st');
  el.className = 'ok';
  el.textContent = 'Operativo — ' + h.addon + ' v' + h.version + ' · origen ' + h.origin;
}).catch(() => {
  const el = document.getElementById('st');
  el.className = 'bad';
  el.textContent = 'No se pudo leer /health';
});
</script>
</body>
</html>`;
}

/** Cuerpo de /health: suficiente para saber qué configuración está activa. */
export function healthPayload(cfg) {
  return {
    status: 'ok',
    addon: cfg.addonName,
    version: cfg.version,
    time: new Date().toISOString(),
    origin: cfg.origin,
    cacheTtlSeconds: cfg.cacheTtlSeconds,
    negativeCacheTtlSeconds: cfg.negativeCacheTtlSeconds,
    upstreamTimeoutMs: cfg.upstreamTimeoutMs,
    upstreamRetries: cfg.upstreamRetries,
    maxStreams: cfg.maxStreams,
    debug: cfg.debug,
  };
}
