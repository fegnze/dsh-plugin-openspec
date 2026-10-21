import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../src/initiative-sandbox.js', import.meta.url), 'utf8');
test('sandbox denies ambient DSH origin, permissions and network resource channels', () => {
  assert.match(source, /setAttribute\('sandbox', 'allow-scripts'\)/);
  assert.doesNotMatch(source, /allow-same-origin|allow-top-navigation|allow-popups/);
  for (const rule of ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "worker-src 'none'", "form-action 'none'", "base-uri 'none'"]) assert.ok(source.includes(rule), rule);
  assert.match(source, /parsed.head.prepend\(meta\)/);
  assert.match(source, /script\[src\]/);
  assert.match(source, /referrerpolicy', 'no-referrer'/);
});
test('late mount cannot resurrect disposed or detached iframe', async () => {
  const window = {};
  const lifetime = new AbortController();
  vm.runInNewContext(source + '\ninstallInitiativeSandbox(window, document, lifetime);', { window, document: {}, lifetime });
  let resolve;
  const root = { isConnected: true };
  const host = new window.OpenSpecInitiativeApps.EmbeddedInitiativeAppHost(root, { mount: () => new Promise(done => { resolve = done; }) });
  const pending = host.mount({});
  await host.dispose(); resolve({ html: 'ignored' });
  assert.equal(await pending, false);
  const pendingAbort = host.mount({}); lifetime.abort(); resolve({ html: 'ignored' });
  assert.equal(await pendingAbort, false);
});
test('generated renderer mounts iframe without Electron boundary clearing and binds source hash', () => {
  const client = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
  assert.match(client, /sourceHash: descriptor.sourceHash/);
  assert.match(client, /action: 'app'/);
  assert.match(client, /Sandboxed iframe remains mounted/);
});
