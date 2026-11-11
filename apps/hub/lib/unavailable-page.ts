import { preferredLocale } from '@/lib/preferred-locale';

/**
 * The 503 page the middleware returns when a request fails before any page
 * renders. Plain HTML (no React, no external assets, no script), mirroring
 * components/status-page.tsx. It reloads itself every 30 seconds.
 */

const COPY = {
  en: { title: 'Sorye is temporarily unavailable', body: 'The service is starting or being configured. Please try again in a minute.', retry: 'Try again', auto: 'This page tries again by itself every 30 seconds.' },
  de: { title: 'Sorye ist vorübergehend nicht verfügbar', body: 'Der Dienst startet gerade oder wird eingerichtet. Versuche es in einer Minute erneut.', retry: 'Erneut versuchen', auto: 'Diese Seite versucht es alle 30 Sekunden selbst erneut.' },
  sk: { title: 'Sorye je dočasne nedostupný', body: 'Služba sa spúšťa alebo sa nastavuje. Skúste to o minútu znova.', retry: 'Skúsiť znova', auto: 'Táto stránka to každých 30 sekúnd skúsi znova sama.' },
  hu: { title: 'A Sorye átmenetileg nem érhető el', body: 'A szolgáltatás éppen indul vagy beállítás alatt áll. Próbáld újra egy perc múlva.', retry: 'Újrapróbálás', auto: 'Ez az oldal 30 másodpercenként magától újrapróbálkozik.' },
  es: { title: 'Sorye no está disponible temporalmente', body: 'El servicio se está iniciando o configurando. Inténtalo de nuevo en un minuto.', retry: 'Reintentar', auto: 'Esta página vuelve a intentarlo sola cada 30 segundos.' },
} as const;

const STYLE = `:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;min-height:100dvh;display:grid;place-items:center;overflow:hidden;background:#0b0f17;color:#f1f5f9;font:16px/1.5 "Segoe UI Variable","Segoe UI",system-ui,-apple-system,sans-serif;padding:64px 16px}
.glow{position:fixed;left:50%;top:50%;width:36rem;height:36rem;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle,rgba(56,189,248,.14),transparent 62%);pointer-events:none}
main{position:relative;max-width:28rem;width:100%;text-align:center;display:flex;flex-direction:column;align-items:center}
.mark{display:inline-grid;place-items:center;width:2.5rem;height:2.5rem;border-radius:.75rem;background:#38bdf8;color:#0b0f17;font-weight:700;box-shadow:0 8px 30px -8px rgba(56,189,248,.6);margin-bottom:2.5rem}
.code{font-size:clamp(6.5rem,20vw,8rem);font-weight:600;line-height:1;letter-spacing:-.05em;margin:0;background:linear-gradient(to bottom,rgba(255,255,255,.7),rgba(255,255,255,.04));-webkit-background-clip:text;background-clip:text;color:transparent;user-select:none}
h1{font-size:1.5rem;font-weight:600;letter-spacing:-.01em;margin:1rem 0 0;text-wrap:balance}
p.body{color:#94a3b8;margin:.75rem 0 0;text-wrap:pretty}
.auto{display:inline-flex;align-items:center;gap:.5rem;margin-top:1.25rem;font-size:.8125rem;color:rgba(148,163,184,.85)}
.dot{width:.5rem;height:.5rem;border-radius:50%;background:#fbbf24}
a.btn{display:inline-flex;align-items:center;justify-content:center;min-height:2.75rem;margin-top:2rem;padding:0 1.25rem;border-radius:.75rem;background:#38bdf8;color:#0b0f17;font-weight:500;font-size:.875rem;text-decoration:none}
a.btn:hover{filter:brightness(1.1)}a:focus-visible{outline:2px solid #38bdf8;outline-offset:3px}
@media (prefers-reduced-motion:no-preference){main{animation:rise .5s cubic-bezier(.2,.7,.2,1) both}.dot{animation:pulse 1.6s ease-in-out infinite}}
@keyframes rise{from{opacity:0;transform:translateY(8px)}}@keyframes pulse{50%{opacity:.35}}`;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function unavailablePageHtml(acceptLanguage: string | null, pathname: string): string {
  const locale = preferredLocale(acceptLanguage);
  const copy = COPY[locale];
  // Retry the same page; only a same-origin path, never a full URL from the request.
  const retry = pathname.startsWith('/') && !pathname.startsWith('//') ? pathname : '/';
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="30"><title>${escapeHtml(copy.title)}</title><style>${STYLE}</style></head>
<body><div class="glow" aria-hidden="true"></div><main><a class="mark" href="/" aria-label="Sorye">S</a><p class="code" aria-hidden="true">503</p><h1>${escapeHtml(copy.title)}</h1><p class="body">${escapeHtml(copy.body)}</p><span class="auto"><span class="dot" aria-hidden="true"></span>${escapeHtml(copy.auto)}</span><a class="btn" href="${escapeHtml(retry)}">${escapeHtml(copy.retry)}</a></main></body></html>`;
}
