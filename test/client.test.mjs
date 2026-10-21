import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const source = read('src/client.js');
test('original renderer sources have reproducible provenance', () => {
  const provenance = JSON.parse(read('src/upstream/provenance.json'));
  for (const [path, hash] of Object.entries(provenance.files)) assert.equal(createHash('sha256').update(read('src/upstream/' + path.split('/').at(-1))).digest('hex'), hash);
});
test('original execution board, task details, document and search renderer are retained', () => {
  for (const name of ['renderOverview', 'renderTaskDetail', 'renderDetail', 'renderCollection', 'renderInitiatives', 'renderSearch', 'sanitizeMarkdown', 'tocHtml', 'openInPageSearch']) assert.ok(source.includes('function ' + name + '('), name);
  assert.ok(source.includes('segmentFillPercents'));
});
test('initiative directory stays focused while explicit detail associations remain', () => {
  const directory = source.match(/function renderInitiatives\(\) \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(directory);
  assert.match(directory, /items.map\(initiativeCard\)/);
  assert.match(directory, /initiativeDiagnostics\(diagnostics, false\)/);
  assert.doesNotMatch(directory, /proposalTable|scopeControl|scopedChanges|changeScope|initiative-change-section|受信 Provider/);
  const detail = source.match(/function initiativeChangeRows\(descriptor\) \{[\s\S]*?\n    \}/)?.[0];
  assert.match(detail, /descriptor.changeRefs.map/);
  assert.match(detail, /未关联 Change/);
});
test('each initiative gets a direct project-scoped navigation entry', () => {
  assert.match(source, /function renderInitiativeNavigation\(\)/);
  assert.match(source, /renderInitiativeNavigation\(\);/);
  assert.match(source, /nav.hidden = !items.length/);
  assert.match(source, /aria-current="page"/);
  assert.match(source, /返回执行台/);
  const build = read('scripts/build-client.mjs');
  assert.match(build, /aria-label="专项导航"/);
  assert.match(source, /if \(initiativeButton\) \{ setInitiative/);
});
test('DSH layout uses horizontal navigation and a bounded content scroller', () => {
  const css = read('src/layout.css');
  assert.match(css, /grid-template-rows: auto minmax\(0, 1fr\)/);
  assert.match(css, /\.navigation-strip[^}]*overflow-x: auto/);
  assert.match(css, /\.page \{[^}]*height: 100%[^}]*overflow: auto/s);
  assert.match(css, /\.page.is-embedded-app[^}]*overflow: hidden/);
  assert.match(css, /border-left: 1px solid var\(--line\)/);
  assert.match(read('scripts/build-client.mjs'), /await read\('src\/layout.css'\)/);
});
test('SPEC labels preserve runtime identity and use a native rounded surface', () => {
  const adapter = read('src/client-adapter.js');
  assert.equal((adapter.match(/title: 'SPEC'/g) || []).length, 2);
  assert.match(adapter, /'aria-label': 'SPEC'/);
  assert.match(adapter, /id: 'dsh-openspec'/);
  const css = read('src/layout.css');
  assert.match(css, /:host\(\.dsh-openspec-main\)[^}]*padding: 12px 16px 16px/);
  assert.match(css, /:host\(\.dsh-openspec-pane\)[^}]*padding: 8px/);
  assert.match(css, /\.dsh-openspec-root \{[^}]*border-radius: 16px[^}]*overflow: hidden/s);
  assert.doesNotMatch(css, /padding:[^;]*100px/);
});
test('desktop auto-height wrapper cannot expand content beyond the viewport', () => {
  const adapter = read('src/client-adapter.js');
  assert.match(adapter, /window.innerHeight - Math.max\(0, top\)/);
  assert.match(adapter, /new ResizeObserver\(fit\)/);
  assert.match(adapter, /resize.disconnect\(\)/);
  assert.match(adapter, /event.composedPath\(\)/);
  assert.match(adapter, /passive: false, signal: lifetime.signal/);
  assert.match(read('src/layout.css'), /initiative-app-host-shell > header \{ display: none/);
});
test('main view hides only its session composer and releases the official override', () => {
  const adapter = read('src/client-adapter.js');
  assert.match(adapter, /props.compact \? \(\) => \{\} : ctx.slots.inject\('conversation.composer'/);
  assert.match(adapter, /owner.sessionId === props.sessionId && !owner.pendingInteraction/);
  assert.match(adapter, /addEventListener\('abort', restoreComposer/);
  assert.doesNotMatch(adapter, /compact \? 0 : 150/);
});
test('generated client is deterministic and valid JavaScript', () => {
  assert.equal(spawnSync(process.execPath, ['scripts/build-client.mjs'], { cwd: new URL('../', import.meta.url) }).status, 0);
  assert.equal(read('src/client.js'), source);
  assert.equal(spawnSync(process.execPath, ['--check', new URL('../src/client.js', import.meta.url).pathname]).status, 0);
});
test('native surfaces keep session authority and isolate original DOM and URL state', () => {
  assert.match(source, /name: 'conversation.view', id: 'dsh-openspec'/);
  assert.match(source, /name: 'sidebar.right.pane.tab', key: 'dsh-openspec'/);
  assert.match(source, /attachShadow/);
  assert.match(source, /const location = \{ hash: '' \}/);
  assert.match(source, /scope.replaceChildren\(\)/);
  assert.match(source, /lifetime.abort\(\)/);
  assert.match(source, /remote.openspec.read\(props.sessionId, JSON.stringify\(request\), lifetime.signal\)/);
  assert.doesNotMatch(source, /remote.commands.execute/);
  assert.doesNotMatch(source, /setInterval\(checkForWorkspaceUpdates/);
});
test('Markdown is allowlisted without external resources or delegated UI actions', () => {
  assert.match(source, /allowedTags = new Set/);
  assert.match(source, /if \(!permitted\) \{ element.removeAttribute/);
  // No custom data attributes, class names or src/srcset survive the allowlist.
  assert.doesNotMatch(source, /allowedTags = new Set\('[^']*IMG/);
});
