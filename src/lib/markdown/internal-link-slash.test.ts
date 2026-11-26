import { describe, expect, it } from 'vitest';
import internalLinkSlash, { canonicalInternalHref, canonicalizeRawHtmlLinks } from './internal-link-slash.mjs';

describe('canonicalInternalHref', () => {
  it.each([
    ['/post/jwe-vs-jwt', '/post/jwe-vs-jwt/'],
    ['/post/jwe-vs-jwt/', '/post/jwe-vs-jwt/'],
    ['/zh-hant/post/foo#faq', '/zh-hant/post/foo/#faq'],
    ['/schedule-demo?topic=sovereignty-review', '/schedule-demo/?topic=sovereignty-review'],
    ['https://www.authgear.com/tools/jwk-generator', 'https://www.authgear.com/tools/jwk-generator/'],
    ['https://authgear.com/', 'https://www.authgear.com/'],
    ['https://authgear.com', 'https://www.authgear.com/'],
    ['http://authgear.com/pricing', 'https://www.authgear.com/pricing/'],
    ['/', '/'],
  ])('%s -> %s', (input, expected) => {
    expect(canonicalInternalHref(input)).toBe(expected);
  });

  it.each([
    '/images/diagram.png',
    '/sitemap-index.xml',
    'https://docs.authgear.com/get-started',
    'https://portal.authgear.com',
    'https://example.com/post/foo',
    '//cdn.example.com/x',
    '#faq',
    'mailto:hello@authgear.com',
  ])('leaves %s alone', (href) => {
    expect(canonicalInternalHref(href)).toBe(href);
  });
});

describe('internalLinkSlash', () => {
  const run = (href: unknown) => {
    const node = { type: 'element', tagName: 'a', properties: { href } };
    const ctx = { setProperty: (n: typeof node, key: 'href', value: unknown) => { n.properties[key] = value; } };
    internalLinkSlash().element.visit(node, ctx);
    return node.properties.href;
  };

  it('visits only <a> elements', () => {
    expect(internalLinkSlash().element.filter).toEqual(['a']);
  });

  it('rewrites an internal href', () => {
    expect(run('/post/foo')).toBe('/post/foo/');
  });

  it('leaves external and missing hrefs alone', () => {
    expect(run('https://example.com/a')).toBe('https://example.com/a');
    expect(run(undefined)).toBeUndefined();
  });

  it('rewrites anchors inside raw HTML and returns a replacement node', () => {
    const out = internalLinkSlash().raw({ type: 'raw', value: '<a href="/features/passkeys" target="_blank">' });
    expect(out).toEqual({ type: 'raw', value: '<a href="/features/passkeys/" target="_blank">' });
  });

  it('returns nothing for raw HTML that needs no change', () => {
    expect(internalLinkSlash().raw({ type: 'raw', value: '<br>' })).toBeUndefined();
  });
});

describe('canonicalizeRawHtmlLinks', () => {
  it('rewrites every internal anchor href, with either quote style', () => {
    expect(canonicalizeRawHtmlLinks(
      `<a class="x" href="/post/a">A</a> <A HREF='https://authgear.com/pricing'>B</A>`,
    )).toBe(`<a class="x" href="/post/a/">A</a> <A HREF='https://www.authgear.com/pricing/'>B</A>`);
  });

  it('leaves non-anchor tags, files and external links alone', () => {
    const html = '<img src="/post/a"><link href="/css/site"><a href="/images/x.png"></a><a href="https://example.com/a"></a>';
    expect(canonicalizeRawHtmlLinks(html)).toBe(html);
  });
});
