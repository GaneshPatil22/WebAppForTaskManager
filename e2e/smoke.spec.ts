import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase('brain-outbox'); });
  await page.reload();
});

const committed = (page: Page) => page.getByRole('region', { name: 'Committed today' });
const ranked = (page: Page) => page.getByRole('region', { name: 'Ranked by Brain' });

test('today keeps commitments and ranked candidates apart', async ({ page }) => {
  await expect(committed(page).getByText('Read 10 pages')).toBeVisible();
  await expect(ranked(page).getByRole('listitem').first()).toBeVisible();
  // A commitment is never a ranked row.
  await expect(ranked(page).getByText('Read 10 pages')).toHaveCount(0);
  // The big task is Brain's proposal until confirmed, and says so.
  await expect(page.getByRole('region', { name: "Today's big task" }).getByText(/Brain proposes/)).toBeVisible();
});

test('choosing a different big task is recorded as a swap', async ({ page }) => {
  const big = page.getByRole('region', { name: "Today's big task" });
  await big.getByRole('button', { name: 'Choose another' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('ol li button').nth(1).click();
  await expect(big.getByText(/You chose this over Brain’s pick/)).toBeVisible();
  await expect(big.getByText(/you confirmed it/)).toBeVisible();
});

test('ticking a commitment done survives a reload', async ({ page }) => {
  const box = committed(page).getByRole('button', { name: 'Mark done: Ukulele' });
  await box.click();
  await expect(committed(page).getByRole('button', { name: 'Undo: Ukulele' })).toHaveAttribute('aria-pressed', 'true');
  // The tick shows at once; the mock server's write lands after its simulated latency.
  await page.waitForTimeout(600);
  await page.reload();
  await expect(committed(page).getByRole('button', { name: 'Undo: Ukulele' })).toBeVisible();
});

test('a long dump becomes one capture per line', async ({ page }) => {
  await page.getByRole('button', { name: 'Capture anything' }).click();
  await page.getByLabel('Capture anything').last().fill('call the plumber kal\n- renew passport\n- idea: reels on graphs');
  await page.getByRole('button', { name: 'Capture 3' }).click();
  await expect(page.getByText('Captured 3 things.', { exact: false })).toBeVisible();
  await page.goto('/inbox');
  await expect(page.getByText('renew passport').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('idea: reels on graphs').first()).toBeVisible();
});

test('captures made while the server is down are kept and sent later', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Take server down' }).click();
  await page.keyboard.press('/');
  await page.getByLabel('Capture anything').last().fill('written while offline');
  await page.getByRole('button', { name: 'Capture', exact: true }).click();
  await expect(page.getByText(/saved on this device, waiting for Brain/)).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Bring server back' }).click();
  await page.getByRole('button', { name: 'Retry now' }).first().click();
  await page.goto('/inbox');
  await expect(page.getByText('written while offline').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/waiting for Brain/)).toHaveCount(0);
});

test('settings shows the user’s timezone, not the first in the list', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByLabel('Timezone')).toHaveValue('Asia/Kolkata');
});

test('the 1-3-5 board is optional and off by default', async ({ page }) => {
  await expect(page.getByText('One big thing')).toHaveCount(0);
  await page.goto('/settings');
  await page.getByLabel(/1-3-5 board/).check();
  await page.goto('/');
  await expect(ranked(page).getByText('One big thing')).toBeVisible();
});

test('the installable app has a manifest', async ({ page, request }) => {
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const res = await request.get(href!);
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m).toMatchObject({ display: 'standalone', start_url: '/' });
});

const question = (page: Page) => page.getByRole('region', { name: 'Brain has a question' });

test('answering Brain’s question is one tap, and the answer is yours', async ({ page }) => {
  const card = question(page);
  await expect(card.getByText('What is “Shreya’s number for the venue”?')).toBeVisible();
  await card.getByRole('button', { name: 'Note' }).click();
  await expect(page.getByText('Saved as note.')).toBeVisible();
  // The next question takes its place; the answered one is gone everywhere.
  await expect(card.getByText(/Shreya/)).toHaveCount(0);
  await page.goto('/inbox');
  await expect(page.getByRole('region', { name: 'Brain’s questions' }).getByText(/Shreya/)).toHaveCount(0);
});

test('setting the type on the item answers its question too', async ({ page }) => {
  await page.goto('/inbox');
  const qs = page.getByRole('region', { name: 'Brain’s questions' });
  await expect(qs.getByText('What is “That pricing thing”?')).toBeVisible();
  await qs.locator('div', { hasText: 'That pricing thing' }).getByRole('button', { name: 'Open item' }).last().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Type/).selectOption('task');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(qs.getByText(/That pricing thing/)).toHaveCount(0);
});

test('a guessed size looks like a guess and is corrected in one tap', async ({ page }) => {
  const row = ranked(page).getByRole('listitem').filter({ hasText: 'Call CA about advance tax' });
  const chip = row.getByRole('button', { name: /^Size:/ });
  await expect(chip).toHaveAccessibleName(/model’s guess|AI guess/i);
  await chip.click();
  await page.getByRole('menuitemradio', { name: 'Large · half day' }).click();
  await expect(chip).toHaveAccessibleName(/Large · half day, you set/);
  await page.waitForTimeout(600);
  // A bigger size may move it down Brain's list, so look for it among all items.
  await page.goto('/items');
  await expect(page.getByRole('button', { name: /Size: Large · half day, you set\. Change size of Call CA/ })).toBeVisible();
});
