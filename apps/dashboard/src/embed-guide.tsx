import { useMemo, useState } from 'react';
import type { AppCatalogEntry, EmbedWidget, HubSession } from '@sorye/types';
import { APP_CATALOG } from '@sorye/types';

interface EmbedGuideProps {
  session: HubSession;
  widgets: EmbedWidget[];
  hubOrigin: string;
}

const STEPS = [
  {
    title: 'Enable apps in the Hub',
    body: 'Open Manage apps and turn on the Sorye apps you want inside your product. Only enabled apps can be embedded — this is your whitelist.',
  },
  {
    title: 'Create an embed widget',
    body: 'In Hub → Connections → Embed widgets, name your product, add allowed origins (your site URL), and pick which enabled apps the key may host.',
  },
  {
    title: 'Drop in the iframe snippet',
    body: 'Load embed.js on your site and call SoryeEmbed.mount(). Your users see the same app UI as in Sorye, framed inside your product.',
  },
  {
    title: 'Revoke anytime',
    body: 'If a key is leaked or you leave a partner, revoke it in Connections. Existing iframes stop authorizing on the next bootstrap.',
  },
] as const;

function buildSnippet(
  hubOrigin: string,
  appSlug: string,
  keyPlaceholder: string,
) {
  return `<!-- In your app (HTML) -->
<script src="${hubOrigin}/embed.js"></script>
<div id="sorye-app" style="height:640px;width:100%"></div>
<script>
  SoryeEmbed.mount('#sorye-app', {
    app: '${appSlug}',
    key: '${keyPlaceholder}'
  });
</script>`;
}

export function EmbedGuide({ session, widgets, hubOrigin }: EmbedGuideProps) {
  const [copied, setCopied] = useState(false);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const enabledApps = useMemo(() => {
    const selected = new Set(session.workspace.selectedAppIds);
    return APP_CATALOG.filter(
      (app) =>
        selected.has(app.id) &&
        app.status === 'available' &&
        Boolean(app.microFrontend),
    );
  }, [session.workspace.selectedAppIds]);

  const activeApp: AppCatalogEntry | undefined =
    enabledApps.find((a) => a.slug === selectedSlug) ?? enabledApps[0];

  const keyHint =
    widgets[0]?.keyHint != null
      ? `sk_embed_…${widgets[0].keyHint.replace('••••', '')}`
      : 'sk_embed_YOUR_KEY';

  const snippet = buildSnippet(
    hubOrigin || 'https://your-hub.example',
    activeApp?.slug ?? 'notes',
    widgets.length > 0 ? 'sk_embed_… (paste the key from Connections)' : keyHint,
  );

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(
        buildSnippet(
          hubOrigin || 'https://your-hub.example',
          activeApp?.slug ?? 'notes',
          'sk_embed_PASTE_KEY_HERE',
        ),
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="embed-guide" aria-labelledby="embed-guide-title">
      <div className="embed-guide-hero">
        <p className="embed-guide-eyebrow">Bring Sorye into your product</p>
        <h2 id="embed-guide-title">Connect apps to your own app</h2>
        <p>
          Embed the apps you enabled in Sorye as iframes in your product. Your
          hub whitelist controls what is available; an embed key + origin
          allowlist controls who can host them.
        </p>
      </div>

      <ol className="embed-steps">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <span className="embed-step-num" aria-hidden>
              {index + 1}
            </span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="embed-guide-grid">
        <article className="embed-card">
          <h3>Your whitelist</h3>
          {enabledApps.length === 0 ? (
            <p className="embed-muted">
              No apps enabled yet. Open{' '}
              <a href="/">the Hub</a>, choose Manage apps, then come back.
            </p>
          ) : (
            <ul className="embed-app-list">
              {enabledApps.map((app) => (
                <li key={app.id}>
                  <button
                    type="button"
                    className={
                      activeApp?.id === app.id ? 'embed-app active' : 'embed-app'
                    }
                    onClick={() => setSelectedSlug(app.slug)}
                  >
                    <span
                      className="embed-app-dot"
                      style={{ background: app.color }}
                    />
                    {app.name}
                    <code>{app.slug}</code>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="embed-muted embed-card-foot">
            Widget keys can only host apps from this list.
          </p>
        </article>

        <article className="embed-card">
          <h3>Embed keys</h3>
          {widgets.length === 0 ? (
            <p className="embed-muted">
              No embed widgets yet. In the Hub top bar open{' '}
              <strong>Connections</strong> → <strong>Embed widgets</strong> and
              create a key for your site origin.
            </p>
          ) : (
            <ul className="embed-widget-list">
              {widgets.map((w) => (
                <li key={w.id}>
                  <strong>{w.name}</strong>
                  <span>
                    {w.keyHint} · {w.allowedOrigins.join(', ') || 'no origins'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <a className="embed-cta" href="/">
            Open Connections in Hub →
          </a>
        </article>
      </div>

      <article className="embed-snippet-card">
        <div className="embed-snippet-head">
          <div>
            <h3>Snippet for your app</h3>
            <p className="embed-muted">
              Hosts{' '}
              <strong>{activeApp?.name ?? 'an enabled app'}</strong> via iframe
              after origin + key checks.
            </p>
          </div>
          <button type="button" className="embed-copy" onClick={() => void copySnippet()}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre className="embed-snippet">
          <code>{snippet}</code>
        </pre>
      </article>

      <aside className="embed-notes">
        <h3>How authorization works</h3>
        <ul>
          <li>
            <strong>Hub App Library</strong> — which apps exist for your workspace
          </li>
          <li>
            <strong>Embed widget</strong> — which of those apps a key may host, and
            which website origins may request them
          </li>
          <li>
            <strong>Bootstrap</strong> — <code>embed.js</code> calls{' '}
            <code>/api/embed/bootstrap</code>; on success it opens a chrome-less{' '}
            <code>/embed/&lt;slug&gt;</code> iframe
          </li>
        </ul>
      </aside>
    </section>
  );
}
