import { textFor, type LText, type SiteLocale } from './locales';
import type { CmsPage, MediaInfo, PublicProduct, SiteCollection, SiteCollectionItem, SiteSettings } from './model';

export interface NavLink { href: string; label: string; current: boolean }

export interface FormState {
  /** Section id of the form the status belongs to. */
  sectionId: string;
  kind: 'sent' | 'error';
  code?: string;
}

/** Everything a renderer may read. Built by Hub from Rodrigo's published (or draft preview) data. */
export interface RenderContext {
  settings: SiteSettings;
  locale: SiteLocale;
  /** `/s/{slug}` or `/s/{slug}/{locale}` without trailing slash. */
  basePath: string;
  page: CmsPage | null;
  nav: { header: NavLink[]; footer: NavLink[] };
  media: (id: string) => MediaInfo | undefined;
  collections: SiteCollection[];
  items: (collectionId: string) => SiteCollectionItem[];
  /** Set on a collection detail page. */
  currentItem?: { collection: SiteCollection; item: SiteCollectionItem };
  products: PublicProduct[];
  formatPrice: (priceCents: number) => string;
  form: {
    action: (sectionId: string) => string;
    /** Signed issue time for the minimum-fill-time check. */
    token: string;
    state?: FormState;
  };
  preview: boolean;
}

export function t(ctx: RenderContext, value: LText | undefined | null): string {
  return textFor(value, ctx.locale, ctx.settings.defaultLocale);
}

/** Internal links are site-relative: `/about` → `{basePath}/about`. */
export function resolveHref(ctx: RenderContext, link: string): string {
  if (link.startsWith('/')) return link === '/' ? `${ctx.basePath}/` : `${ctx.basePath}${link}`;
  return link;
}

export function itemHref(ctx: RenderContext, collection: SiteCollection, item: SiteCollectionItem): string {
  return `${ctx.basePath}/${collection.slug}/${item.slug}`;
}

/** Minimal UI strings rendered on public pages, in every supported locale. */
const UI = {
  menu: { en: 'Menu', de: 'Menü', sk: 'Menu', hu: 'Menü', es: 'Menú' },
  skip: { en: 'Skip to content', de: 'Zum Inhalt springen', sk: 'Preskočiť na obsah', hu: 'Ugrás a tartalomhoz', es: 'Saltar al contenido' },
  send: { en: 'Send', de: 'Senden', sk: 'Odoslať', hu: 'Küldés', es: 'Enviar' },
  sent: { en: 'Thank you. Your message was sent.', de: 'Danke. Ihre Nachricht wurde gesendet.', sk: 'Ďakujeme. Vaša správa bola odoslaná.', hu: 'Köszönjük. Üzenetét elküldtük.', es: 'Gracias. Tu mensaje se ha enviado.' },
  failed: { en: 'The message could not be sent. Check the fields and try again.', de: 'Die Nachricht konnte nicht gesendet werden. Prüfen Sie die Felder und versuchen Sie es erneut.', sk: 'Správu sa nepodarilo odoslať. Skontrolujte polia a skúste to znova.', hu: 'Az üzenetet nem sikerült elküldeni. Ellenőrizze a mezőket, és próbálja újra.', es: 'No se pudo enviar el mensaje. Revisa los campos e inténtalo de nuevo.' },
  busy: { en: 'Too many messages right now. Try again in a minute.', de: 'Gerade zu viele Nachrichten. Versuchen Sie es in einer Minute erneut.', sk: 'Práve je priveľa správ. Skúste to o minútu.', hu: 'Most túl sok az üzenet. Próbálja újra egy perc múlva.', es: 'Demasiados mensajes ahora. Inténtalo dentro de un minuto.' },
  required: { en: 'required', de: 'Pflichtfeld', sk: 'povinné', hu: 'kötelező', es: 'obligatorio' },
  close: { en: 'Close', de: 'Schließen', sk: 'Zavrieť', hu: 'Bezárás', es: 'Cerrar' },
  open: { en: 'Open image', de: 'Bild öffnen', sk: 'Otvoriť obrázok', hu: 'Kép megnyitása', es: 'Abrir imagen' },
  readMore: { en: 'Read more', de: 'Weiterlesen', sk: 'Čítať ďalej', hu: 'Tovább', es: 'Leer más' },
  language: { en: 'Language', de: 'Sprache', sk: 'Jazyk', hu: 'Nyelv', es: 'Idioma' },
  empty: { en: 'Nothing here yet.', de: 'Hier gibt es noch nichts.', sk: 'Zatiaľ tu nič nie je.', hu: 'Itt még nincs semmi.', es: 'Aún no hay nada aquí.' },
  preview: { en: 'Draft preview — not public', de: 'Entwurfsvorschau — nicht öffentlich', sk: 'Náhľad konceptu — neverejné', hu: 'Piszkozat előnézet — nem nyilvános', es: 'Vista previa del borrador — no pública' },
  notFound: { en: 'Page not found', de: 'Seite nicht gefunden', sk: 'Stránka sa nenašla', hu: 'Az oldal nem található', es: 'Página no encontrada' },
} as const satisfies Record<string, Record<SiteLocale, string>>;

export type UiKey = keyof typeof UI;

export function ui(locale: SiteLocale, key: UiKey): string {
  return UI[key][locale];
}
