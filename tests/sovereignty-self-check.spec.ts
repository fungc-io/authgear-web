import { test, expect, type Page } from '@playwright/test';

const PATH = '/sovereignty-self-check/';

type Answer = 'Yes' | 'No' | 'Not sure';

/**
 * Record Plausible calls instead of sending them. The stub is locked in place:
 * when PUBLIC_PLAUSIBLE_DOMAIN is set, the real script would replace it.
 */
async function stubPlausible(page: Page) {
  await page.addInitScript(() => {
    const events: unknown[] = [];
    const stub = (name: string, opts?: { props?: unknown }) => {
      events.push({ name, props: opts?.props ?? null });
    };
    Object.defineProperty(window, '__events', { value: events });
    Object.defineProperty(window, 'plausible', { get: () => stub, set: () => {} });
  });
}

const events = (page: Page) =>
  page.evaluate(() => (window as unknown as { __events: { name: string; props: unknown }[] }).__events);

async function open(page: Page) {
  await stubPlausible(page);
  const resp = await page.goto(PATH);
  expect(resp?.status()).toBe(200);
  // Wait for React to hydrate before clicking; Astro drops `ssr` once it has.
  await page.locator('astro-island:not([ssr])').first().waitFor();
}

async function answerAll(page: Page, answers: Answer[]) {
  for (const [i, a] of answers.entries()) {
    await page.locator('fieldset').nth(i).getByRole('radio', { name: a, exact: true }).click();
  }
}

test.describe('/sovereignty-self-check', () => {
  test('renders the intro, ten questions and a disabled result button', async ({ page }) => {
    await open(page);
    await expect(page).toHaveTitle('Login Data Sovereignty Self-Check: 10 Questions, 2 Minutes');
    await expect(page.locator('main h1')).toHaveText('Who controls your login data?');
    await expect(page.locator('fieldset')).toHaveCount(10);
    await expect(page.locator('fieldset').first().locator('legend')).toContainText('1.');
    await expect(page.locator('fieldset input[type="radio"]')).toHaveCount(30);
    await expect(page.getByRole('button', { name: 'See my result' })).toBeDisabled();
  });

  test('scores 6 of 10 as mid and lists Gap and Find out lines in order', async ({ page }) => {
    await open(page);
    const requests: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET') requests.push(`${r.method()} ${r.url()}`);
    });

    await answerAll(page, ['Yes', 'Yes', 'Not sure', 'No', 'Yes', 'No', 'Yes', 'Yes', 'Not sure', 'Yes']);
    await expect(page.getByText('10 of 10 answered')).toBeVisible();
    await page.getByRole('button', { name: 'See my result' }).click();

    await expect(page.locator('.sc-result__score')).toHaveText('6 of 10 under your control');
    await expect(page.locator('.sc-result__headline')).toHaveText('Some of your login data is out of view');
    await expect(page.getByRole('status').first()).toContainText('6 of 10 under your control');

    const gaps = page.locator('.sc-gap');
    await expect(gaps).toHaveCount(4);
    await expect(gaps.nth(0)).toContainText('Find out:');
    await expect(gaps.nth(0)).toContainText('checklist question 3');
    await expect(gaps.nth(1)).toContainText('Gap:');
    await expect(gaps.nth(1)).toContainText('checklist question 5');
    await expect(gaps.nth(2)).toContainText('checklist question 9');
    await expect(gaps.nth(3)).toContainText('checklist question 16');
    await expect(gaps.nth(0).locator('a')).toHaveAttribute('href', '#checklist');

    expect(await events(page)).toEqual([
      { name: 'self-check-start', props: null },
      { name: 'self-check-complete', props: { score: 6, band: 'mid' } },
    ]);
    // Answers stay in the browser: nothing was posted anywhere.
    expect(requests).toEqual([]);
  });

  test('all Yes shows the high band and the no-gaps line', async ({ page }) => {
    await open(page);
    await answerAll(page, Array(10).fill('Yes'));
    await page.getByRole('button', { name: 'See my result' }).click();
    await expect(page.locator('.sc-result__score')).toHaveText('10 of 10 under your control');
    await expect(page.locator('.sc-result__headline')).toHaveText('You know where your login data goes');
    await expect(page.locator('.sc-nogaps')).toContainText('No gaps on these ten.');
  });

  test('copy results and start again', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page);
    await answerAll(page, ['No', 'No', 'No', 'No', 'Not sure', 'Yes', 'Yes', 'No', 'No', 'No']);
    await page.getByRole('button', { name: 'See my result' }).click();
    await expect(page.locator('.sc-result__headline')).toHaveText('Most of your login setup is out of view');

    await page.getByRole('button', { name: 'Copy results' }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('2 of 10 under our control');
    expect(copied).toContain('- Find out: Whether support and admin access');
    expect((await events(page)).map((e) => e.name)).toContain('self-check-copy');

    await page.getByRole('button', { name: 'Start again' }).click();
    await expect(page.getByText('0 of 10 answered')).toBeVisible();
    await expect(page.locator('fieldset input:checked')).toHaveCount(0);
  });

  test('checklist form posts with source=sovereignty-self-check', async ({ page }) => {
    let posted: URLSearchParams | null = null;
    await page.route(
      (url) => url.pathname === '/',
      async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        posted = new URLSearchParams(route.request().postData() ?? '');
        await route.fulfill({ status: 200, body: '' });
      },
    );
    await stubPlausible(page);
    await page.goto(`${PATH}?utm_source=linkedin&utm_medium=social`);
    await page.evaluate(() => {
      window.open = () => null;
    });
    const form = page.locator('#checklist form[name="sovereign-login-checklist"]');
    await form.locator('input[name="Name"]').fill('EU Buyer');
    await form.locator('input[name="Email"]').fill('someone@example.eu');
    await form.locator('input[name="Company"]').fill('Example GmbH');
    await form.locator('select[name="Role"]').selectOption('Security');
    await form.getByRole('button', { name: 'Download the checklist' }).click();

    await expect(page.getByText('Thanks, your checklist is opening in a new tab.')).toBeVisible();
    expect(posted).not.toBeNull();
    const p = posted as unknown as URLSearchParams;
    expect(p.get('form-name')).toBe('sovereign-login-checklist');
    expect(p.get('source')).toBe('sovereignty-self-check');
    expect(p.get('page')).toBe(PATH);
    expect(p.get('utm_source')).toBe('linkedin');
    expect(await events(page)).toContainEqual({ name: 'checklist-download', props: { location: 'self-check' } });
  });

  test('review link and checklist page keep their tracking', async ({ page }) => {
    await page.goto(PATH);
    const review = page.locator('#checklist a', { hasText: 'sovereignty review' }).first();
    await expect(review).toHaveAttribute('href', '/schedule-demo/?topic=sovereignty-review');
    await expect(review).toHaveClass(/plausible-event-name--get-demo/);
    await expect(review).toHaveClass(/plausible-event-location--self-check/);

    await page.goto('/sovereign-login-checklist/');
    await expect(page.locator('form[name="sovereign-login-checklist"]')).toHaveCount(1);
    await expect(page.locator('form[name="sovereign-login-checklist"]')).toHaveAttribute(
      'data-source',
      'sovereign-login-checklist',
    );
  });

  test('has no compliance claims', async ({ page }) => {
    await page.goto(PATH);
    const text = (await page.locator('main').innerText()).toLowerCase();
    for (const word of ['compliant', 'gdpr', 'risk score']) expect(text).not.toContain(word);
  });
});

