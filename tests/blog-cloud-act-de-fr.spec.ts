import { test, expect } from '@playwright/test';

// The CLOUD Act explainer is written for the German and French markets only.
// It has no English version, and each language uses its own slug, so the pair
// is registered in TRANSLATION_SETS (src/lib/i18n.ts) rather than sharing one
// locale-neutral path. hreflang and the footer switcher must pair the two
// slugs and must never offer an English or Traditional Chinese URL.
const DE_POST = '/de/post/cloud-act-login-anbieter-nutzerdaten/';
const FR_POST = '/fr/post/cloud-act-fournisseur-identite-donnees-connexion/';

const hreflangs = async (page: import('@playwright/test').Page) =>
  (await page.locator('link[rel="alternate"][hreflang]').evaluateAll((els) =>
    els.map((el) => [el.getAttribute('hreflang') ?? '', el.getAttribute('href') ?? '']),
  )).sort(([a], [b]) => a.localeCompare(b));

test.describe('CLOUD Act explainer (de + fr)', () => {
  test(`${DE_POST} renders the German post`, async ({ page }) => {
    const resp = await page.goto(DE_POST);
    expect(resp?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.locator('main h1')).toContainText('CLOUD Act');
    await expect(page.locator('.blog-post__updated')).toContainText('Zuletzt aktualisiert');
    await expect(page.locator('.blog-post__cover-img')).toBeVisible();
    await expect(page.locator('.blog-post__body h2').filter({ hasText: 'Häufige Fragen' })).toHaveCount(1);
  });

  test(`${FR_POST} renders the French post`, async ({ page }) => {
    const resp = await page.goto(FR_POST);
    expect(resp?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.locator('main h1')).toContainText('CLOUD Act');
    await expect(page.locator('.blog-post__updated')).toContainText('Dernière mise à jour');
    await expect(page.locator('.blog-post__cover-img')).toBeVisible();
    await expect(page.locator('.blog-post__body h2').filter({ hasText: 'Questions fréquentes' })).toHaveCount(1);
  });

  test('each post links to its own localised pages', async ({ page }) => {
    await page.goto(DE_POST);
    let body = page.locator('.blog-post__body');
    await expect(body.locator('a[href="/de/solutions/data-sovereignty"]')).toHaveCount(1);
    await expect(body.locator('a[href="/de/compare/keycloak-alternative"]')).toHaveCount(1);
    await expect(body.locator('a[href="/dpa"]')).toHaveCount(1);
    await expect(body.locator('a[href="/sub-processors"]')).toHaveCount(1);

    await page.goto(FR_POST);
    body = page.locator('.blog-post__body');
    await expect(body.locator('a[href="/fr/solutions/data-sovereignty"]')).toHaveCount(1);
    await expect(body.locator('a[href="/fr/compare/keycloak-alternative"]')).toHaveCount(1);
  });

  test('both posts emit Article and FAQPage JSON-LD', async ({ page }) => {
    for (const url of [DE_POST, FR_POST]) {
      await page.goto(url);
      const types = await page.locator('script[type="application/ld+json"]').evaluateAll((els) =>
        els.map((el) => {
          try {
            return JSON.parse(el.textContent ?? '')['@type'] as string;
          } catch {
            return null;
          }
        }),
      );
      expect(types, url).toContain('Article');
      expect(types, url).toContain('FAQPage');
    }
  });

  test('hreflang pairs the two slugs and offers nothing else', async ({ page }) => {
    for (const url of [DE_POST, FR_POST]) {
      await page.goto(url);
      const alts = await hreflangs(page);
      expect(alts.map(([lang]) => lang), url).toEqual(['de', 'fr']);
      expect(new URL(alts[0][1]).pathname, url).toBe(DE_POST);
      expect(new URL(alts[1][1]).pathname, url).toBe(FR_POST);
    }
  });

  test('canonical points at the page itself', async ({ page }) => {
    for (const [url, expected] of [[DE_POST, DE_POST], [FR_POST, FR_POST]] as const) {
      await page.goto(url);
      const href = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(new URL(href ?? '').pathname, url).toBe(expected);
    }
  });

  test('footer switcher offers only the other language', async ({ page }) => {
    await page.goto(DE_POST);
    await expect(page.locator(`footer a[href="${FR_POST}"]`)).toHaveCount(1);
    await expect(page.locator('footer a[href^="/zh-hant/post/cloud-act"]')).toHaveCount(0);

    await page.goto(FR_POST);
    await expect(page.locator(`footer a[href="${DE_POST}"]`)).toHaveCount(1);
  });

  test('the slugs exist in one language only', async ({ request }) => {
    // The German slug under /fr/ (and vice versa) has no page, so the locale
    // fallback rule in public/_redirects sends it to the English URL, which
    // does not exist either — the post is deliberately de + fr only.
    for (const url of ['/post/cloud-act-login-anbieter-nutzerdaten/', '/post/cloud-act-fournisseur-identite-donnees-connexion/']) {
      const resp = await request.get(url, { maxRedirects: 0 });
      expect(resp.status(), url).toBe(404);
    }
  });
});
