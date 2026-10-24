import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url);
const output = new URL('verification/', root);
await mkdir(output, { recursive: true });
const result = { status: 'running', checks: [], externalRequests: 0, learningRequests: 0 };
let browser;
let context;
try {
  for (const channel of ['msedge', 'chrome', undefined]) {
    try {
      browser = await chromium.launch({ ...(channel ? { channel } : {}), headless: true, timeout: 15000 });
      result.browser = channel ?? 'chromium';
      break;
    } catch {}
  }
  if (!browser) throw new Error('A Chromium browser is required. Run npx playwright install chromium.');
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
      result.externalRequests += 1;
      return route.abort();
    }
    if (url.pathname.startsWith('/api/learning/')) {
      result.learningRequests += 1;
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5176/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  const panel = page.getByRole('region', { name: 'Run and test Python' });
  await panel.waitFor({ timeout: 20000 });
  const editor = page.getByLabel('Python code editor');
  const stdout = () => panel.getByRole('heading', { name: 'stdout', exact: true }).locator('..').locator('pre');
  const heading = name => panel.getByRole('heading', { name, exact: true }).waitFor({ timeout: 45000 });
  await editor.fill('if True\n    print(1)');
  await panel.getByRole('button', { name: 'Check syntax', exact: true }).click();
  await heading('syntax: syntax error');
  assert.match(await panel.innerText(), /SyntaxError.*line 1/);
  result.checks.push('real syntax error and line');

  await editor.fill('print(1 / 0)');
  await panel.getByRole('button', { name: 'Run Python', exact: true }).click();
  await heading('run: runtime error');
  assert.match(await panel.innerText(), /ZeroDivisionError/);
  result.checks.push('real runtime traceback');

  await editor.fill('n = int(input())\nprint(n * 2)');
  await panel.getByLabel('Program input (stdin)').fill('7\n');
  await panel.getByRole('button', { name: 'Run Python', exact: true }).click();
  await heading('run: completed');
  assert.equal(await stdout().textContent(), '14\n');
  result.checks.push('real stdin and stdout');

  await panel.getByLabel('Case 1 stdin').fill('7');
  await panel.getByLabel('Case 1 expected output').fill('14');
  await panel.getByLabel('Assert expected value for case 1').check();
  await editor.fill('n = int(input())\nprint(n * 3)');
  await panel.getByRole('button', { name: 'Run tests', exact: true }).click();
  await heading('case-1: failed');
  await editor.fill('n = int(input())\nprint(n * 2)');
  await panel.getByRole('button', { name: 'Run tests', exact: true }).click();
  await heading('case-1: passed');
  assert.match(await panel.innerText(), /previously failing cases? for these inputs/);
  result.checks.push('actual failed test then fixed revision with same inputs');

  await editor.fill('while True: pass');
  await panel.getByRole('button', { name: 'Run Python', exact: true }).click();
  await heading('run: timeout');
  result.checks.push('real browser worker timeout');

  await editor.fill('while True: pass');
  await panel.getByRole('button', { name: 'Run Python', exact: true }).click();
  await panel.getByRole('button', { name: 'Stop', exact: true }).click();
  await editor.fill('print("responsive")');
  await panel.getByRole('button', { name: 'Run Python', exact: true }).click();
  await heading('run: completed');
  assert.equal(await stdout().textContent(), 'responsive\n');
  result.checks.push('stop and subsequent execution');

  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(overflow, false, `Page overflows at ${width}px`);
    if (width === 1440 || width === 390) {
      await panel.scrollIntoViewIfNeeded();
      await page.screenshot({ path: fileURLToPath(new URL(`ui-${width}.png`, output)) });
    }
  }
  result.checks.push('no page overflow at 1440, 768, 390, and 320 pixels');
  assert.equal(result.externalRequests, 0);
  assert.equal(result.learningRequests, 0);
  result.status = 'passed';
} catch (error) {
  result.status = 'failed';
  result.error = error instanceof Error ? error.message : String(error);
} finally {
  await context?.close();
  await browser?.close();
  await writeFile(new URL('browser-execution.json', output), JSON.stringify(result, null, 2) + '\n');
}
console.log('BROWSER_EXECUTION=' + JSON.stringify(result));
process.exitCode = result.status === 'passed' ? 0 : 1;