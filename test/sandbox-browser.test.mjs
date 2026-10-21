import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Opt in with an existing Playwright installation; no browser/package downloads.
const playwrightModule = process.env.DSH_TEST_PLAYWRIGHT_MODULE;
const sampleDirectory = process.env.DSH_TEST_INITIATIVE_SAMPLE_DIR;
const source = readFileSync(new URL('../src/initiative-sandbox.js', import.meta.url), 'utf8');
const hostURL = 'http://sandbox.test/session?view=openspec#unchanged';
const options = { skip: !playwrightModule && 'Set DSH_TEST_PLAYWRIGHT_MODULE for real-browser regression', timeout: 15000 };
let browser;
before(async () => {
  if (!playwrightModule) return;
  const { chromium } = await import(playwrightModule);
  browser = await chromium.launch({ headless: true, ...(process.env.DSH_TEST_CHROME_BIN ? { executablePath: process.env.DSH_TEST_CHROME_BIN } : {}) });
});
after(async () => { await browser?.close(); });

async function mount(t, html, assets = {}) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(3000);
  const requests = [], navigations = [], errors = [];
  await page.route('**/*', route => route.request().url() === hostURL.split('#')[0]
    ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root" style="height:600px"></div>' })
    : route.abort());
  await page.goto(hostURL);
  page.on('request', request => requests.push(request.url()));
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(async ({ source, html, assets }) => {
    const install = new Function(source + '; return installInitiativeSandbox;')();
    install(window, document, new AbortController());
    const host = new window.OpenSpecInitiativeApps.EmbeddedInitiativeAppHost(document.getElementById('root'), {
      mount: async () => ({ html, assets, title: 'Fragment regression' }),
    });
    await host.mount({});
  }, { source, html, assets });
  await page.frameLocator('iframe').locator('body').waitFor();
  const frame = await (await page.locator('iframe').elementHandle()).contentFrame();
  assert.equal(await frame.evaluate(() => location.href), 'about:srcdoc');
  await frame.waitForLoadState('load');
  page.on('framenavigated', frame => navigations.push(frame.url()));
  return { page, frame, requests, navigations, errors, context };
}

async function assertStayed({ page, frame, requests, navigations, errors }) {
  // Let navigation/default actions settle without relying on a sleep.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await frame.evaluate(() => location.href), 'about:srcdoc', 'fragment must not navigate the srcdoc frame');
  assert.equal(page.url(), hostURL, 'host URL must stay untouched');
  assert.deepEqual(navigations, [], 'no frame or host navigation');
  assert.deepEqual(requests, [], 'no network requests');
  assert.deepEqual(errors, [], 'no uncaught browser errors');
}

async function assertTarget(frame, id) {
  const state = await frame.evaluate(id => {
    const target = document.getElementById(id);
    const rect = target.getBoundingClientRect();
    return { focused: document.activeElement === target, top: rect.top, height: rect.height, viewport: innerHeight };
  }, id);
  assert.equal(state.focused, true, id + ' receives focus');
  assert.ok(state.height > 0 && state.top >= -1 && state.top < state.viewport, `${id} is scrolled into view: ${JSON.stringify(state)}`);
}

const fixture = `<!doctype html><html><head><style>
  body { margin: 0; } nav a { display: inline-block; padding: 10px; }
  .gap { height: 900px; } section, details { padding: 10px; }
</style></head><body>
<nav>
  <a id="w1-link" href="#w1"><b>W1</b></a>
  <a id="toc-link" href="#chapter">目录</a>
  <a id="source-link" href="#source%3A%E8%AF%B4%E6%98%8E%20%5B1%5D">来源</a>
  <a id="missing" href="#absent">Missing</a>
  <a id="malformed" href="#%E0%A4%A">Malformed UTF-8</a>
  <a id="percent" href="#%">Malformed percent</a>
  <a id="empty" href="#">Top</a>
</nav>
<div class="gap"></div>
<details id="w1"><summary>W1 details</summary><p>Work package</p></details>
<div class="gap"></div>
<section id="chapter" tabindex="0"><h2>Chapter</h2></section>
<div class="gap"></div>
<details id="outer"><summary>Sources</summary>
  <details id="inner"><summary>Reference group</summary><h3 id="source:说明 [1]">Source</h3></details>
</details><div class="gap"></div>
</body></html>`;

