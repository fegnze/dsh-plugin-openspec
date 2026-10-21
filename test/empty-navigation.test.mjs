import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
const render = source.match(/    function render\(\) \{[\s\S]*?\n    \}/)[0];
const load = source.match(/    async function loadWorkspace\(refresh\) \{[\s\S]*?\n    \}/)[0];
function harness(read) {
  let screen;
  const ctx = vm.createContext({
    state: { snapshot: null, currentWorkspaceRequest: 0 }, workspaceState: 'initial', workspaceError: '',
    resetInPageSearch() {}, updateNavigation() {}, refreshIcons() {}, showToast() {}, updateSidebar() {},
    renderLoading() { screen = 'loading'; }, renderEmptyWorkspace() { screen = 'empty'; }, renderError(_title, text) { screen = 'error:' + text; },
    document: {}, sidebarStatus: {}, refreshButton: { classList: { add() {}, remove() {} } },
    bridge: { workspace: { load: read, refresh: read } },
  });
  vm.runInContext(render + '\n' + load, ctx);
  return { ctx, screen: () => screen, render: () => vm.runInContext('render()', ctx), load: () => vm.runInContext('loadWorkspace(true)', ctx) };
}
test('settled empty project stays empty through all navigation routes', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return { projectId: 'MySpace', snapshot: null }; });
  await h.load();
  for (const view of ['overview', 'specs', 'archives', 'overview']) {
    h.ctx.state.view = view; h.render(); assert.equal(h.screen(), 'empty');
  }
  assert.equal(calls, 1);
});
test('failed load stays actionable on navigation and explicit refresh recovers', async () => {
  let fail = true;
  const h = harness(async () => { if (fail) throw Error('offline'); return { snapshot: null }; });
  await h.load(); h.render(); assert.equal(h.screen(), 'error:offline');
  h.ctx.state.view = 'specs'; h.render(); assert.equal(h.screen(), 'error:offline');
  fail = false; await h.load(); h.render(); assert.equal(h.screen(), 'empty');
});
test('stale failure cannot replace a newer empty result', async () => {
  let rejectOld;
  let calls = 0;
  const h = harness(() => ++calls === 1 ? new Promise((_resolve, reject) => { rejectOld = reject; }) : Promise.resolve({ snapshot: null }));
  const old = h.load();
  await h.load();
  rejectOld(Error('stale failure')); await old;
  assert.equal(h.screen(), 'empty');
  h.render(); assert.equal(h.screen(), 'empty');
  assert.equal(h.ctx.workspaceError, '');
});
test('stale completion cannot enable refresh while the latest request is pending', async () => {
  const requests = [];
  const h = harness(() => new Promise((resolve, reject) => requests.push({ resolve, reject })));
  const old = h.load(); const latest = h.load();
  requests[0].reject(Error('stale failure')); await old;
  assert.equal(h.ctx.refreshButton.disabled, true);
  h.render(); assert.equal(h.screen(), 'loading');
  requests[1].resolve({ snapshot: null }); await latest;
  assert.equal(h.ctx.refreshButton.disabled, false);
  h.render(); assert.equal(h.screen(), 'empty');
});
test('actual in-flight request alone displays loading', async () => {
  let resolve;
  const h = harness(() => new Promise(r => { resolve = r; }));
  const pending = h.load(); h.render(); assert.equal(h.screen(), 'loading');
  resolve({ snapshot: null }); await pending; h.render(); assert.equal(h.screen(), 'empty');
});
