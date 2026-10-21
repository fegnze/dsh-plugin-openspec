import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { TYPERT_REMOTE } from '../src/remote-contract.mjs';

const adapter = readFileSync(new URL('../src/client-adapter.js', import.meta.url), 'utf8');
function harness() {
  let definition, effect, bridge, cleanup, reads = 0, observers = 0, composer = 0;
  const registrations = new Map();
  const scope = { replaceChildren() {}, addEventListener() {}, querySelector: () => ({ prepend() {} }) };
  const element = { shadowRoot: scope, style: {}, parentElement: {}, getBoundingClientRect: () => ({ top: 100 }) };
  const React = { createElement: (component, props) => ({ component, props }), useRef: () => ({ current: element }), useEffect: fn => { effect = fn; } };
  const ctx = {
    remote: { $mount: async () => {}, openspec: { async read(_id, json, signal) {
      signal.throwIfAborted(); reads++; assert.equal(JSON.parse(json).action, 'workspace');
      return { ok: true, value: JSON.stringify({ revision: 0, projectId: 'p', snapshot: { project: { name: 'P' } } }) };
    } } },
    inject: (_deps, install) => install(ctx),
    locale: { register() {}, bind: () => key => key }, effect: fn => fn(),
    sidebarRightTabs: { register() {} }, sidebarRight: {},
    slots: { inject: (_name, fn) => { fn(); return () => {}; }, register: (options, component) => {
      if (options.name === 'conversation.composer') composer++;
      registrations.set(options.name, component); return () => {};
    } },
  };
  const sandbox = {
    TYPERT_REMOTE, AbortController, HTMLElement: class {},
    window: { innerHeight: 900, addEventListener() {}, __ModuleLoader__: { load: spec => { definition = spec.factory(() => React); } } },
    document: { createElement: () => ({ addEventListener() {} }) }, ResizeObserver: class { constructor() { observers++; } observe() {} disconnect() { observers--; } },
    navigator: { clipboard: {} },
    mountOriginal: (_scope, value) => { bridge = value; },
  };
  vm.runInNewContext(adapter.replace('/* ORIGINAL_RUNTIME */', ''), sandbox);
  const props = { sessionId: 's', useAccess: () => true, useSession: fn => fn({ cwd: '/p' }) };
  return {
    async install() { await definition.apply(ctx); },
    mount(extra = {}) { registrations.get('conversation.view')({ ...props, ...extra }); cleanup = effect(); },
    sidebar(visible) { const node = registrations.get('sidebar.right.pane.tab')({ ...props, useTabInfo: () => ({ tab: { visible } }) }); node.component(node.props); cleanup = effect(); },
    dispose() { cleanup?.(); }, get bridge() { return bridge; }, get reads() { return reads; }, get observers() { return observers; }, get composer() { return composer; },
  };
}

test('registration and invisible sidebar perform no project IO, sizing, or composer takeover', async () => {
  const h = harness(); await h.install();
  assert.equal(h.reads, 0); assert.equal(h.observers, 0); assert.equal(h.composer, 0);
  h.sidebar(false);
  assert.equal(h.bridge, undefined); assert.equal(h.reads, 0); assert.equal(h.observers, 0); assert.equal(h.composer, 0);
});
test('first boot shares one scan between sequential registry and workspace; refresh reads again', async () => {
  const h = harness(); await h.install(); h.mount();
  await h.bridge.projects.list(); const first = await h.bridge.workspace.load();
  assert.equal(first.projectId, 'p'); assert.equal(h.reads, 1);
  await h.bridge.workspace.refresh(); assert.equal(h.reads, 2);
  h.dispose(); assert.equal(h.observers, 0);
  await assert.rejects(h.bridge.workspace.refresh()); assert.equal(h.reads, 2);
});
test('visible sidebar reads on demand without window sizing or composer takeover', async () => {
  const h = harness(); await h.install(); h.sidebar(true);
  await h.bridge.projects.list(); await h.bridge.workspace.load();
  assert.equal(h.reads, 1); assert.equal(h.observers, 0); assert.equal(h.composer, 0);
  h.dispose();
});
test('denied main view creates no renderer, RPC or composer takeover', async () => {
  const h = harness(); await h.install(); h.mount({ useAccess: () => false });
  assert.equal(h.bridge, undefined); assert.equal(h.reads, 0); assert.equal(h.composer, 0);
});
