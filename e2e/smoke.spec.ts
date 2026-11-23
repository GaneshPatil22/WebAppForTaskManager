import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase('brain-outbox'); });
  await page.reload();
});

test('today shows the next thing to do, from the plan', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Do next' })).toBeVisible();
  await expect(page.getByText('One big thing')).toBeVisible();
});

test('a capture is organised into an item', async ({ page }) => {
  const input = page.getByLabel('Capture anything');
  await input.fill('kal subah plumber ko call karna hai 10 min');
  await input.press('Enter');
  await expect(page.getByText('Captured. Brain is organising it.')).toBeVisible();
  await page.getByRole('link', { name: /Inbox/ }).click();
  await expect(page.getByRole('button', { name: /Kal subah plumber/ })).toBeVisible({ timeout: 10_000 });
});

test('captures made while the server is down are kept and sent later', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Take server down' }).click();
  const input = page.getByLabel('Capture anything');
  await input.fill('written while offline');
  await input.press('Enter');
  await expect(page.getByText(/saved on this device, waiting for Brain/)).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Bring server back' }).click();
  await page.getByRole('button', { name: 'Retry now' }).first().click();
  await page.goto('/inbox');
  await expect(page.getByText('written while offline').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/waiting for Brain/)).toHaveCount(0);
});

test('in-progress features say so', async ({ page }) => {
  for (const path of ['/week', '/repeats', '/progress']) {
    await page.goto(path);
    await expect(page.locator('h1 .wip')).toHaveText('In progress');
  }
});
