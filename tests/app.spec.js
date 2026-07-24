// @ts-check
const { test, expect } = require('@playwright/test');

// ---- helpers ----

async function startApp(page) {
  await page.goto('/');
  await page.locator('#overlay').click();
  await expect(page.locator('#btn-show-controls')).toBeVisible({ timeout: 10_000 });
}

async function openControls(page) {
  await startApp(page);
  await page.locator('#btn-show-controls').click();
  await expect(page.locator('#controls')).toBeVisible();
}

// ---- splash screen ----

test('splash screen: overlay visible, FAB hidden', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#overlay')).toBeVisible();
  await expect(page.locator('#btn-show-controls')).toBeHidden();
});

test('splash screen: title text and glitch data-text attribute', async ({ page }) => {
  await page.goto('/');
  const h1 = page.locator('.overlay-content h1');
  await expect(h1).toHaveText('moshtroncity');
  await expect(h1).toHaveAttribute('data-text', 'moshtroncity');
});

// ---- init flow ----

test('clicking overlay starts app: overlay hides, FAB appears', async ({ page }) => {
  await page.goto('/');
  await page.locator('#overlay').click();
  await expect(page.locator('#overlay')).toBeHidden({ timeout: 10_000 });
  await expect(page.locator('#btn-show-controls')).toBeVisible();
});

test('double-click on overlay does not break init', async ({ page }) => {
  await page.goto('/');
  await page.locator('#overlay').click();
  await page.locator('#overlay').click(); // second click should be ignored
  await expect(page.locator('#btn-show-controls')).toBeVisible({ timeout: 10_000 });
});

test('canvas is injected into container after init', async ({ page }) => {
  await startApp(page);
  await expect(page.locator('#canvas-container canvas')).toBeVisible();
});

// ---- controls panel ----

test('FAB opens and closes controls panel', async ({ page }) => {
  await startApp(page);

  await expect(page.locator('#controls')).toBeHidden();

  await page.locator('#btn-show-controls').click();
  await expect(page.locator('#controls')).toBeVisible();

  await page.locator('#btn-show-controls').click();
  await expect(page.locator('#controls')).toBeHidden();
});

test('clicking canvas hides controls panel', async ({ page }) => {
  await openControls(page);
  await page.locator('#canvas-container').click();
  await expect(page.locator('#controls')).toBeHidden();
});

test('mode selector shows Live, Play, and Share buttons', async ({ page }) => {
  await openControls(page);
  await expect(page.locator('.mode-btn-live')).toBeVisible();
  await expect(page.locator('.mode-btn-play')).toBeVisible();
  await expect(page.locator('.mode-btn-share')).toBeVisible();
});

// ---- Live mode ----

test('Live mode auto-starts when app starts (before panel is opened)', async ({ page }) => {
  await startApp(page);
  // Live button has active class even though the panel is closed
  await expect(page.locator('.mode-btn-live')).toHaveClass(/mode-btn-live-active/);
});

test('Live mode: clicking Live toggles mic off, then on again', async ({ page }) => {
  await openControls(page);

  // Already active from app start
  await expect(page.locator('.mode-btn-live')).toHaveClass(/mode-btn-live-active/);

  // Click to toggle off
  await page.locator('.mode-btn-live').click();
  await expect(page.locator('.mode-btn-live')).not.toHaveClass(/mode-btn-live-active/);

  // Click to toggle back on
  await page.locator('.mode-btn-live').click();
  await expect(page.locator('.mode-btn-live')).toHaveClass(/mode-btn-live-active/);
});

// ---- Play mode ----

test('Play mode: shows player controls', async ({ page }) => {
  await openControls(page);
  await page.locator('.mode-btn-play').click();

  await expect(page.locator('#mode-selector')).toBeHidden();
  await expect(page.locator('#mode-play')).toBeVisible();
  await expect(page.locator('#btn-open-file')).toBeVisible();
  await expect(page.locator('#seek-bar')).toBeVisible();
  await expect(page.locator('#btn-skip-back')).toBeVisible();
  await expect(page.locator('#btn-play-pause')).toBeVisible();
  await expect(page.locator('#btn-skip-forward')).toBeVisible();
});

