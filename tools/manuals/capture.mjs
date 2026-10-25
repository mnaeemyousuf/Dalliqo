// Captures real screenshots of the running web CRM for every documented access level.
//
//   1. Start the demo API and web app (see docs/user-manuals/README.md).
//   2. WEB_URL=http://localhost:5173 node capture.mjs
//
// Every screenshot is taken from the live application signed in as the demo user
// for that role. A shot that cannot be captured is recorded as failed in the
// manifest (never replaced with a mock-up), and the manual builder reports it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, go, launch, settle, signIn, setLanguage } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '../../docs/user-manuals/screenshots');
const manifest = { capturedAt: new Date().toISOString(), baseUrl: BASE, shots: [] };

const ROLES = {
  owner: 'owner@demo.recrm.test',
  member: 'son@demo.recrm.test',
  manager: 'manager@demo.recrm.test',
  agent: 'agent@demo.recrm.test',
  accountant: 'accounts@demo.recrm.test',
  viewer: 'viewer@demo.recrm.test',
};

async function shot(page, role, id, { locator, fullPage = false } = {}) {
  const dir = join(OUT, role);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}.jpg`);
  const opts = { path: file, type: 'jpeg', quality: 82, animations: 'disabled' };
  if (locator) await locator.screenshot(opts);
  else await page.screenshot({ ...opts, fullPage });
  manifest.shots.push({ role, id, file: `screenshots/${role}/${id}.jpg`, url: page.url().replace(BASE, ''), ok: true });
  console.log(`  ✓ ${role}/${id}`);
}

/** Runs one capture step; failures are logged and recorded, not hidden. */
// STEPS=a,b limits a run to those steps (e.g. to retake a single screenshot).
const STEPS = process.env.STEPS ? new Set(process.env.STEPS.split(',')) : null;

async function step(role, id, fn) {
  if (STEPS && !STEPS.has(id)) return;
  try {
    await fn();
  } catch (err) {
    manifest.shots.push({ role, id, ok: false, error: String(err?.message ?? err).split('\n')[0] });
    console.log(`  ✗ ${role}/${id}: ${String(err?.message ?? err).split('\n')[0]}`);
  }
}

const closeOverlays = async (page) => {
  for (let i = 0; i < 3; i++) await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
};

/** Opens the client that appears first on the Matches page (so it has matches). */
async function openMatchedClient(page) {
  await go(page, '/matches');
  const link = page.locator('main a[href^="/clients/"]').first();
  const href = await link.getAttribute('href');
  await go(page, href);
  return href;
}

async function openFirstProperty(page, query = '') {
  await go(page, `/properties${query}`);
  const href = await page.locator('main a[href^="/properties/"]').first().getAttribute('href');
  await go(page, href);
  return href;
}

async function tab(page, name) {
  await page.getByRole('tab', { name: new RegExp(`^${name}`) }).first().click();
  await settle(page, 600);
}

// ───────────────────────── capture plans ─────────────────────────

async function publicPages(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  await step('common', 'login', async () => {
    await go(page, '/login');
    await shot(page, 'common', 'login');
  });
  await step('common', 'login-filled', async () => {
    await page.getByLabel('Email').fill('agent@demo.recrm.test');
    await page.getByLabel('Password').fill('••••••••');
    await shot(page, 'common', 'login-filled');
  });
  await step('common', 'forgot-password', async () => {
    await go(page, '/forgot-password');
    await shot(page, 'common', 'forgot-password');
  });
  await step('common', 'register', async () => {
    await go(page, '/register');
    await shot(page, 'common', 'register');
  });
  await ctx.close();
}

/** Screens every signed-in role can open (content differs by permission). */
async function everyday(page, role, can) {
  await step(role, 'dashboard', async () => {
    await go(page, '/');
    await shot(page, role, 'dashboard');
  });
  if (can.reports) {
    await step(role, 'dashboard-analytics', async () => {
      // Bring the charts to the top of the view (they start just below the cards).
      await page.getByText('Property distribution').first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.mouse.wheel(0, -90);
      await settle(page, 1200);
      await shot(page, role, 'dashboard-analytics');
    });
    await step(role, 'dashboard-sales', async () => {
      await page.getByText('Lead sources & conversion').first().scrollIntoViewIfNeeded();
      await page.mouse.wheel(0, 200);
      await settle(page, 1200);
      await shot(page, role, 'dashboard-sales');
    });
  }
  await step(role, 'my-day', async () => {
    await go(page, '/my-day');
    await shot(page, role, 'my-day');
  });
  await step(role, 'global-search', async () => {
    await go(page, '/');
    await page.getByPlaceholder(/Search clients, properties/).fill('DHA');
    await settle(page, 1200);
    await shot(page, role, 'global-search');
    await closeOverlays(page);
  });
  await step(role, 'clients', async () => {
    await go(page, '/clients');
    await shot(page, role, 'clients');
  });
  await step(role, 'client-detail', async () => {
    await openMatchedClient(page);
    await shot(page, role, 'client-detail');
  });
  await step(role, 'client-requirements', async () => {
    await tab(page, 'Requirements');
    await shot(page, role, 'client-requirements');
  });
  await step(role, 'client-matches', async () => {
    await tab(page, 'Matching properties');
    await shot(page, role, 'client-matches');
  });
  await step(role, 'client-activity', async () => {
    await tab(page, 'Activity');
    await shot(page, role, 'client-activity');
  });
  await step(role, 'properties', async () => {
    await go(page, '/properties');
    await shot(page, role, 'properties');
  });
  await step(role, 'property-detail', async () => {
    await openFirstProperty(page, '?status=AVAILABLE&sort=-matchCount');
    await shot(page, role, 'property-detail');
  });
  await step(role, 'property-media', async () => {
    await tab(page, 'Photos');
    await shot(page, role, 'property-media');
  });
  await step(role, 'property-matches', async () => {
    await tab(page, 'Matching clients');
    await shot(page, role, 'property-matches');
  });
  await step(role, 'owners', async () => {
    await go(page, '/owners');
    await shot(page, role, 'owners');
  });
  await step(role, 'matches', async () => {
    await go(page, '/matches');
    await shot(page, role, 'matches');
  });
  await step(role, 'followups', async () => {
    // Read-only roles have nothing assigned to them, so show the whole team's list.
    await go(page, can.createFollowUps ? '/followups?tab=upcoming' : '/followups?tab=upcoming&assignedTo=all');
    await shot(page, role, 'followups');
  });
  await step(role, 'documents', async () => {
    await go(page, '/documents');
    await shot(page, role, 'documents');
  });
  await step(role, 'notifications', async () => {
    await go(page, '/notifications');
    await shot(page, role, 'notifications');
  });
  await step(role, 'settings', async () => {
    await go(page, '/settings');
    await shot(page, role, 'settings');
  });
}

/** Data-entry workflows, captured only for roles allowed to perform them. */
async function workflows(page, role, can, suffix) {
  if (can.createClients) {
    await step(role, 'client-form', async () => {
      await go(page, '/clients');
      await page.getByRole('button', { name: 'Add client' }).click();
      await page.getByLabel(/^Full name/).fill(suffix);
      await page.getByLabel(/^Mobile number/).fill(`0300 55${String(Date.now()).slice(-5)}`);
      await page.getByLabel(/^Source/).selectOption('WHATSAPP');
      await page.getByRole('button', { name: 'House', exact: true }).click();
      await page.getByLabel(/^Preferred societies/).fill('DHA Karachi');
      await page.getByLabel(/^Min size/).first().fill('200');
      await page.getByLabel(/^Max size/).first().fill('300');
      await page.getByLabel(/^Min budget/).first().fill('50000000');
      await page.getByLabel(/^Max budget/).first().fill('80000000');
      await page.getByLabel(/^Full name/).scrollIntoViewIfNeeded();
      await page.getByRole('dialog').evaluate((d) => d.querySelectorAll('*').forEach((el) => { if (el.scrollTop) el.scrollTop = 0; }));
      await settle(page, 300);
      await shot(page, role, 'client-form');
      // Scroll the drawer body to the end so the size and budget fields are visible.
      await page.getByRole('dialog').evaluate((d) => d.querySelectorAll('*').forEach((el) => { if (el.scrollHeight > el.clientHeight + 20 && getComputedStyle(el).overflowY !== 'visible') el.scrollTop = el.scrollHeight; }));
      await settle(page, 300);
      await shot(page, role, 'client-form-requirements');
    });
    await step(role, 'client-saved', async () => {
      await page.getByRole('button', { name: 'Save', exact: true }).last().click();
      await page.waitForURL(/\/clients\/[a-f0-9]{24}$/, { timeout: 15_000 });
      await settle(page, 1500);
      await shot(page, role, 'client-saved');
    });
    await step(role, 'client-duplicate', async () => {
      // Re-use the number of an existing client to show the duplicate warning.
      await go(page, '/clients');
      const existing = (await page.locator('main table tbody tr').first().innerText()).match(/\+92\d{10}/)?.[0];
      await page.getByRole('button', { name: 'Add client' }).click();
      await page.getByLabel(/^Full name/).fill('Duplicate Check');
      await page.getByLabel(/^Mobile number/).fill(existing ?? '+923001234567');
      await page.getByRole('button', { name: 'Save', exact: true }).last().click();
      await page.getByText('Possible duplicate client').waitFor({ timeout: 10_000 });
      await shot(page, role, 'client-duplicate');
      await closeOverlays(page);
    });
  }
  if (can.createFollowUps) {
    await step(role, 'followup-form', async () => {
      await openMatchedClient(page);
      await page.getByRole('button', { name: 'Follow-up', exact: true }).first().click();
      await settle(page, 500);
      await page.getByLabel(/^Type/).selectOption('PROPERTY_VISIT');
      await page.getByLabel(/^Notes/).last().fill('Site visit with family, bring sale deed copy');
      await shot(page, role, 'followup-form');
    });
    await step(role, 'followup-saved', async () => {
      await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
      await settle(page, 1200);
      await tab(page, 'Follow-ups');
      await shot(page, role, 'followup-saved');
    });
    await step(role, 'followup-reschedule', async () => {
      await go(page, '/followups?tab=upcoming&assignedTo=all');
      await page.getByRole('button', { name: 'Reschedule' }).first().click();
      await settle(page, 400);
      await shot(page, role, 'followup-reschedule');
      await closeOverlays(page);
    });
    await step(role, 'followup-complete', async () => {
      await page.getByRole('button', { name: 'Mark done' }).first().click();
      await settle(page, 400);
      await page.getByRole('dialog').getByLabel(/Outcome/).fill('Client liked the house, asked for a second visit');
      await shot(page, role, 'followup-complete');
      await closeOverlays(page);
    });
  }
  if (can.notes) {
    await step(role, 'followup-notes', async () => {
      await go(page, '/followups?tab=upcoming&assignedTo=all');
      await page.getByRole('button', { name: 'Notes' }).first().click();
      await settle(page, 600);
      await shot(page, role, 'followup-notes');
      await closeOverlays(page);
    });
    await step(role, 'client-notes', async () => {
      await openMatchedClient(page);
      await tab(page, 'Notes');
      await shot(page, role, 'client-notes');
    });
  }
  if (can.createProperties) {
    await step(role, 'property-form', async () => {
      await go(page, '/properties');
      await page.getByRole('button', { name: 'Add property' }).click();
      await settle(page, 500);
      await page.getByLabel(/^Property type/).selectOption('HOUSE');
      await page.getByLabel(/^Area/).fill('Defence');
      await page.getByLabel(/^Society/).fill('DHA Karachi');
      await page.getByLabel(/^Block/).fill('Phase 7');
      await page.getByLabel(/^Size$/).fill('240');
      await page.getByLabel(/^Asking price/).fill('68000000');
      await shot(page, role, 'property-form');
      await closeOverlays(page);
    });
  }
  if (can.updateProperties) {
    await step(role, 'property-verify', async () => {
      await openFirstProperty(page, '?verification=stale');
      await page.getByRole('button', { name: 'Confirm availability' }).click();
      await page.getByRole('dialog').getByLabel(/Note/).fill('Owner confirmed on phone, price unchanged');
      await settle(page, 300);
      await shot(page, role, 'property-verify');
      await closeOverlays(page);
    });
    await step(role, 'property-status', async () => {
      await page.getByRole('button', { name: 'Change status' }).click();
      await settle(page, 400);
      await shot(page, role, 'property-status');
      await closeOverlays(page);
    });
    await step(role, 'properties-stale', async () => {
      await go(page, '/properties?verification=stale&view=table');
      await shot(page, role, 'properties-stale');
    });
  }
  if (can.uploadDocuments) {
    await step(role, 'property-documents', async () => {
      await openFirstProperty(page, '?status=AVAILABLE');
      await tab(page, 'Documents');
      await shot(page, role, 'property-documents');
    });
  }
}

async function admin(page, role) {
  await step(role, 'users', async () => {
    await go(page, '/users');
    await shot(page, role, 'users');
  });
  await step(role, 'user-add', async () => {
    await page.getByRole('button', { name: 'Add user' }).click();
    await page.getByRole('dialog').getByLabel(/^Full name/).fill('Usman Tariq');
    await page.getByRole('dialog').getByLabel(/^Email/).fill('usman@yourbusiness.pk');
    await page.getByRole('dialog').getByRole('button', { name: 'Agent' }).click();
    await settle(page, 300);
    await shot(page, role, 'user-add');
    await closeOverlays(page);
  });
  await step(role, 'user-permissions', async () => {
    await page.getByRole('button', { name: 'Permissions' }).nth(2).click();
    await settle(page, 400);
    await shot(page, role, 'user-permissions');
    await closeOverlays(page);
  });
  for (const [id, tabName] of [['settings-business', 'Business'], ['settings-categories', 'Client categories'], ['settings-matching', 'Matching']]) {
    await step(role, id, async () => {
      await go(page, '/settings');
      await tab(page, tabName);
      await shot(page, role, id);
    });
  }
}

async function reports(page, role) {
  await step(role, 'reports', async () => {
    await go(page, '/reports');
    await shot(page, role, 'reports');
  });
}

async function audit(page, role) {
  await step(role, 'audit-log', async () => {
    await go(page, '/audit');
    await shot(page, role, 'audit-log');
  });
}

async function looks(browser, role, email) {
  await step(role, 'urdu-dashboard', async () => {
    const { context, page } = await signIn(browser, email);
    await setLanguage(page, 'ur');
    await go(page, '/');
    await shot(page, role, 'urdu-dashboard');
    await go(page, '/clients');
    await shot(page, role, 'urdu-clients');
    await setLanguage(page, 'en');
    await context.close();
  });
  await step(role, 'dark-mode', async () => {
    const { context, page } = await signIn(browser, email, { theme: 'dark' });
    await go(page, '/properties');
    await shot(page, role, 'dark-mode');
    await context.close();
  });
  await step(role, 'tablet', async () => {
    const { context, page } = await signIn(browser, email, { viewport: { width: 820, height: 1180 } });
    await go(page, '/my-day');
    await shot(page, role, 'tablet');
    await context.close();
  });
}

// ───────────────────────── run ─────────────────────────

const CAN = {
  owner: { reports: true, createClients: true, createFollowUps: true, notes: true, createProperties: true, updateProperties: true, uploadDocuments: true },
  member: { reports: true, createClients: true, createFollowUps: true, notes: true, createProperties: true, updateProperties: true, uploadDocuments: true },
  manager: { reports: true, createClients: true, createFollowUps: true, notes: true, createProperties: true, updateProperties: true, uploadDocuments: true },
  agent: { reports: false, createClients: true, createFollowUps: true, notes: true, createProperties: true, updateProperties: true, uploadDocuments: true },
  accountant: { reports: true },
  viewer: { reports: false },
};

// Realistic (synthetic) names for the buyer each role adds during capture.
const NEW_CLIENT = { owner: 'Rizwan Akhtar', member: 'Asif Mehmood', manager: 'Farah Naz', agent: 'Waqas Javed', accountant: '', viewer: '' };

const only = process.argv.slice(2);
const browser = await launch();
try {
  if (!only.length || only.includes('common')) await publicPages(browser);
  for (const [role, email] of Object.entries(ROLES)) {
    if (only.length && !only.includes(role)) continue;
    console.log(`\n${role} (${email})`);
    const { context, page } = await signIn(browser, email);
    await everyday(page, role, CAN[role]);
    await workflows(page, role, CAN[role], NEW_CLIENT[role]);
    if (role === 'owner') await admin(page, role);
    if (CAN[role].reports) await reports(page, role);
    if (role === 'owner' || role === 'manager') await audit(page, role);
    await context.close();
    if (role === 'owner') await looks(browser, role, email);
  }
} finally {
  await browser.close();
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `manifest${only.length ? '.' + only.join('-') : ''}${STEPS ? '.partial' : ''}.json`);
  writeFileSync(file, JSON.stringify(manifest, null, 2));
  const failed = manifest.shots.filter((s) => !s.ok);
  console.log(`\n${manifest.shots.length - failed.length} captured, ${failed.length} failed → ${file}`);
}
