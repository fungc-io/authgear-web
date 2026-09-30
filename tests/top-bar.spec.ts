import { test, expect } from '@playwright/test';

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

// The banner is position: fixed, so pages clear it with
// --layout-fixed-header-height. Too small a value and the nav sits on top of
// the first section — checked at both widths, since the bar is taller on
// mobile where the announcement wraps.
for (const [label, viewport] of [
  ['desktop', DESKTOP],
  ['mobile', MOBILE],
] as const) {
  test(`${label}: the reserved header height covers the whole banner`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const banner = await page.locator('[role=banner]').boundingBox();
    const reserved = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.height = 'var(--layout-fixed-header-height)';
      document.body.append(probe);
      const h = probe.getBoundingClientRect().height;
      probe.remove();
      return h;
    });
    expect(reserved).toBeGreaterThanOrEqual(banner!.height);
    // Not so generous that pages carry a visible gap under the nav.
    expect(reserved).toBeLessThan(banner!.height + 4);
  });
}

test.describe('top bar, desktop', () => {
  test.use({ viewport: DESKTOP });

  test('shows the announcement, Login and the language switcher', async ({ page }) => {
    await page.goto('/');
    const bar = page.locator('.top-bar');
    await expect(bar).toBeVisible();
    await expect(bar.locator('.top-bar__news-text')).toContainText('Data sovereignty');
    // The headline itself is the link, not just the call to action.
    const line = bar.locator('a.top-bar__news');
    await expect(line).toHaveAttribute('href', '/solutions/data-sovereignty/');
    await expect(line.locator('.top-bar__news-link')).toContainText('See how');
    await expect(bar.locator('.top-bar__login')).toBeVisible();
    await expect(bar.locator('.ds-lang-switcher--topbar')).toBeVisible();
  });

  test('the language menu opens and closes', async ({ page }) => {
    await page.goto('/');
    const switcher = page.locator('.top-bar .ds-lang-switcher--topbar');
    const menu = switcher.locator('.ds-lang-switcher__dropdown');
    await expect(menu).toBeHidden();
    await switcher.locator('.ds-lang-switcher__btn').click();
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('link', { name: '日本語' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });

  test('the announcement follows the locale, and falls back to English where the page is untranslated', async ({
    page,
  }) => {
    await page.goto('/zh-hant/');
    await expect(page.locator('a.top-bar__news')).toHaveAttribute(
      'href',
      '/zh-hant/solutions/data-sovereignty/',
    );
    // /solutions/data-sovereignty/ has no Japanese translation, so the
    // Japanese bar carries the English line and links to the English page
    // rather than relying on a redirect.
    await page.goto('/ja/');
    await expect(page.locator('.top-bar__news-text')).toContainText('Data sovereignty');
    await expect(page.locator('a.top-bar__news')).toHaveAttribute(
      'href',
      '/solutions/data-sovereignty/',
    );
  });

  test('the primary CTA reads "Sign up" and is tagged as `signup`', async ({ page }) => {
    await page.goto('/');
    const cta = page.locator('.split-content.header-right .button-primary.header-button');
    await expect(cta).toHaveText('Sign up');
    await expect(cta).toHaveClass(/plausible-event-name--signup(\s|$)/);
    await expect(cta).toHaveClass(/plausible-event-location--nav-header/);
  });
});

test.describe('top bar, mobile', () => {
  test.use({ viewport: MOBILE });

  test('keeps the news but moves Login and language into the drawer', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.top-bar__news')).toBeVisible();
    await expect(page.locator('.top-bar__actions')).toBeHidden();

    const utilities = page.locator('.mobile-nav-utilities');
    await expect(utilities).toBeHidden();

    await page.locator('[data-site-nav-toggle]').click();
    await expect(utilities).toBeVisible();
    await expect(utilities.locator('.mobile-nav-login')).toBeVisible();
    await expect(utilities.locator('.ds-lang-switcher--drawer')).toBeVisible();
  });

  test('the announcement runs to two lines rather than being cut off', async ({ page }) => {
    await page.goto('/');
    const line = page.locator('a.top-bar__news');
    const box = await line.boundingBox();
    // Two lines of 13px/1.4 text ≈ 36px; one line would be ~18px.
    expect(box!.height).toBeGreaterThan(30);
    // ...and no more than two: the reserved header height depends on it.
    expect(box!.height).toBeLessThan(42);
  });

  test('the drawer opens below the banner, top bar included', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-site-nav-toggle]').click();
    const bannerBox = await page.locator('[role=banner]').boundingBox();
    const panelBox = await page.locator('[data-site-nav-panel]').boundingBox();
    expect(bannerBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    // The panel is pinned to the measured banner height, so it must not
    // overlap the bar it hangs from.
    expect(panelBox!.y).toBeGreaterThanOrEqual(bannerBox!.y + bannerBox!.height - 1);
  });
});
