// Sätteri hast plugin: make internal links in Markdown content point
// straight at the canonical URL, so they don't go through a redirect.
//
// The site builds with trailingSlash: 'always', so /post/foo 301s to
// /post/foo/. Posts are written by hand and often leave the slash off, and
// some link to the bare authgear.com host, which redirects to www. Fixing
// the links at build time covers existing posts and any written later.

const SITE = 'https://www.authgear.com';
const APEX = /^https?:\/\/authgear\.com(?=\/|$|[?#])/i;
const WWW = /^https?:\/\/www\.authgear\.com(?=\/|$|[?#])/i;

/**
 * Return the canonical form of an internal href, or the href unchanged when
 * it is external, a file, or already canonical.
 * @param {string} href
 * @returns {string}
 */
export function canonicalInternalHref(href) {
  let origin = '';
  let rest;
  if (APEX.test(href)) {
    origin = SITE;
    rest = href.replace(APEX, '');
  } else if (WWW.test(href)) {
    origin = SITE;
    rest = href.replace(WWW, '');
  } else if (href.startsWith('/') && !href.startsWith('//')) {
    rest = href;
  } else {
    return href;
  }
  const cut = rest.search(/[?#]/);
  let pathname = cut === -1 ? rest : rest.slice(0, cut);
  const tail = cut === -1 ? '' : rest.slice(cut);
  if (pathname === '') pathname = '/';
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  // A last segment with an extension is a file (/images/a.png, /sitemap.xml).
  if (!pathname.endsWith('/') && !/\.[a-z0-9]+$/i.test(last)) pathname += '/';
  return origin + pathname + tail;
}

const RAW_ANCHOR_HREF = /(<a\b[^>]*?\bhref\s*=\s*)(["'])([^"']*)\2/gi;

/**
 * Apply canonicalInternalHref to every `<a href>` in a raw HTML string.
 * @param {string} html
 * @returns {string}
 */
export function canonicalizeRawHtmlLinks(html) {
  return html.replace(RAW_ANCHOR_HREF, (_m, head, quote, href) =>
    `${head}${quote}${canonicalInternalHref(href)}${quote}`);
}

/**
 * Sätteri hast plugin (see `hastPlugins` in astro.config.mjs). Markdown links
 * arrive as `a` elements; HTML written inline in a post stays an opaque `raw`
 * node, so those are rewritten as text.
 */
export default function internalLinkSlashPlugin() {
  return {
    name: 'internal-link-slash',
    element: {
      filter: ['a'],
      visit(node, ctx) {
        const href = node.properties?.href;
        if (typeof href !== 'string') return;
        const canonical = canonicalInternalHref(href);
        if (canonical !== href) ctx.setProperty(node, 'href', canonical);
      },
    },
    raw(node) {
      const value = canonicalizeRawHtmlLinks(node.value);
      if (value !== node.value) return { type: 'raw', value };
    },
  };
}
