import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:5176/';
const output = new URL('../verification/', import.meta.url);
await mkdir(output, { recursive: true });
const result = { status: 'running', checks: [], externalRequests: 0, providerRequestsMocked: 0 };
let browser;
let observedPage;
const contexts = [];
async function context(options = {}) {
  const value = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...options });
  contexts.push(value);
  await value.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
      result.externalRequests++;
      return route.abort();
    }
    if (url.pathname.startsWith('/api/learning/')) {
      result.providerRequestsMocked++;
      return route.fulfill({ status: 502, contentType: 'application/json', body: '{"detail":"Synthetic provider failure"}' });
    }
    return route.continue();
  });
  return value;
}
try {
  for (const channel of ['msedge', 'chrome', undefined]) {
    try { browser = await chromium.launch({ ...(channel ? { channel } : {}), headless: true, timeout: 15000 }); result.browser = channel ?? 'chromium'; break; } catch {}
  }
  if (!browser) throw new Error('Install a supported Chromium browser for this smoke test.');
  const desktop = await context();
  const page = await desktop.newPage();
  observedPage = page;
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const dialog = page.getByRole('dialog', { name: 'code sherpa.ai' });
  await dialog.waitFor({ timeout: 2000 });
  assert.equal(await page.locator('.sherpa-entry-background').getAttribute('aria-hidden'), 'true');
  await page.screenshot({ path: fileURLToPath(new URL('cinematic-desktop.png', output)), animations: 'disabled' });
  const editor = page.getByLabel('Python code editor');
  await page.locator('[aria-label="Python code editor"]').waitFor({ state: 'attached', timeout: 10000 });
  const before = await editor.inputValue();
  const node = await editor.elementHandle();
  await dialog.getByRole('button', { name: 'Enter workspace', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await editor.inputValue(), before);
  assert.equal(await node.evaluate(element => element.isConnected), true);
  assert.equal(await page.evaluate(() => document.body.style.overflow), '');
  result.checks.push('cinematic enters without remounting workspace and releases scroll/inert');
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await editor.waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  result.checks.push('cinematic shows once per tab session');

  const source = 's = input("Enter a string: ")\n\nif s == s[::-1]:\n    print("Palindrome")\nelse:\n    print("Not a palindrome")';
  await page.getByLabel('Programming prompt').fill('Find whether a string is a palindrome or not');
  await editor.fill(source);
  await page.getByRole('button', { name: 'Show test cases', exact: true }).click();
  await page.getByText(/Active plan prompt: Find whether/).waitFor();
  const coverage = page.getByRole('region', { name: 'Requirement coverage', exact: true });
  const score = coverage.locator('[aria-label="Requirement test coverage score"]');
  await score.waitFor();
  assert.equal(await score.textContent(), 'Not tested');
  assert.equal(await editor.inputValue(), source);
  result.checks.push('provider 502 fallback does not grade correct-looking code as zero');
  const execution = page.getByRole('region', { name: 'Run and test Python', exact: true });
  await execution.getByLabel('Program input (stdin)').fill('racecar');
  await execution.getByRole('button', { name: 'Run Python', exact: true }).click();
  await execution.getByRole('heading', { name: 'run: completed', exact: true }).waitFor({ timeout: 45000 });
  assert.equal(await score.textContent(), 'Not tested');
  result.checks.push('successful unasserted execution does not create requirement passes');

  const cases = [
    ['racecar', 'Enter a string: Palindrome'],
    ['hello', 'Enter a string: Not a palindrome'],
    ['\n', 'Enter a string: Palindrome'],
    ['a', 'Enter a string: Palindrome'],
    ['Racecar', 'Enter a string: Not a palindrome'],
    ['nurses run', 'Enter a string: Not a palindrome'],
  ];
  for (let index = 0; index < cases.length; index++) {
    if (index) await execution.getByRole('button', { name: 'Add case', exact: true }).click();
    await execution.getByLabel(`Case ${index + 1} stdin`, { exact: true }).fill(cases[index][0]);
    await execution.getByLabel(`Case ${index + 1} expected output`, { exact: true }).fill(cases[index][1]);
    await execution.getByLabel(`Assert expected value for case ${index + 1}`, { exact: true }).check();
  }
  await execution.getByRole('button', { name: 'Run tests', exact: true }).click();
  await coverage.getByRole('status', { name: 'Requirement coverage status' }).filter({ hasText: '6/6 asserted tests passed.' }).waitFor({ timeout: 60000 });
  assert.equal(await score.textContent(), 'Not tested');
  result.checks.push('six unlinked tests can pass without faking requirement verification');
  await execution.getByRole('button', { name: 'Link all requirements', exact: true }).click();
  await execution.getByRole('button', { name: 'Run tests', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Requirement test coverage score"]')?.textContent === '100/100', undefined, { timeout: 60000 });
  assert.equal(await coverage.getByText('TESTS PASSED', { exact: true }).count(), 4);
  result.checks.push('correct palindrome tests update four explicitly linked requirement rows');

  await editor.fill(source.replace('s ==', 's !='));
  assert.equal(await score.textContent(), 'Not tested');
  await execution.getByRole('button', { name: 'Run tests', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Requirement test coverage score"]')?.textContent === '0/100', undefined, { timeout: 60000 });
  assert.equal(await coverage.getByText('FAILING', { exact: true }).count(), 4);
  result.checks.push('code edits invalidate evidence and a reversed condition produces failing coverage');
  await editor.fill(source);
  await execution.getByRole('button', { name: 'Check syntax', exact: true }).click();
  await execution.getByRole('heading', { name: 'syntax: completed', exact: true }).waitFor({ timeout: 45000 });
  assert.equal(await score.textContent(), 'Not tested');
  await execution.getByRole('button', { name: 'Run tests', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Requirement test coverage score"]')?.textContent === '100/100', undefined, { timeout: 60000 });
  assert.match(await execution.innerText(), /passes 6 previously failing cases for these inputs/);
  result.checks.push('fixing the same code restores current test evidence without changing expectations');
  await execution.getByRole('button', { name: 'Check syntax', exact: true }).click();
  await execution.getByRole('heading', { name: 'syntax: completed', exact: true }).waitFor({ timeout: 45000 });
  assert.equal(await score.textContent(), '100/100');
  result.checks.push('syntax-only check does not erase stronger unchanged test evidence');
  await execution.getByLabel('Case 1 expected output', { exact: true }).fill('Wrong expected text');
  assert.equal(await score.textContent(), 'Not tested');
  result.checks.push('editing expected outputs immediately clears stale green coverage');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Overflow at ${width}`);
  }
  result.checks.push('coverage and requirement-link controls fit desktop/tablet/mobile widths');

  const mobile = await context({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(base + '?intro=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await mobilePage.getByRole('dialog').waitFor({ timeout: 2000 });
  await mobilePage.screenshot({ path: fileURLToPath(new URL('cinematic-mobile.png', output)), animations: 'disabled' });
  await mobilePage.keyboard.press('Escape');
  await mobilePage.getByRole('dialog').waitFor({ state: 'hidden' });
  result.checks.push('mobile cinematic is keyboard-skippable');
  await mobilePage.goto(base + '?intro=1', { waitUntil: 'domcontentloaded' });
  await mobilePage.getByRole('dialog').waitFor({ timeout: 2000 });
  await mobilePage.getByRole('dialog').waitFor({ state: 'hidden', timeout: 7000 });
  result.checks.push('explicit replay auto-dismisses without requiring account/network readiness');
  const reduced = await context({ reducedMotion: 'reduce' });
  const reducedPage = await reduced.newPage();
  await reducedPage.goto(base + '?intro=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await reducedPage.getByLabel('Python code editor').waitFor({ timeout: 20000 });
  assert.equal(await reducedPage.getByRole('dialog').count(), 0);
  result.checks.push('reduced motion skips cinematic even on replay link');
  assert.equal(result.externalRequests, 0);
  result.status = 'passed';
} catch (error) {
  result.status = 'failed';
  result.error = error instanceof Error ? error.message : String(error);
  if (observedPage && !observedPage.isClosed()) {
    result.uiState = await observedPage.evaluate(() => ({
      dialogCount: document.querySelectorAll('[role="dialog"]').length,
      executionMode: document.querySelector('.python-execution select')?.value ?? null,
      caseCount: document.querySelectorAll('.python-case').length,
      caseLabels: Array.from(document.querySelectorAll('.python-case label')).map(label => label.textContent),
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(node => node.textContent),
    })).catch(() => ({ unavailable: true }));
    await observedPage.screenshot({ path: fileURLToPath(new URL('coverage-entry-failure.png', output)) }).catch(() => {});
  }
} finally {
  for (const value of contexts) await value.close();
  await browser?.close();
  await writeFile(new URL('coverage-entry-browser.json', output), JSON.stringify(result, null, 2) + '\n');
}
console.log('COVERAGE_ENTRY_BROWSER=' + JSON.stringify(result));
process.exitCode = result.status === 'passed' ? 0 : 1;
