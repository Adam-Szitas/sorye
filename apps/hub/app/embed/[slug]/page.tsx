import { MicroAppLoader } from '@/components/micro-app-loader';
import { verifyEmbedToken } from '@/lib/embed-token';
import { APP_CATALOG, getAppBySlug, originAllowed } from '@sorye/types';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

interface EmbedPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ t?: string }>;
}

export default async function EmbedAppPage({
  params,
  searchParams,
}: EmbedPageProps) {
  const { slug } = await params;
  const { t: token } = await searchParams;

  if (!token) {
    return (
      <EmbedError
        title="Missing embed token"
        detail="Load this app through the Sorye embed snippet so a signed token is issued for your origin."
      />
    );
  }

  const payload = verifyEmbedToken(token);
  if (!payload || payload.app !== slug) {
    return (
      <EmbedError
        title="Invalid or expired embed session"
        detail="Request a fresh token from /api/embed/bootstrap with your embed key."
      />
    );
  }

  const hdrs = await headers();
  const referer = hdrs.get('referer');
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (!originAllowed(payload.origins, refOrigin)) {
        return (
          <EmbedError
            title="Origin not allowed"
            detail={`This embed key does not allow ${refOrigin}. Add it to the widget allowlist in Sorye Hub.`}
          />
        );
      }
    } catch {
      // ignore malformed referer
    }
  }

  const catalogApp = getAppBySlug(APP_CATALOG, slug);
  if (!catalogApp || !payload.apps.includes(catalogApp.id)) {
    return (
      <EmbedError
        title="App not enabled"
        detail="This widget key is not allowed to host this app."
      />
    );
  }

  if (!catalogApp.microFrontend || catalogApp.status !== 'available') {
    notFound();
  }

  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-[var(--color-surface)]">
      <div className="flex min-h-0 flex-1 flex-col">
        <MicroAppLoader config={catalogApp.microFrontend} />
      </div>
    </div>
  );
}

function EmbedError({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-[#0b0f17] px-6 text-center text-slate-200">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="max-w-md text-sm text-slate-400">{detail}</p>
    </div>
  );
}