test.describe('/sovereignty-self-check without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('shows the questions and the checklist link', async ({ page }) => {
    await page.goto(PATH);
    await expect(page.locator('fieldset')).toHaveCount(10);
    await expect(page.locator('fieldset legend').nth(9)).toContainText('one-time codes');
    await expect(page.locator('a[href="/sovereign-login-checklist/"]').first()).toBeVisible();
    // Chromium with scripting disabled by DevTools still parses <noscript> as
    // text, so check the served HTML for the notice instead of its visibility.
    const html = await (await page.request.get(PATH)).text();
    expect(html).toMatch(/<noscript>[^]*Turn on JavaScript to see your result\./);
  });
});

test.describe('/sovereignty-self-check on a 360px phone', () => {
  test.use({ viewport: { width: 360, height: 780 }, hasTouch: true });

  const resultOffset = (page: Page) =>
    page.evaluate(() =>
      Math.round(
        document.querySelector('.sc-result')!.getBoundingClientRect().top -
          document.querySelector('.header')!.getBoundingClientRect().bottom,
      ),
    );

  test('lands on the score after "See my result", even right after the last tap', async ({ page }) => {
    await open(page);
    await answerAll(page, ['Yes', 'Yes', 'Not sure', 'No', 'Yes', 'No', 'Yes', 'Yes', 'Not sure', 'Yes']);
    await page.getByRole('button', { name: 'See my result' }).click();
    await expect.poll(() => resultOffset(page)).toBe(16);
    // Nothing queued by the last taps moves it afterwards.
    await page.waitForTimeout(800);
    expect(await resultOffset(page)).toBe(16);
  });

  test('fits the width and scrolls to the next question after a tap', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);

    // Answer 1–4, then put question 5 near the bottom so question 6 is off screen.
    await answerAll(page, ['Yes', 'Yes', 'Yes', 'Yes']);
    await page.waitForTimeout(1000); // let those taps' own auto-scrolls finish
    await page.evaluate(() => {
      const q = document.querySelectorAll('fieldset')[4];
      window.scrollTo(0, window.scrollY + q.getBoundingClientRect().top - 330);
    });
    await page.locator('fieldset').nth(4).getByRole('radio', { name: 'Yes', exact: true }).click();
    // Question 6 opens a new group, so its heading lands just under the sticky header.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const header = document.querySelector('.header')!.getBoundingClientRect().bottom;
          const heading = document.querySelectorAll('.sc-group__title')[2].getBoundingClientRect().top;
          return Math.round(heading - header);
        }),
      )
      .toBe(16);
  });
});

test.describe('links to /sovereignty-self-check', () => {
  for (const [path, location] of [
    ['/sovereign-login-checklist/', 'checklist-page'],
    ['/solutions/data-sovereignty/', 'data-sovereignty'],
    ['/post/uk-data-sovereignty-login-identity/', 'uk-guide'],
    ['/post/sovereign-cloud-cloud-act-login-data/', 'cloud-act-guide'],
  ] as const) {
    test(`${path} links to the self-check`, async ({ page }) => {
      await page.goto(path);
      const link = page.locator(`a[href="${PATH}"].plausible-event-location--${location}`);
      await expect(link).toHaveCount(1);
      await expect(link).toHaveClass(/plausible-event-name--self-check-click/);
      await expect(link).toBeVisible();
    });
  }

  test('the CLOUD Act post now links to the checklist too', async ({ page }) => {
    await page.goto('/post/sovereign-cloud-cloud-act-login-data/');
    await expect(
      page.locator('a[href="/sovereign-login-checklist/"].plausible-event-location--cloud-act-guide'),
    ).toHaveCount(1);
  });
});