test('Play mode: play/pause disabled until file selected', async ({ page }) => {
  await openControls(page);
  await page.locator('.mode-btn-play').click();
  await expect(page.locator('#btn-play-pause')).toBeDisabled();
});

test('Play mode: Back returns to mode selector', async ({ page }) => {
  await openControls(page);
  await page.locator('.mode-btn-play').click();
  await page.locator('#mode-play .btn-back').click();
  await expect(page.locator('#mode-selector')).toBeVisible();
  await expect(page.locator('#mode-play')).toBeHidden();
});

// ---- Share mode ----

test('Share mode: shows URL link and QR code', async ({ page }) => {
  await openControls(page);
  await page.locator('.mode-btn-share').click();

  await expect(page.locator('#mode-selector')).toBeHidden();
  await expect(page.locator('#mode-share')).toBeVisible();
  await expect(page.locator('.share-url')).toBeVisible();
  await expect(page.locator('#qr-code canvas')).toBeVisible();
});

test('Share mode: Back returns to mode selector', async ({ page }) => {
  await openControls(page);
  await page.locator('.mode-btn-share').click();
  await page.locator('#mode-share .btn-back').click();
  await expect(page.locator('#mode-selector')).toBeVisible();
  await expect(page.locator('#mode-share')).toBeHidden();
});

// ---- Diagnose mode ----

test('Diagnose: shows LED indicators and effect buttons', async ({ page }) => {
  await openControls(page);
  await page.locator('.mode-btn-share').click();
  await page.locator('#btn-open-diagnose').click();

  await expect(page.locator('#mode-selector')).toBeHidden();
  await expect(page.locator('#mode-diagnose')).toBeVisible();
  await expect(page.locator('#led-peak')).toBeVisible();
  await expect(page.locator('#led-beat')).toBeVisible();
  await expect(page.locator('#btn-diagnose-sync')).toBeVisible();
  await expect(page.locator('#btn-diagnose-drop')).toBeVisible();
  await expect(page.locator('#btn-diagnose-zoom')).toBeVisible();
  await expect(page.locator('#btn-color-flash')).toBeVisible();
});

test('Diagnose: Back returns to mode selector', async ({ page }) => {
  await openControls(page);
  await page.locator('.mode-btn-share').click();
  await page.locator('#btn-open-diagnose').click();
  await page.locator('#mode-diagnose .btn-back').click();
  await expect(page.locator('#mode-selector')).toBeVisible();
  await expect(page.locator('#mode-diagnose')).toBeHidden();
});

// ---- mode switching ----

test('Share mode: does not deactivate Live (mic keeps running)', async ({ page }) => {
  await openControls(page);

  await expect(page.locator('.mode-btn-live')).toHaveClass(/mode-btn-live-active/);

  await page.locator('.mode-btn-share').click();

  await expect(page.locator('#mode-selector')).toBeHidden();
  await expect(page.locator('#mode-share')).toBeVisible();
  await expect(page.locator('.mode-btn-live')).toHaveClass(/mode-btn-live-active/);
});

test('Back from Share restores mode selector with Live still active', async ({ page }) => {
  await openControls(page);
  await page.locator('.mode-btn-share').click();
  await page.locator('#mode-share .btn-back').click();

  await expect(page.locator('#mode-selector')).toBeVisible();
  await expect(page.locator('.mode-btn-live')).toHaveClass(/mode-btn-live-active/);
});

test('switching from Play to Share hides play panel', async ({ page }) => {
  await openControls(page);

  await page.locator('.mode-btn-play').click();
  await expect(page.locator('#mode-play')).toBeVisible();

  await page.locator('#mode-play .btn-back').click();
  await page.locator('.mode-btn-share').click();

  await expect(page.locator('#mode-share')).toBeVisible();
  await expect(page.locator('#mode-play')).toBeHidden();
});

