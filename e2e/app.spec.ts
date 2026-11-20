import { expect, test, type Page } from '@playwright/test';

/**
 * Browser-level workflow tests. Expected numbers were derived independently of the engine:
 * BOM 08:00+90 by hand from the dataset, the others by scripts/oracle.py (a separate Python
 * re-implementation of the rules).
 */

const LABELS = ['Total flights', 'Operating normally', 'Delayed', 'Cancelled', 'Total delay', 'Passengers impacted', 'Passengers stranded', 'Missed connections', 'Crew violations', 'Aircraft affected'] as const;

async function kpis(page: Page): Promise<Record<string, number>> {
  await page.getByRole('tab', { name: 'Operations' }).click();
  const lines = (await page.locator('section[aria-label="Key metrics"]').innerText()).toUpperCase().split('\n');
  const out: Record<string, number> = {};
  lines.forEach((l, i) => {
    for (const lab of LABELS) if (l.trim() === lab.toUpperCase()) out[lab] = Number((lines[i + 1] ?? '0').split('MIN')[0].replace(/[^\d]/g, '') || 0);
  });
  return out;
}

async function simulate(page: Page, airport: string, start: string, duration: string) {
  await page.getByRole('tab', { name: 'Operations' }).click();
  await page.selectOption('#airport', airport);
  await page.fill('#start', start);
  await page.selectOption('#duration', duration);
  await page.getByRole('button', { name: 'SIMULATE DISRUPTION' }).click();
}

async function confirmIfAsked(page: Page) {
  const dlg = page.getByRole('alertdialog');
  if (await dlg.count()) await dlg.getByRole('button').last().click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('loads with the Mumbai closure scenario and correct KPIs', async ({ page }) => {
  await expect(page).toHaveTitle(/MAJOR DISRUPTION/);
  const k = await kpis(page);
  expect(k).toMatchObject({ 'Total flights': 70, Delayed: 9, Cancelled: 0, 'Total delay': 435, 'Passengers impacted': 1351, 'Passengers stranded': 48, 'Missed connections': 2, 'Crew violations': 0, 'Aircraft affected': 5 });
});

test('closure that touches nothing is NORMAL; a Delhi noon closure is CRITICAL', async ({ page }) => {
  await simulate(page, 'GAU', '07:00', '60');
  await expect(page.locator('[role=status]').first()).toContainText('NORMAL OPERATIONS');
  await simulate(page, 'DEL', '12:00', '120');
  await expect(page.locator('[role=status]').first()).toContainText('CRITICAL');
});

test('invalid closure duration is rejected', async ({ page }) => {
  await page.selectOption('#duration', 'custom');
  await page.fill('#custom', '0');
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'SIMULATE DISRUPTION' })).toBeDisabled();
});

test('route -> flight -> causal chain shows propagation and absorption', async ({ page }) => {
  const route = page.locator('[aria-label^="Route BLR to BOM"]');
  await route.scrollIntoViewIfNeeded();
  const pt = await route.evaluate((el: SVGPathElement) => { const p = el.getPointAtLength(el.getTotalLength() * 0.5); const m = el.getScreenCTM()!; return { x: p.x * m.a + m.e, y: p.y * m.d + m.f }; });
  await page.mouse.click(pt.x, pt.y);
  const card = page.locator('article[aria-label="Flight DS0501"]');
  await expect(card).toContainText('+75m');
  await card.getByRole('button', { name: 'Open disruption chain' }).click();
  const drawer = page.getByRole('dialog', { name: 'Flight DS0501 details' });
  await expect(drawer).toContainText('BOM airport closure');
  await expect(drawer).toContainText('DS0502 inherits');
  await expect(drawer).toContainText('DS0503 absorbs');
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
});

