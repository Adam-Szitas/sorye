# App landing pages — mandatory contributor steering

Every app in `packages/types/src/apps.ts` must have public, plain-language copy in `apps/hub/lib/app-landings.ts` and a working `/learn/<slug>` page. Every app change must review and update its landing page in the same change; for internal-only changes, explicitly record that the public description remains accurate. New apps must ship with their landing page, never a placeholder.

Explain what the app helps someone do, then give three simple steps. Avoid unexplained jargon. State real limitations, required services, external ownership, and administrator restrictions. Never promise planned features as available. Check the actual app and `docs/apps/APPS.md`, not only existing marketing copy.

Verify catalog coverage, unknown slugs, anonymous access, app-opening links, and exact subdomain matching. Keep private app routes and APIs authenticated. Public pages must not load workspace records or mount the app.

## Hosting

The Hub serves `/learn/<slug>` without sign-in. An exact `<catalog slug>.sorye.app` hostname at `/` rewrites to that page. Configure DNS, TLS certificates, and ingress for each catalog subdomain to reach the Hub. Keep remote JavaScript assets on their existing remote origins; do not redirect remoteEntry.js or asset paths to landing pages. The Open button goes to the canonical `https://sorye.app` app route, preserving the existing sign-in flow.

Examples: `protocolio.sorye.app`, `devkit.sorye.app`, and `files.sorye.app` (Drive). Unknown hosts do not select an app. DNS and certificate provisioning are deployment work and are not performed by these source changes.

These are product presentation pages for SEO and advertising. Maintain a clear benefit, truthful simple steps, and a prominent app-opening action. Each page needs a unique title and description, social metadata, and one canonical URL. The canonical URLs use https://sorye.app/learn/<slug> so subdomain and path visits do not compete in search. /sitemap.xml lists all catalog landing pages.

## Localization

Use en, de, sk, hu, es for translated presentation pages; esp is an input alias for es. Translate descriptions, steps, calls to action and SEO metadata together. All 20 landing pages now have English, German, Slovak, Hungarian and Spanish copy, including steps, controls and metadata. See I18N.md.

Public landing pages use /learn/<slug>/<locale> for en, de, sk, hu and es. Each URL renders translated text and metadata on the server, has a self-canonical URL and hreflang alternatives, and is listed in the sitemap. Language links preserve the app. Unqualified landing URLs and catalog subdomain roots select the best supported Accept-Language preference (English fallback) with a private, non-cacheable temporary redirect; esp redirects to es. The URL owns landing language, independently of the workspace browser preference. Unsupported languages return 404. New apps must add all five translations; preserve limitations in every translation.

Protocolio editor → authenticated Hub generate/validate/health endpoints → separate Protocolio renderer and its MongoDB. SDK source belongs to the Protocolio repository; Sorye consumes a versioned archive. Browser generation no longer falls back to direct engine access. See PROTOCOLIO.md for deployment and credentials.
