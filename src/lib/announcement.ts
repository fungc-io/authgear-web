import { hasLocalizedPage, localizedPath, type Locale } from '@/lib/i18n';

/**
 * The single line of news in the top bar, above the nav.
 *
 * Hand-edited: this is the one place to change what the bar says, where it
 * points, and whether it shows at all. Set `enabled: false` to remove the bar
 * and the extra header height it takes with it.
 *
 * `text` and `cta` fall back to English for any locale they omit, and `href`
 * resolves to the English page for locales that have no translation of it — so
 * a locale with no entry shows an English line pointing at an English page,
 * rather than a translated line that lands somewhere the reader can't read.
 */
export interface Announcement {
  enabled: boolean;
  /** Locale-neutral site path, e.g. '/solutions/data-sovereignty/'. */
  href: string;
  /** Headline, one short line. Long text is truncated rather than wrapped. */
  text: Partial<Record<Locale, string>> & { en: string };
  /** Link label; an arrow is appended by the component. */
  cta: Partial<Record<Locale, string>> & { en: string };
}

export const announcement: Announcement = {
  enabled: true,
  href: '/solutions/data-sovereignty/',
  text: {
    en: "Data sovereignty: keep your users' data in the UK or the EU.",
    // The Traditional Chinese page targets Taiwan rather than Europe.
    'zh-Hant': '資料在地化：會員資料放在台灣，最安心。',
    es: 'Soberanía de datos: los datos de tus usuarios, en servidores europeos.',
    de: 'Datensouveränität: Nutzerdaten auf europäischen Servern.',
    // NBSP before the colon, per French typography.
    fr: 'Souveraineté des données : vos données sur des serveurs européens.',
    // No `ja`: /solutions/data-sovereignty/ has no Japanese translation, so
    // Japanese readers get the English line and the English page together.
  },
  cta: {
    en: 'See how',
    'zh-Hant': '了解更多',
    es: 'Descubre cómo',
    de: 'So funktioniert es',
    fr: 'Découvrir',
  },
};

/** The announcement as it should render for `locale`, or null when switched off. */
export function announcementFor(locale: string): { text: string; cta: string; href: string } | null {
  if (!announcement.enabled) return null;
  const loc = locale as Locale;
  const text = announcement.text[loc] ?? announcement.text.en;
  const cta = announcement.cta[loc] ?? announcement.cta.en;
  // Point at the reader's own language only where that page exists; otherwise
  // link straight to English instead of relying on a redirect.
  const target = hasLocalizedPage(locale, announcement.href) ? locale : 'en';
  return { text, cta, href: localizedPath(target, announcement.href) };
}
