// Shared helpers for capturing real screenshots of the running web CRM.
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

/** Uses an installed Chromium-based browser (no browser download needed). */
export function launch() {
  const executablePath = CANDIDATES.find((p) => existsSync(p));
  if (!executablePath) throw new Error('No Chrome/Edge found. Set BROWSER_PATH to a Chromium-based browser.');
  return chromium.launch({ executablePath, headless: true });
}

export const BASE = (process.env.WEB_URL ?? 'http://localhost:5173').replace(/\/$/, '');
export const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo1234!';

/** Opens a fresh, signed-in browser context for one demo user. */
export async function signIn(browser, email, { lang = 'en', theme = 'light', viewport = { width: 1440, height: 900 } } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1.5, locale: 'en-US', timezoneId: 'Asia/Karachi', colorScheme: theme });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
  await settle(page);
  if (lang === 'ur') await setLanguage(page, 'ur');
  return { context, page };
}

export async function setLanguage(page, lang) {
  const current = await page.evaluate(() => document.documentElement.lang);
  if (current === lang) return;
  await page.getByRole('button', { name: /اردو|English/ }).first().click();
  await page.waitForFunction((l) => document.documentElement.lang === l, lang);
  await settle(page);
}

/** Waits for network quiet, spinners to disappear and charts to finish animating. */
export async function settle(page, extra = 400) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForFunction(() => !document.querySelector('[role="status"].animate-spin, .animate-spin'), null, { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(extra);
}

export async function go(page, path) {
  await page.goto(`${BASE}${path}`);
  await settle(page, 700);
}