test('srcdoc fragments scroll/focus W1, keyboard TOC and encoded nested sources', options, async t => {
  const state = await mount(t, fixture);
  const { frame } = state;
  await frame.locator('#w1-link b').click();
  await assertStayed(state);
  await assertTarget(frame, 'w1');
  assert.equal(await frame.locator('#w1').evaluate(node => node.open), true);
  await frame.locator('#toc-link').press('Enter');
  await assertStayed(state);
  await assertTarget(frame, 'chapter');
  assert.equal(await frame.locator('#chapter').getAttribute('tabindex'), '0', 'keep authored tabindex');
  assert.equal(await frame.locator('#w1').getAttribute('tabindex'), null, 'remove temporary tabindex after blur');
  await frame.locator('#source-link').click();
  await assertStayed(state);
  await assertTarget(frame, 'source:说明 [1]');
  assert.deepEqual(await frame.locator('#outer, #inner').evaluateAll(nodes => nodes.map(node => node.open)), [true, true]);
});

test('missing, malformed, empty and auxiliary fragments never navigate', options, async t => {
  const state = await mount(t, fixture);
  for (const id of ['missing', 'malformed', 'percent', 'empty']) {
    await state.frame.locator('#' + id).click();
    await assertStayed(state);
    await state.frame.locator('#' + id).press('Enter');
    await assertStayed(state);
  }
  await state.frame.locator('#w1-link').click({ button: 'middle' });
  await assertStayed(state);
  assert.equal(state.context.pages().length, 1, 'no popup');
});

test('fragment support retains opaque origin, CSP and navigation/permission boundaries', options, async t => {
  const state = await mount(t, `<!doctype html><html><head>
    <base href="https://blocked.invalid/"><meta http-equiv="refresh" content="0;url=https://blocked.invalid/">
    <meta http-equiv="Content-Security-Policy" content="default-src *">
  </head><body><a id="local" href="#target" target="_top" download ping="https://blocked.invalid/ping">Local</a>
    <a id="external" href="https://blocked.invalid/" target="_blank">External</a>
    <form action="https://blocked.invalid/"><button>Submit</button></form>
    <iframe src="https://blocked.invalid/"></iframe><div id="target">Target</div></body></html>`);
  assert.equal(await state.page.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
  assert.equal(await state.page.locator('iframe').getAttribute('referrerpolicy'), 'no-referrer');
  const policy = await state.page.locator('iframe').getAttribute('csp');
  assert.equal(await state.frame.locator('meta[http-equiv]').getAttribute('content'), policy);
  for (const directive of ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "worker-src 'none'", "base-uri 'none'", "form-action 'none'"]) assert.ok(policy.includes(directive));
  assert.equal(await state.frame.locator('base, form, iframe, [target], [download], [ping]').count(), 0);
  assert.equal(await state.frame.locator('#external').getAttribute('href'), null);
  await state.frame.locator('#local').click();
  await assertStayed(state);
  const boundary = await state.frame.evaluate(async () => {
    let parentBlocked = false, storageBlocked = false, topBlocked = false;
    try { void parent.document; } catch { parentBlocked = true; }
    try { void localStorage.length; } catch { storageBlocked = true; }
    try { top.location.href = 'https://blocked.invalid/top'; } catch { topBlocked = true; }
    const fetchBlocked = await fetch('https://blocked.invalid/api').then(() => false, () => true);
    return { parentBlocked, storageBlocked, topBlocked, fetchBlocked, origin, popupBlocked: window.open('https://blocked.invalid/popup') === null, hostApi: typeof window.OpenSpecInitiativeApps };
  });
  assert.deepEqual(boundary, { parentBlocked: true, storageBlocked: true, topBlocked: true, fetchBlocked: true, origin: 'null', popupBlocked: true, hostApi: 'undefined' });
  await assertStayed(state);
  assert.equal(state.context.pages().length, 1);
});

test('read-only DH dashboard sample: W1, directory and collapsed source anchors', {
  ...options, skip: options.skip || (!sampleDirectory && 'Set DSH_TEST_INITIATIVE_SAMPLE_DIR for the real DH sample'),
}, async t => {
  const state = await mount(t, readFileSync(join(sampleDirectory, 'index.html'), 'utf8'), {
    'styles.css': readFileSync(join(sampleDirectory, 'styles.css'), 'utf8'),
  });
  const { frame } = state;
  await frame.locator('a[href="#w1"] b').click();
  await assertStayed(state);
  await assertTarget(frame, 'w1');
  assert.equal(await frame.locator('#w1').evaluate(node => node.open), true);
  await frame.locator('nav a[href="#route"]').press('Enter');
  await assertStayed(state);
  await assertTarget(frame, 'route');
  await frame.locator('details.risk > summary').first().click();
  await frame.locator('a[href="#source-network"]').click();
  await assertStayed(state);
  await assertTarget(frame, 'source-network');
  assert.equal(await frame.locator('details.sources').evaluate(node => node.open), true);
});
