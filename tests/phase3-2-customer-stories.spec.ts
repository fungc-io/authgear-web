import { test, expect } from '@playwright/test';

test.describe('Phase 3-2: /customer-stories', () => {
  test('/customer-stories listing returns 200 with lang=en', async ({ page }) => {
    const resp = await page.goto('/customer-stories/');
    expect(resp?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('footer').first()).toBeVisible();
  });

  test('/zh-hant/customer-stories returns 200 with lang=zh-Hant', async ({ page }) => {
    const resp = await page.goto('/zh-hant/customer-stories/');
    expect(resp?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant');
  });

  test('/customer-stories cache-control enables CDN caching', async ({ request }) => {
    const resp = await request.get('/customer-stories/');
    expect(resp.status()).toBe(200);
    const cc = resp.headers()['cache-control'] ?? '';
    expect(cc).toMatch(/s-maxage=\d+/);
  });
});

test.describe('customer story structured data', () => {
  for (const path of ['/customer-stories/bupa/', '/zh-hant/customer-stories/bupa/']) {
    test(`${path} emits Article JSON-LD`, async ({ page }) => {
      await page.goto(path);
      const blocks = await page.locator('script[type="application/ld+json"]').evaluateAll((els) =>
        els.map((el) => JSON.parse(el.textContent ?? '{}')),
      );
      const article = blocks.find((b) => b['@type'] === 'Article');
      expect(article, 'Article block').toBeDefined();
      expect(article.headline).toBe(await page.locator('h1').first().innerText());
      expect(article.mainEntityOfPage).toBe(await page.locator('link[rel="canonical"]').getAttribute('href'));
    });
  }
});
