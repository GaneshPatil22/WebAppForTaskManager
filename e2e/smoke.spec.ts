import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase('brain-outbox'); indexedDB.deleteDatabase('brain-comment-outbox'); });
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

test('after capturing, the box opens empty next time', async ({ page }) => {
  await page.getByRole('button', { name: 'Capture anything' }).click();
  await page.getByLabel('Capture anything').last().fill('call the bank');
  await page.getByRole('button', { name: 'Capture', exact: true }).click();
  await expect(page.getByText(/Captured\./)).toBeVisible();
  await page.getByRole('button', { name: 'Capture anything' }).click();
  await expect(page.getByLabel('Capture anything').last()).toHaveValue('');
  await page.reload();
  await page.getByRole('button', { name: 'Capture anything' }).click();
  await expect(page.getByLabel('Capture anything').last()).toHaveValue('');
});

test('plan tomorrow can add something, due tomorrow', async ({ page }) => {
  await page.getByRole('button', { name: 'Plan tomorrow' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Add something for tomorrow').fill('Update LinkedIn profile');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog.getByText('Update LinkedIn profile')).toBeVisible();
  // Once Brain has made the item, tomorrow is set as its due date, as yours.
  await expect(dialog.getByRole('button', { name: /Update LinkedIn profile/ }).getByText('due tomorrow')).toBeVisible({ timeout: 10_000 });
});

test('every running timer is listed with its own clock', async ({ page }) => {
  await page.getByRole('button', { name: 'Open timer' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start' }).click();
  await page.keyboard.press('Escape');
  await ranked(page).getByRole('button', { name: /^Focus on / }).first().click();
  await page.keyboard.press('Escape');
  const dock = page.getByRole('region', { name: 'Timers' }).first();
  await expect(dock.getByRole('button', { name: /^Pause / })).toHaveCount(2);
  await expect(page.getByText(/^\+\d$/)).toHaveCount(0);
});

const IDEA = 'A weekly email from Brain with what I dropped';

test('ideas are kept on their own page, never in Today’s plan', async ({ page }) => {
  await expect(committed(page).getByText('Read 10 pages')).toBeVisible();
  await expect(page.getByText(IDEA)).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Ideas' }).click();
  const list = page.getByRole('list', { name: 'Ideas' });
  await expect(list.getByText(IDEA)).toBeVisible();
  // Newest first: the later capture leads.
  await expect(list.getByRole('listitem').first()).toContainText(IDEA);
});

test('making an idea a task moves it into Brain’s plan', async ({ page }) => {
  await page.goto('/ideas');
  await page.getByRole('button', { name: `Make it a task: ${IDEA}` }).click();
  await expect(page.getByText(/Now a task/)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Ideas' }).getByText(IDEA)).toHaveCount(0);
  await page.goto('/');
  await ranked(page).getByRole('button', { name: /Show all/ }).click();
  await expect(ranked(page).getByText(IDEA)).toBeVisible();
});

test('dropping an idea can be undone', async ({ page }) => {
  await page.goto('/ideas');
  await page.getByRole('button', { name: `Drop: ${IDEA}` }).click();
  await expect(page.getByRole('list', { name: 'Ideas' }).getByText(IDEA)).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('list', { name: 'Ideas' }).getByText(IDEA)).toBeVisible();
});

test('notes stay reachable from All items and the Inbox', async ({ page }) => {
  await page.goto('/items');
  await page.getByRole('button', { name: 'Notes' }).click();
  await expect(page.getByText('Old flat deposit 40k, landlord said January')).toBeVisible();
  await page.goto('/inbox');
  await expect(page.getByText('note: old flat deposit 40k, landlord said January')).toBeVisible();
});

test('on a phone, Ideas is in More, not the bottom bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const bar = page.getByRole('navigation', { name: 'Main (mobile)' });
  await expect(bar.getByRole('link', { name: 'Ideas' })).toHaveCount(0);
  await bar.getByRole('button', { name: 'More' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Ideas' }).click();
  await expect(page.getByRole('heading', { name: 'Ideas' })).toBeVisible();
});

test('an idea’s research notes come first, and a note can be edited and deleted', async ({ page }) => {
  await page.goto('/ideas');
  await page.getByRole('list', { name: 'Ideas' }).getByText(IDEA).click();
  const notes = page.getByRole('dialog').getByRole('region', { name: 'Research notes' });
  await expect(notes).toBeVisible();
  await notes.getByLabel('Add to research notes').fill('Resend has a free tier: 3k mails a month');
  await notes.getByRole('button', { name: 'Add' }).click();
  await expect(notes.getByText('Resend has a free tier: 3k mails a month')).toBeVisible();
  await expect(notes.getByText(/sending…/)).toHaveCount(0, { timeout: 10_000 });
  await notes.getByRole('button', { name: 'Edit comment' }).click();
  await notes.getByLabel('Edit comment').fill('Resend: 3k a month free');
  await notes.getByRole('button', { name: 'Save' }).click();
  await expect(notes.getByText('Resend: 3k a month free')).toBeVisible();
  await expect(notes.getByText(/edited/)).toBeVisible();
  await notes.getByRole('button', { name: 'Delete comment' }).click();
  await notes.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(notes.getByText('Resend: 3k a month free')).toHaveCount(0);
});

test('a comment written while the server is down is kept and sent later', async ({ page }) => {
  // In-app navigation only: a reload would reset the mock's "server down" switch.
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Commitments' }).click();
  await expect(page.getByRole('button', { name: /^Pay rent/ }).first()).toBeVisible();
  await nav.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Take server down' }).click();
  await nav.getByRole('link', { name: 'Commitments' }).click();
  await page.getByRole('button', { name: /^Pay rent/ }).first().click();
  const thread = page.getByRole('dialog').getByRole('region', { name: 'Comments' });
  await thread.getByLabel('Add to comments').fill('Landlord wants it by UPI now');
  await thread.getByRole('button', { name: 'Add' }).click();
  await expect(thread.getByText('Landlord wants it by UPI now')).toBeVisible();
  await expect(thread.getByText(/Saved on this device/)).toBeVisible();
  await page.keyboard.press('Escape');
  await nav.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Bring server back' }).click();
  await nav.getByRole('link', { name: 'Commitments' }).click();
  await page.getByRole('button', { name: /^Pay rent/ }).first().click();
  const again = page.getByRole('dialog').getByRole('region', { name: 'Comments' });
  await expect(again.getByText('Landlord wants it by UPI now')).toBeVisible();
  await expect(again.getByText(/Saved on this device/)).toHaveCount(0, { timeout: 15_000 });
});

test('a count goal fills circles, and achieving it is a separate tap', async ({ page }) => {
  await page.goto('/goals');
  await page.getByRole('button', { name: 'New goal' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Goal').fill('Post graph reels');
  await form.getByLabel(/Count it/).check();
  await form.getByLabel('How many').fill('2');
  await form.getByRole('button', { name: 'Set goal' }).click();
  const circles = page.getByRole('group', { name: /Post graph reels/ });
  const count = (n: number) => expect(page.getByRole('group', { name: `Post graph reels: ${n} of 2 done` })).toBeVisible();
  await count(0);

  await circles.getByRole('button', { name: 'Fill circle 1' }).click();
  await page.getByRole('dialog').getByLabel(/Note/).fill('BFS');
  await page.getByRole('dialog').getByRole('button', { name: 'Fill it' }).click();
  await count(1);

  // Tap a filled circle: see its note, empty it.
  await circles.getByRole('button', { name: /Circle 1, filled.*BFS/ }).click();
  await expect(page.getByRole('dialog').getByLabel('Note')).toHaveValue('BFS');
  await page.getByRole('dialog').getByRole('button', { name: 'Empty this circle' }).click();
  await count(0);

  for (const n of [1, 2]) {
    await circles.getByRole('button', { name: `Fill circle ${n}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Fill it' }).click();
    await count(n);
  }
  // Full does not mean achieved: that is its own tap.
  await expect(page.getByRole('button', { name: 'Reopen' })).toHaveCount(0);
  await page.getByRole('button', { name: 'All 2 done · Mark achieved?' }).click();
  await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Mark achieved\?/ })).toHaveCount(0);
});
