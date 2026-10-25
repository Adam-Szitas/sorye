import type { Metadata } from 'next';
import Link from 'next/link';
import { ArchitectureNav } from '@/components/architecture-nav';
import './architecture.css';

export const metadata: Metadata = {
  title: 'Architecture · Sorye',
  description:
    'How Sorye apps, the Hub kernel, Relay, storage, and Docker fit together.',
};

export default function ArchitecturePage() {
  return (
    <div className="arch-root">
      <header className="arch-header glass">
        <Link href="/" className="text-sm font-semibold tracking-tight text-[var(--color-text)]">
          Sorye
        </Link>
        <nav className="flex items-center gap-1" aria-label="Site">
          <Link
            href="/contact"
            className="rounded-lg px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text)]"
          >
            Contact
          </Link>
          <Link
            href="/login"
            className="rounded-lg px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text)]"
          >
            Sign in
          </Link>
        </nav>
      </header>

      <div className="arch-layout">
        <ArchitectureNav />
        <main>
          <header className="arch-hero">
            <p className="arch-kicker">Platform</p>
            <h1>How Sorye fits together</h1>
            <p className="arch-lede">
              Apps are frontends. Hub is the kernel. They meet on <span className="arch-code">/api</span>,
              and Relay carries anything that has to leave one app and land in another.
            </p>
          </header>

          <section id="map" className="arch-section" style={{ contentVisibility: 'visible' }}>
            <h2>System</h2>
            <p>
              Each app can be built and served on its own. It still talks only to the kernel.
              The kernel is one Next.js process today, not a backend per app.
            </p>
            <div className="arch-map">
              <article className="arch-node">
                <h3>Apps</h3>
                <p>Own UI. Private state. No imports of each other.</p>
                <ul>
                  <li>React remotes on their own ports (Tasks, Messenger, Studio, …)</li>
                  <li>Hub-native screens (Mail, Drive, Site, Reports)</li>
                  <li>
                    <span className="arch-code">@sorye/platform</span> for React, Vue, Angular, and Lit. Tasks is the reference remote.
                  </li>
                </ul>
              </article>
              <div className="arch-join" aria-hidden="true">
                →
              </div>
              <article className="arch-node arch-node-kernel">
                <h3>Kernel · Hub</h3>
                <p>Session, catalog, and every API. Validates, then routes.</p>
                <ul>
                  <li>Auth.js session and <span className="arch-code">ensureHubUser()</span></li>
                  <li>
                    <span className="arch-code">/api/*</span> scoped to the workspace on the server
                  </li>
                  <li>Global signals apps can read, not write</li>
                </ul>
              </article>
              <div className="arch-join" aria-hidden="true">
                →
              </div>
              <article className="arch-node">
                <h3>Backends by job</h3>
                <p>One store per kind of work. Apps do not each get a database.</p>
                <ul>
                  <li>Postgres — users, workspaces, app documents</li>
                  <li>Disk <span className="arch-code">.data</span> — Relay, mail, Drive bytes</li>
                  <li>MinIO later — Drive bytes off the kernel disk</li>
                </ul>
              </article>
            </div>
          </section>

          <section id="request" className="arch-section">
            <h2>A request</h2>
            <p>What happens when someone opens an app and saves something.</p>
            <ol className="arch-steps">
              <li>
                <span className="arch-num">1</span>
                <div>
                  <strong>Sign in on Hub</strong>
                  <p>
                    The browser loads <span className="arch-code">:3000</span>. Auth.js keeps the session.
                    <span className="arch-code"> ensureHubUser()</span> resolves the user and the active workspace.
                  </p>
                </div>
              </li>
              <li>
                <span className="arch-num">2</span>
                <div>
                  <strong>Hub mounts the app</strong>
                  <p>
                    Remotes expose <span className="arch-code">./mount</span> and Hub pulls{' '}
                    <span className="arch-code">remoteEntry.js</span> from that app’s port. Mail, Drive, and
                    the other Hub-native apps render in the same bundle.
                  </p>
                </div>
              </li>
              <li>
                <span className="arch-num">3</span>
                <div>
                  <strong>The app calls the kernel</strong>
                  <p>
                    <span className="arch-code">fetch(&apos;/api/...&apos;, &#123; credentials: &apos;include&apos; &#125;)</span>.
                    The page origin is Hub, so the session cookie is sent even though the script came from another port.
                  </p>
                </div>
              </li>
              <li>
                <span className="arch-num">4</span>
                <div>
                  <strong>Hub writes the workspace</strong>
                  <p>
                    The route ignores any workspace id in the body and uses the session. Postgres or the{' '}
                    <span className="arch-code">.data</span> files take the write.
                  </p>
                </div>
              </li>
            </ol>
            <p className="arch-note">
              Embedded apps run inside the Hub page, so <span className="arch-code">/api</span> is same-origin.
              A remote opened on its own port can call the same APIs with the Hub session cookie (
              <span className="arch-code">VITE_HUB_ORIGIN</span>
              ). Relay still runs inside Hub, not in the app.
            </p>
          </section>

          <section id="events" className="arch-section">
            <h2>Relay</h2>
            <p>How one app reaches another without calling it.</p>
            <ol className="arch-steps">
              <li>
                <span className="arch-num">1</span>
                <div>
                  <strong>The app emits</strong>
                  <p>
                    <span className="arch-code">kernel.emit</span> or{' '}
                    <span className="arch-code">emitWorkspaceEvent</span> posts to{' '}
                    <span className="arch-code">/api/events</span>. Names are allowlisted. The client does not send a workspace id.
                  </p>
                </div>
              </li>
              <li>
                <span className="arch-num">2</span>
                <div>
                  <strong>Hub checks the workspace</strong>
                  <p>Payload size, the event name, and the workspace feature flag. Disabled events stop here.</p>
                </div>
              </li>
              <li>
                <span className="arch-num">3</span>
                <div>
                  <strong>Relay delivers in-process</strong>
                  <p>
                    Messenger <span className="arch-code">#events</span> and HTTPS webhooks are live. Email and
                    WhatsApp are queued until those connectors exist.
                  </p>
                </div>
              </li>
              <li>
                <span className="arch-num">4</span>
                <div>
                  <strong>The shell shows it</strong>
                  <p>
                    A notification record updates the bell and the launcher badge (
                    <span className="arch-code">sorye:hub:notify</span>).
                  </p>
                </div>
              </li>
            </ol>
            <p className="arch-note">
              Handoffs (<span className="arch-code">/api/handoffs</span>) are the same idea with a payload the
              target app polls. Messenger chat is a separate API. <span className="arch-code">#events</span> is
              the channel Relay fills.
            </p>
          </section>

          <section id="state" className="arch-section">
            <h2>State</h2>
            <p>Two scopes. The kernel never reads an app’s private fields. An app never writes kernel state except through an API.</p>
            <div className="arch-grid">
              <article className="arch-card">
                <span className="arch-pill arch-pill-live">Kernel</span>
                <h3>Global</h3>
                <p>
                  Workspace name, signed-in user, focused app, unread count. Hub owns the signals. Apps get a read-only view through <span className="arch-code">@sorye/platform</span>.
                </p>
              </article>
              <article className="arch-card">
                <span className="arch-pill arch-pill-live">App</span>
                <h3>Private</h3>
                <p>
                  That app’s UI and drafts. Keep this in signals from{' '}
                  <span className="arch-code">@sorye/platform</span> (React, Vue, Angular, or Lit adapters).
                  Other apps cannot import it.
                </p>
              </article>
            </div>
            <p className="arch-note">
              Cross-app writes go through <span className="arch-code">kernel.emit</span> and{' '}
              <span className="arch-code">kernel.navigate</span>, which call Hub. Opening Tasks on port 3005
              uses <span className="arch-code">VITE_HUB_ORIGIN</span> and the same session.{' '}
              <span className="arch-code">localStorage</span> is only for chrome such as pane widths.
            </p>
          </section>

          <section id="storage" className="arch-section">
            <h2>Storage</h2>
            <p>Three layers. Production refuses the JSON driver and the local auth bypass.</p>
            <div className="arch-grid">
              <article className="arch-card">
                <span className="arch-pill arch-pill-live">Postgres</span>
                <h3>Records</h3>
                <p>Users, workspaces, Messenger, Canvas, and Tasks, Notes, and Calendar documents.</p>
              </article>
              <article className="arch-card">
                <span className="arch-pill arch-pill-live">.data</span>
                <h3>Kernel disk</h3>
                <p>
                  Relay, events, notifications, handoffs, Mail, Storefront, Site, reports, and Drive bytes
                  under <span className="arch-code">files/&#123;workspaceId&#125;/&#123;uuid&#125;</span>.
                </p>
              </article>
              <article className="arch-card">
                <span className="arch-pill arch-pill-later">Browser</span>
                <h3>Chrome only</h3>
                <p>Selected tab, pane layout, dismissed guides. Not the system of record.</p>
              </article>
            </div>
          </section>

          <section id="docker" className="arch-section">
            <h2>Docker</h2>
            <p>
              Compose runs Postgres today. Hub and the app bundles still start on the host with{' '}
              <span className="arch-code">pnpm dev</span>. Add the other containers beside that database.
              Do not add a tasks API or a notes API.
            </p>
            <div className="arch-grid">
              <article className="arch-card" data-status="live">
                <span className="arch-pill arch-pill-live">Live</span>
                <h3>Postgres 16</h3>
                <p>
                  <span className="arch-code">pnpm db:up</span>, port 5432, volume{' '}
                  <span className="arch-code">sorye_pg_data</span>. Host tools use{' '}
                  <span className="arch-code">localhost</span>. The Hub container will use hostname{' '}
                  <span className="arch-code">postgres</span>.
                </p>
              </article>
              <article className="arch-card" data-status="next">
                <span className="arch-pill arch-pill-next">Next</span>
                <h3>Hub</h3>
                <p>
                  One Next.js replica. Session, catalog, and all APIs. Mount{' '}
                  <span className="arch-code">apps/hub/.data</span> or mail, Relay, and Drive vanish when the
                  container is recreated. A second replica would split live Canvas cursors.
                </p>
              </article>
              <article className="arch-card" data-status="next">
                <span className="arch-pill arch-pill-next">Next</span>
                <h3>One image per app</h3>
                <p>
                  nginx serving that app’s <span className="arch-code">dist/</span>. The browser loads{' '}
                  <span className="arch-code">remoteEntry.js</span>. Remote URLs are baked in when the Hub
                  image builds, so they must be browser URLs, not Docker DNS names.
                </p>
              </article>
              <article className="arch-card" data-status="later">
                <span className="arch-pill arch-pill-later">Later</span>
                <h3>MinIO</h3>
                <p>Drive bytes. Postgres or the metadata file keeps the id, name, and workspace. Not required to boot.</p>
              </article>
              <article className="arch-card" data-status="later">
                <span className="arch-pill arch-pill-later">Later</span>
                <h3>Mail worker</h3>
                <p>
                  Same Node image, other command. IMAP sync and SMTP send stay off the request path. Not a
                  public mail server. Set <span className="arch-code">MAIL_SECRET_KEY</span> before it runs.
                </p>
              </article>
              <article className="arch-card" data-status="later">
                <span className="arch-pill arch-pill-later">Later</span>
                <h3>LISTEN/NOTIFY</h3>
                <p>
                  Only when Hub has more than one replica. That is the fan-out for Relay and Canvas. Redis is
                  not part of this layout.
                </p>
              </article>
            </div>
            <p className="arch-note">
              Google OAuth, Sentry, Stripe, and each user’s IMAP host stay outside Docker.
            </p>
          </section>

          <section id="setup" className="arch-section">
            <h2>Setup order</h2>
            <p>Boot the kernel against Postgres before splitting mail or files.</p>
            <ol className="arch-steps">
              <li>
                <span className="arch-num">1</span>
                <div>
                  <strong>Database</strong>
                  <p>
                    <span className="arch-code">pnpm db:up</span>,{' '}
                    <span className="arch-code">STORE_DRIVER=postgres</span>,{' '}
                    <span className="arch-code">pnpm db:push</span>. Restart Hub and confirm Tasks, Notes, and
                    Calendar are still there.
                  </p>
                </div>
              </li>
              <li>
                <span className="arch-num">2</span>
                <div>
                  <strong>Hub image</strong>
                  <p>
                    Repo-root build, volume on <span className="arch-code">.data</span>,{' '}
                    <span className="arch-code">DATABASE_URL</span> aimed at{' '}
                    <span className="arch-code">postgres:5432</span>. Post an event and confirm Relay stored it
                    on the volume.
                  </p>
                </div>
              </li>
              <li>
                <span className="arch-num">3</span>
                <div>
                  <strong>One app image</strong>
                  <p>Tasks on port 3005. Open it from Hub and emit one workspace event.</p>
                </div>
              </li>
              <li>
                <span className="arch-num">4</span>
                <div>
                  <strong>The other remotes</strong>
                  <p>Same nginx pattern. Hub-native apps stay inside the Hub container.</p>
                </div>
              </li>
              <li>
                <span className="arch-num">5</span>
                <div>
                  <strong>Files, then mail</strong>
                  <p>MinIO for Drive bytes. Then a mail worker with its own secret. User mail hosts stay outside the cluster.</p>
                </div>
              </li>
            </ol>
          </section>
        </main>
      </div>
    </div>
  );
}
