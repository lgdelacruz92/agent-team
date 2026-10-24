import { test, expect } from '@playwright/test';

const user = { id: 'google-123', name: 'Alex Rivera', email: 'alex@example.com', picture: '' };
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function session(page, authenticated = false) {
  await page.route('**/api/me', route => route.fulfill(json({ user: authenticated ? user : null }, authenticated ? 200 : 401)));
}

async function signOut(page) {
  const toggle = page.getByRole('button', { name: 'Toggle navigation' });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
}

test('guest login is responsive and Google link navigates to provider endpoint', async ({ page }) => {
  await session(page);
  // Only the test intercepts OAuth: production uses the real relative endpoint.
  await page.route('**/auth/google', route => route.fulfill({ contentType: 'text/html', body: '<h1>OAuth endpoint reached</h1>' }));
  await page.goto('/');
  const google = page.getByRole('link', { name: 'Continue with Google' });
  await expect(google).toBeVisible();
  await expect(google).toHaveAttribute('href', '/auth/google');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await google.click();
  await expect(page).toHaveURL(/\/auth\/google$/);
  await expect(page.getByRole('heading', { name: 'OAuth endpoint reached' })).toBeVisible();
});

test('cookie session personalizes protected homepage and POST logout returns login', async ({ page, context }) => {
  await context.addCookies([{ name: 'session', value: 'test-session', url: 'http://localhost:5173' }]);
  let cookie = '';
  await page.route('**/api/me', async route => {
    cookie = (await route.request().allHeaders()).cookie || '';
    await route.fulfill(json({ user }));
  });
  let method = '';
  let logoutCookie = '';
  await page.route('**/auth/logout', async route => {
    method = route.request().method();
    logoutCookie = (await route.request().allHeaders()).cookie || '';
    await route.fulfill(json({ ok: true }));
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Hey, Alex/ })).toBeVisible();
  expect(cookie).toContain('session=test-session');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await signOut(page);
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
  expect(method).toBe('POST');
  expect(logoutCookie).toContain('session=test-session');
});

test('session loading is visible before login', async ({ page }) => {
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  await page.route('**/api/me', async route => { await ready; await route.fulfill(json({ user: null }, 401)); });
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Making room for your ideas…');
  release();
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
});

test('network failure is clear and retry recovers', async ({ page }) => {
  await page.route('**/api/me', route => route.abort('failed'));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('We couldn’t reach the server');
  await page.unroute('**/api/me');
  await session(page);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('callback error is explained without pretending to authenticate', async ({ page }) => {
  await session(page);
  await page.goto('/?authError=google_login_failed');
  await expect(page.getByRole('alert')).toContainText('Google sign-in didn’t complete');
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
});

test('failed logout preserves authenticated homepage and permits retry', async ({ page }) => {
  await session(page, true);
  await page.route('**/auth/logout', route => route.fulfill(json({ ok: false }, 500)));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Hey, Alex/ })).toBeVisible();
  await signOut(page);
  await expect(page.getByRole('alert')).toContainText('Sign-out failed');
  await expect(page.getByRole('heading', { name: /Hey, Alex/ })).toBeVisible();
  await page.unroute('**/auth/logout');
  await page.route('**/auth/logout', route => route.fulfill(json({ ok: true })));
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
});