test('flight table search, status filter and sort', async ({ page }) => {
  await page.getByRole('tab', { name: 'Flights' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(70);
  await page.getByLabel('Search flights').fill('VT-DS05');
  await expect(page.locator('tbody tr')).toHaveCount(4);
  await page.getByLabel('Search flights').fill('');
  await page.selectOption('select[aria-label="Filter by status"]', 'delayed');
  await expect(page.locator('tbody tr')).toHaveCount(9);
});

test('connections: CX05 is missed with 0 minutes transfer', async ({ page }) => {
  await page.getByRole('tab', { name: 'Crew & connections' }).click();
  const row = page.locator('tr', { hasText: 'CX05' });
  await expect(row).toContainText('MISSED');
  await expect(row).toContainText('0 min');
});

test('crew duty: DEL 14:00+180 flags exactly CR11 (+80), CR01 (+65), CR15 (+45)', async ({ page }) => {
  await simulate(page, 'DEL', '14:00', '180');
  await page.getByRole('tab', { name: 'Crew & connections' }).click();
  const rows = page.locator('table').first().locator('tbody tr');
  const flagged = rows.filter({ hasText: 'VIOLATION' });
  await expect(flagged).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('CR11'); await expect(rows.nth(0)).toContainText('+80 min');
  await expect(rows.nth(1)).toContainText('CR01'); await expect(rows.nth(1)).toContainText('+65 min');
  await expect(rows.nth(2)).toContainText('CR15'); await expect(rows.nth(2)).toContainText('+45 min');
  await expect(rows.filter({ hasText: 'CR03' })).not.toContainText('VIOLATION'); // 98% of limit, not over
});

test('recovery: confirm dialog, spare deployment re-simulates, remove restores baseline', async ({ page }) => {
  const base = await kpis(page);
  await page.getByRole('tab', { name: 'AI Dispatcher' }).click();
  const card = page.locator('article[aria-label="Deploy VT-DS18 on DS1204"]');
  await card.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Apply this recovery action?');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
  expect((await kpis(page))['Total delay']).toBe(base['Total delay']);

  await page.getByRole('tab', { name: 'AI Dispatcher' }).click();
  await card.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Apply & re-simulate' }).click();
  const k = await kpis(page);
  expect(k).toMatchObject({ 'Total delay': 405, 'Passengers impacted': 1180, Delayed: 8 });

  await page.getByRole('tab', { name: 'Recovery' }).click();
  await expect(page.locator('main')).toContainText('1,351');
  await expect(page.locator('main')).toContainText('1,180');

  await page.getByRole('tab', { name: 'AI Dispatcher' }).click();
  await page.getByLabel('Remove action 1').click();
  expect(await kpis(page)).toEqual(base);
});

test('recovery: impossible spare is rejected with a reason and changes nothing', async ({ page }) => {
  const base = await kpis(page);
  await page.getByRole('tab', { name: 'AI Dispatcher' }).click();
  await page.selectOption('#man-kind', 'spare');
  await page.selectOption('#man-sp', 'VT-DS17');
  await page.selectOption('#man-st', 'VT-DS02');
  await page.getByRole('button', { name: 'Apply & re-simulate' }).first().click();
  await expect(page.locator('[aria-live]').filter({ hasText: 'Cannot apply' }).first()).toBeVisible();
  expect(await kpis(page)).toEqual(base);
});

test('recovery: whole plan reconciles with advertised totals', async ({ page }) => {
  await page.getByRole('tab', { name: 'AI Dispatcher' }).click();
  await expect(page.locator('section', { hasText: 'Recommended plan' }).first()).toContainText('435 → 375');
  await page.getByRole('button', { name: 'Apply whole plan' }).click();
  await confirmIfAsked(page);
  const k = await kpis(page);
  expect(k).toMatchObject({ 'Total delay': 375, 'Passengers impacted': 1185, 'Passengers stranded': 30 });
});

test('protecting a broken connection saves its passengers', async ({ page }) => {
  const base = await kpis(page);
  await page.getByRole('tab', { name: 'AI Dispatcher' }).click();
  await page.selectOption('#man-kind', 'protect');
  await page.selectOption('#man-cx', 'CX05');
  await page.getByRole('button', { name: 'Apply & re-simulate' }).first().click();
  await confirmIfAsked(page);
  const k = await kpis(page);
  expect(k['Passengers stranded']).toBe(base['Passengers stranded'] - 30);
  expect(k['Missed connections']).toBe(base['Missed connections'] - 1);
});

test('AI explanation falls back honestly to the Rule-based Dispatcher without an API key', async ({ page }) => {
  await page.getByRole('tab', { name: 'AI Dispatcher' }).click();
  await page.getByRole('button', { name: 'Ask AI to explain' }).click();
  await expect(page.locator('main')).toContainText('AI narration unavailable');
  await expect(page.locator('main')).toContainText('Rule-based Dispatcher');
});

test('replay advances the clock and pauses', async ({ page }) => {
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await page.getByRole('button', { name: 'Replay disruption', exact: true }).click();
  const clock = page.getByLabel('Replay clock');
  const a = Number(await clock.inputValue());
  await expect.poll(async () => Number(await clock.inputValue())).toBeGreaterThan(a);
  await page.getByRole('button', { name: 'Pause' }).first().click();
  const b = await clock.inputValue();
  await page.waitForTimeout(500);
  expect(await clock.inputValue()).toBe(b);
});

test('scenarios: save, persist across reload, rename, compare, export, delete', async ({ page }) => {
  await page.getByRole('tab', { name: 'Scenarios' }).click();
  await page.fill('#sc-name', 'Mumbai base');
  await page.locator('main').getByRole('button', { name: 'Save scenario' }).click();
  await simulate(page, 'DEL', '12:00', '120');
  await page.getByRole('tab', { name: 'Scenarios' }).click();
  await page.fill('#sc-name', 'Delhi noon');
  await page.locator('main').getByRole('button', { name: 'Save scenario' }).click();
  await page.reload();
  await page.getByRole('tab', { name: 'Scenarios' }).click();
  await expect(page.locator('main')).toContainText(/saved scenarios \(2\)/i);

  await page.getByRole('button', { name: 'Rename Mumbai base' }).click();
  await page.getByLabel('New scenario name').fill('Mumbai 08:00');
  await page.getByRole('button', { name: 'Confirm rename' }).click();
  await page.selectOption('#cmp-0', { label: 'Mumbai 08:00' });
  await page.selectOption('#cmp-1', { label: 'Delhi noon' });
  await expect(page.locator('main')).toContainText(/Total delay: A\s*435/);

  const [json] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export JSON' }).click()]);
  expect(json.suggestedFilename()).toMatch(/\.json$/);
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export flights CSV' }).click()]);
  expect(csv.suggestedFilename()).toMatch(/\.csv$/);

  await page.getByRole('button', { name: 'Delete Delhi noon' }).click();
  await confirmIfAsked(page);
  await expect(page.locator('main')).toContainText(/saved scenarios \(1\)/i);
});

test('corrupt localStorage does not crash the app', async ({ page }) => {
  await page.evaluate(() => Object.keys(localStorage).forEach((k) => localStorage.setItem(k, '{not json')));
  await page.reload();
  await expect(page).toHaveTitle(/Domino Sky/);
});

test('no console errors on load or tab navigation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  for (const t of ['Flights', 'Timeline', 'AI Dispatcher', 'Recovery', 'Analytics', 'Crew & connections', 'Scenarios', 'Operations']) await page.getByRole('tab', { name: t }).click();
  expect(errors).toEqual([]);
});

test('mobile viewport has no horizontal page overflow on any tab', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('/');
  for (const t of ['Operations', 'Flights', 'Timeline', 'AI Dispatcher', 'Recovery', 'Analytics', 'Crew & connections', 'Scenarios']) {
    await page.getByRole('tab', { name: t }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, `overflow on ${t}`).toBe(false);
  }
  await ctx.close();
});
