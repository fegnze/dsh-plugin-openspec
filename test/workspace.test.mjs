import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshot, readDocument, metadata, documentPath, projectFor, LIMITS, loadWorkspace } from '../src/workspace.mjs';

// Content-free listing and opaque target identities model the inspected fs seam.
function filesystem(files = {}, aliases = {}) {
  const nodes = new Map([['/project', { type: 'directory' }]]);
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split('/');
    for (let i = 2; i < parts.length; i++) nodes.set(parts.slice(0, i).join('/'), { type: 'directory' });
    nodes.set(path, { type: 'file', content, size: new TextEncoder().encode(content).length });
  }
  const canonical = path => aliases[path] || path;
  const target = path => ({ targetKey: `opaque:${path}`, displayPath: path });
  const fs = {
    async resolve(path, options = {}) { const absolute = path.startsWith('/') ? path : `${options.cwd}/${path}`; return target(canonical(absolute)); },
    contains(parent, child) { return child.displayPath === parent.displayPath || child.displayPath.startsWith(`${parent.displayPath}/`); },
    async stat(target) { const node = nodes.get(target.displayPath); return node && { type: node.type, size: node.size }; },
    async listDir(target) {
      const prefix = `${target.displayPath}/`;
      return [...new Set([...nodes.keys(), ...Object.keys(aliases)].filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes('/')))].sort().map(path => ({ name: path.slice(prefix.length), target: target, type: nodes.get(path)?.type || 'directory' }));
    },
    async readBytes(target, signal, maxBytes) {
      signal?.throwIfAborted();
      const bytes = new TextEncoder().encode(nodes.get(target.displayPath).content);
      if (bytes.length > maxBytes) throw new Error('FS_TOO_LARGE: byte limit exceeded');
      return bytes;
    },
  };
  return fs;
}
const project = { path: '/project', title: 'Project' };
const appRoot = '/project/openspec/programs/launch';
const appManifest = () => ({ $schema: 'https://openspec.dev/schemas/initiative-app-v1.json', schemaVersion: 1, id: 'launch', kind: 'program', title: 'Launch app', summary: 'Self-contained original schema app', presentation: { type: 'embedded-app', webRoot: 'web', entry: 'index.html', actions: { '/open-change': 'openspec.open-change' } } });
const appFiles = (manifest = appManifest(), html = '<!doctype html><title>Launch</title><script>window.local = true;</script>') => ({ [`${appRoot}/initiative-app.json`]: typeof manifest === 'string' ? manifest : JSON.stringify(manifest), [`${appRoot}/web/index.html`]: html });

test('original embedded manifest discovers compatible descriptor and app returns only declared HTML', async () => {
  const fs = filesystem(appFiles());
  let reads = 0;
  const originalRead = fs.readBytes;
  fs.readBytes = (...args) => { reads++; return originalRead(...args); };
  await snapshot(fs, project);
  assert.equal(reads, 0, 'plain snapshot must not read JSON or HTML');
  const loaded = await loadWorkspace(fs, project);
  const descriptor = loaded.snapshot.initiatives[0];
  assert.equal(descriptor.providerId, 'openspec-embedded-app-v1');
  assert.equal(descriptor.type, 'program');
  assert.deepEqual(descriptor.presentation, { mode: 'embedded-app' });
  assert.deepEqual(loaded.snapshot.initiativeDiagnostics, []);
  const operation = { action: 'app', providerId: descriptor.providerId, initiativeId: descriptor.id, revision: 0, sourceHash: descriptor.sourceHash };
  assert.deepEqual(await loadWorkspace(fs, project, undefined, 0, operation), { html: appFiles()[`${appRoot}/web/index.html`], title: 'Launch app', sourceHash: descriptor.sourceHash, assets: {} });
  await assert.rejects(loadWorkspace(fs, project, undefined, 0, { ...operation, revision: 1 }), /stale/);
  await assert.rejects(loadWorkspace(fs, project, undefined, 0, { ...operation, sourceHash: '0'.repeat(64) }), /STALE_INITIATIVE/);
  await assert.rejects(loadWorkspace(filesystem(appFiles(appManifest(), '<h1>Changed</h1>')), project, undefined, 0, operation), /STALE_INITIATIVE/);
  const changed = appManifest(); changed.title = 'New title';
  await assert.rejects(loadWorkspace(filesystem(appFiles(changed)), project, undefined, 0, operation), /STALE_INITIATIVE/);
  assert.equal(globalThis.local, undefined, 'HTML scripts are never executed host-side');
});

test('embedded assets roundtrip from bounded manifest and asset changes invalidate requests', async () => {
  const html = '<link rel="stylesheet" href="styles.css"><script src="scripts/app.js"></script>';
  const assets = { 'styles.css': 'body { color: red; }', 'scripts/app.js': 'globalThis.hostAssetExecuted = true;' };
  const files = { ...appFiles(appManifest(), html), ...Object.fromEntries(Object.entries(assets).map(([key, content]) => [`${appRoot}/web/${key}`, content])), [`${appRoot}/private.js`]: 'secret', [`${appRoot}/web/data.json`]: '{"private":true}' };
  const fs = filesystem(files);
  let reads = 0;
  const originalRead = fs.readBytes;
  fs.readBytes = (...args) => { reads++; return originalRead(...args); };
  await snapshot(fs, project);
  assert.equal(reads, 0, 'plain snapshots do not read CSS or JS');
  const descriptor = (await loadWorkspace(fs, project)).snapshot.initiatives[0];
  const operation = { action: 'app', providerId: descriptor.providerId, initiativeId: descriptor.id, revision: 0, sourceHash: descriptor.sourceHash };
  assert.deepEqual(await loadWorkspace(fs, project, undefined, 0, operation), { html, title: 'Launch app', sourceHash: descriptor.sourceHash, assets });
  assert.equal(globalThis.hostAssetExecuted, undefined, 'assets remain inert host-side');
  for (const key of Object.keys(assets)) {
    const changed = { ...files, [`${appRoot}/web/${key}`]: `${assets[key]}\n/* changed */` };
    await assert.rejects(loadWorkspace(filesystem(changed), project, undefined, 0, operation), /STALE_INITIATIVE/);
  }
  const removed = { ...files }; delete removed[`${appRoot}/web/styles.css`];
  await assert.rejects(loadWorkspace(filesystem(removed), project, undefined, 0, operation), /STALE_INITIATIVE/);
});

test('embedded assets enforce count, text size, safe paths and canonical containment', async () => {
  const many = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`${appRoot}/web/${i}.css`, 'a{}']));
  const overflow = await loadWorkspace(filesystem({ ...appFiles(), ...many }), project);
  assert.equal(overflow.snapshot.initiatives.length, 0);
  assert.ok(overflow.snapshot.initiativeDiagnostics.some(item => /asset limit 64/.test(item.message + item.detail)));
  const exactly64 = { ...many }; delete exactly64[`${appRoot}/web/64.css`];
  assert.equal((await loadWorkspace(filesystem({ ...appFiles(), ...exactly64 }), project)).snapshot.initiatives.length, 1);
  const skipped = await loadWorkspace(filesystem({ ...appFiles(), [`${appRoot}/web/huge.js`]: 'a'.repeat(LIMITS.documentBytes + 1), [`${appRoot}/web/bad%2f.css`]: 'secret', '/outside/secret.css': 'secret' }, { [`${appRoot}/web/link.css`]: '/outside/secret.css' }), project);
  assert.ok(skipped.warnings.some(item => /512 KiB/.test(item)));
  assert.ok(skipped.warnings.some(item => /invalid directory entry/.test(item)));
  assert.ok(skipped.warnings.some(item => /escapes/.test(item)));
  const descriptor = skipped.snapshot.initiatives[0];
  const app = await loadWorkspace(filesystem(appFiles()), project, undefined, 0, { action: 'app', providerId: descriptor.providerId, initiativeId: descriptor.id, revision: 0, sourceHash: descriptor.sourceHash });
  assert.deepEqual(app.assets, {});
});

test('embedded invalid JSON, schema, paths, actions and missing entry produce invalid diagnostics only', async () => {
  const invalid = ['{not JSON', {}, ...[
    value => { value.$schema = 'https://other/schema'; },
    value => { value.schemaVersion = 2; },
    value => { value.id = 'wrong'; },
    value => { value.presentation.webRoot = '../outside'; },
    value => { value.presentation.entry = '../index.html'; },
    value => { value.presentation.entry = 'file%2ehtml'; },
    value => { value.presentation.entry = '/index.html'; },
    value => { value.presentation.entry = 'main.js'; },
    value => { value.presentation.entry = 'missing.html'; },
    value => { value.presentation.extra = true; },
    value => { value.presentation.actions = { '/go': 'shell.execute' }; },
    value => { value.presentation.actions = { '/../go': 'openspec.open-change' }; },
  ].map(change => { const value = appManifest(); change(value); return value; })];
  for (const value of invalid) {
    const loaded = await loadWorkspace(filesystem(appFiles(value)), project);
    assert.deepEqual(loaded.snapshot.initiatives, [], JSON.stringify(value));
    assert.ok(loaded.snapshot.initiativeDiagnostics.some(item => item.code === 'INVALID_EMBEDDED_INITIATIVE_APP'), JSON.stringify(value));
    assert.ok(!loaded.snapshot.initiativeDiagnostics.some(item => item.code === 'UNSUPPORTED_EMBEDDED_INITIATIVE_APP'));
  }
});

test('embedded canonical escapes and oversized HTML remain bounded and unavailable', async () => {
  const escaped = filesystem({ ...appFiles(), '/outside/index.html': '<h1>Secret</h1>' }, { [`${appRoot}/web/index.html`]: '/outside/index.html' });
  const loaded = await loadWorkspace(escaped, project);
  assert.equal(loaded.snapshot.initiatives.length, 0);
  assert.ok(loaded.warnings.some(item => item.includes('escapes')));
  const huge = await loadWorkspace(filesystem(appFiles(appManifest(), 'x'.repeat(LIMITS.documentBytes + 1))), project);
  assert.equal(huge.snapshot.initiatives.length, 0);
  assert.ok(huge.warnings.some(item => item.includes('512 KiB')));
});

test('workspace reuses original entity construction, task groups, status and search semantics', async () => {
  const fs = filesystem({
    '/project/openspec/specs/core/spec.md': '# core Specification\n\n### Requirement: Visible\n#### Scenario: Works',
    '/project/openspec/changes/add-feature/proposal.md': '# Proposal: Feature\n\nSearchable rationale',
    '/project/openspec/changes/add-feature/tasks.md': '## 1. Implementation\n- [x] 1.1 Parser\n- [ ] 1.2 Renderer',
    '/project/openspec/changes/archive/2026-01-01-old-change/proposal.md': '# Proposal: Old',
    '/project/openspec/changes/archive/2026-01-01-old-change/tasks.md': '- [x] Done',
    '/project/openspec/changes/incomplete/design.md': '# Context\n```js\nopen',
  });
  const loaded = await loadWorkspace(fs, project);
  const state = loaded.snapshot;
  assert.equal(loaded.projectId, '/project');
  assert.equal(loaded.revision, 0);
  assert.deepEqual(state.project, { id: '/project', name: 'project' });
  assert.equal(state.stats.specs, 1);
  assert.equal(state.stats.activeChanges, 2);
  assert.equal(state.stats.archivedChanges, 1);
  assert.equal(state.lifecycle.source, 'inferred');
  assert.match(state.lifecycle.diagnostic, /no modification timestamps/);
  const feature = state.changes.find(item => item.id === 'add-feature');
  assert.equal(feature.title, 'Feature');
  assert.equal(feature.tasks.percent, 50);
  assert.equal(feature.nextTask.id, '1.2');
  assert.equal(feature.nextTask.groupTitle, 'Implementation');
  assert.equal(feature.controlState, 'in-progress');
  assert.equal(feature.statusSource, 'inferred');
  assert.equal(state.archives[0].referenceId, 'old-change');
  assert.equal(state.specs[0].title, 'core');
  assert.equal(state.specs[0].requirements, 1);
  assert.equal(state.specs[0].scenarios, 1);
  assert.ok(state.taskQueue.some(item => item.id === '1.2' && item.changeId === 'add-feature'));
  assert.ok(state.searchIndex.some(item => item.text.includes('Searchable rationale')));
  assert.ok(state.changes.find(item => item.id === 'incomplete').warnings.some(item => item.includes('未闭合')));
  assert.deepEqual(state.changeRelations.independentChangeIds.sort(), ['add-feature', 'incomplete']);
});

test('workspace missing root, bounded skips, cancellation and JSON/YAML provider reporting are explicit', async () => {
  assert.equal((await loadWorkspace(filesystem(), project)).snapshot, null);
  const fs = filesystem({
    '/project/openspec/initiatives/launch/initiative.json': JSON.stringify({ schemaVersion: 1, id: 'launch', title: 'Launch', summary: 'Ready', goal: 'Delivery', status: 'active', health: 'healthy', changes: [], artifacts: [] }),
    '/project/openspec/initiatives/yaml-only/initiative.yaml': 'schemaVersion: 1\nid: yaml-only\ntitle: YAML project\nsummary: Ready\ngoal: Delivery\nstatus: active\nhealth: healthy\nchanges: []\nartifacts: []\n',
    '/project/openspec/programs/app/initiative-app.json': '{}',
    '/project/openspec/specs/huge/spec.md': 'a'.repeat(LIMITS.documentBytes + 1),
  });
  const result = await loadWorkspace(fs, project);
  assert.ok(result.warnings.some(item => item.includes('512 KiB')));
  assert.equal(result.snapshot.initiatives[0].id, 'launch');
  const loaded = await loadWorkspace(fs, project, undefined, 0, { action: 'initiative', providerId: 'openspec-generic-initiative-v1', initiativeId: 'launch' });
  assert.equal(loaded.descriptor.id, 'launch');
  await assert.rejects(loadWorkspace(fs, project, undefined, 0, { action: 'artifact', providerId: 'openspec-generic-initiative-v1', initiativeId: 'launch', sourceHash: 'stale', artifactId: 'missing' }), /STALE_INITIATIVE/);
  assert.ok(result.snapshot.initiatives.some(item => item.id === 'yaml-only'));
  assert.ok(!result.snapshot.initiativeDiagnostics.some(item => item.code === 'UNSUPPORTED_YAML'));
  assert.ok(result.snapshot.initiativeDiagnostics.some(item => item.code === 'INVALID_EMBEDDED_INITIATIVE_APP'));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadWorkspace(fs, project, controller.signal), /abort/i);
});

test('snapshot projects Markdown metadata only with collection, tasks, headings and line numbers', async () => {
  const fs = filesystem({
    '/project/openspec/project.md': '# Project\nOverview\n',
    '/project/openspec/specs/auth/spec.md': '# Auth\n### Requirement: Sign in\n#### Scenario: Success\n- [ ] Pending\n- [X] Done',
    '/project/openspec/changes/login/tasks.md': '# Tasks',
    '/project/openspec/changes/archive/2026-login/proposal.md': '# Archive',
    '/project/openspec/ignored.txt': 'secret',
  });
  const result = await snapshot(fs, project);
  assert.equal(result.exists, true);
  assert.equal(result.documents.length, 4);
  assert.deepEqual(new Set(result.documents.map(doc => doc.collection)), new Set(['project', 'specs', 'changes', 'archive']));
  const auth = result.documents.find(doc => doc.title === 'Auth');
  assert.deepEqual(auth.tasks, { total: 2, completed: 1, items: [{ text: 'Pending', completed: false, line: 4 }, { text: 'Done', completed: true, line: 5 }] });
  assert.deepEqual(auth.requirements, ['Sign in']);
  assert.deepEqual(auth.scenarios, ['Success']);
  assert.ok(result.documents.every(doc => !('content' in doc)));
  assert.deepEqual(result.warnings, []);
});

test('metadata directly follows original parser fence and hyphen task semantics', () => {
  const content = ['# Title', '````md', '- [x] hidden', '```', '### Requirement: hidden', '````', '~~~', '- [x] hidden too', '```', '~~~', '- [ ] real', '    - [x] indented code', '1. [X] numbered', '### Requirement: Real', '#### Scenario: Real scenario'].join('\n');
  const doc = metadata('openspec/tasks.md', content);
  assert.deepEqual(doc.tasks.items.map(item => item.text), []);
  assert.deepEqual(doc.requirements, ['hidden']);
  assert.deepEqual(doc.scenarios, []);
});

test('missing OpenSpec returns empty without creating anything', async () => {
  assert.deepEqual(await snapshot(filesystem(), project), { project, exists: false, documents: [], warnings: [] });
  await assert.rejects(readDocument(filesystem(), project, 'openspec/project.md'), /does not exist/);
});

test('document paths reject URLs, traversal, aliases, separators, non-Markdown and excessive depth', () => {
  for (const path of ['../secret.md', '/openspec/a.md', 'https://x/a.md', 'openspec/../a.md', 'openspec//a.md', 'openspec/./a.md', 'openspec/a%2f.md', 'openspec/a.md?x', 'openspec\\a.md', 'openspec/a.txt', `openspec/${'d/'.repeat(12)}a.md`, 'openspec/a\0.md']) assert.throws(() => documentPath(path), undefined, path);
  assert.equal(documentPath('openspec/changes/a/tasks.MD'), 'openspec/changes/a/tasks.MD');
});

test('canonical containment rejects external root, external files and external directories', async () => {
  const fs = filesystem({ '/project/openspec/ok.md': '# OK', '/outside/secret.md': '# Secret' }, { '/project/openspec/link.md': '/outside/secret.md', '/project/openspec/external': '/outside' });
  const result = await snapshot(fs, project);
  assert.equal(result.documents.length, 1);
  assert.equal(result.warnings.length, 2);
  await assert.rejects(readDocument(fs, project, 'openspec/link.md'), /escapes/);
  const external = filesystem({ '/outside/secret.md': '# Secret' }, { '/project/openspec': '/outside' });
  await assert.rejects(snapshot(external, project), /root escapes/);
  await assert.rejects(readDocument(external, project, 'openspec/secret.md'), /root escapes/);
});

test('document re-resolves and reads current content without a snapshot cache', async () => {
  const fs = filesystem({ '/project/openspec/a.md': '# Before' });
  await snapshot(fs, project);
  fs.readBytes = async () => new TextEncoder().encode('# After');
  const document = await readDocument(fs, project, 'openspec/a.md');
  assert.equal(document.path, 'openspec/a.md');
  assert.equal(document.content, '# After');
  assert.equal(document.markdown, '# After');
  assert.equal(document.title, 'After');
  assert.deepEqual(document.headings, [{ level: 1, text: 'After', anchor: 'after', line: 1 }]);
  fs.resolve = async path => ({ targetKey: 'external', displayPath: '/outside' });
  await assert.rejects(readDocument(fs, project, 'openspec/a.md'));
});

test('limits report skipped oversized documents, depth, count and aggregate bytes', async () => {
  const oversized = await snapshot(filesystem({ '/project/openspec/large.md': 'a'.repeat(LIMITS.documentBytes + 1) }), project);
  assert.match(oversized.warnings[0], /512 KiB/);
  assert.equal(oversized.documents.length, 0);
  const deep = await snapshot(filesystem({ [`/project/openspec/${'d/'.repeat(12)}a.md`]: '# Deep' }), project);
  assert.match(deep.warnings[0], /depth limit 12/);
  const many = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`/project/openspec/${i}.md`, '# Tiny']));
  const count = await snapshot(filesystem(many), project);
  assert.equal(count.documents.length, 500);
  assert.match(count.warnings[0], /Document limit 500/);
  const large = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`/project/openspec/${i}.md`, 'a'.repeat(LIMITS.documentBytes)]));
  const total = await snapshot(filesystem(large), project);
  assert.equal(total.documents.length, 16);
  assert.match(total.warnings[0], /8 MiB/);
});

test('filesystem read and listing errors are warnings, abort is not swallowed', async () => {
  const fs = filesystem({ '/project/openspec/a.md': '# A' });
  fs.readBytes = async () => { throw new Error('Permission denied'); };
  assert.match((await snapshot(fs, project)).warnings[0], /Permission denied/);
  await assert.rejects(readDocument(fs, project, 'openspec/a.md'), /Permission denied/);
  fs.listDir = async () => { throw new Error('Cannot list'); };
  assert.match((await snapshot(fs, project)).warnings[0], /Cannot list/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(snapshot(filesystem({ '/project/openspec/a.md': '# A' }), project, controller.signal), /abort/i);
});

test('project identity uses session registry then original header then effective directory', () => {
  const session = { header: { cwd: '/original' } };
  const ctx = { workspaceRegistry: { list: () => [{ id: 'w1', path: '/registered', title: 'Registered', sessionIds: ['one'] }, { id: 'w2', path: '/other', title: 'Other', sessionIds: ['two'] }] }, workingDirectory: { get: received => { assert.equal(received, session); return '/effective'; } } };
  assert.deepEqual(projectFor(ctx, { id: 'one', session }), { path: '/registered', title: 'Registered', workspaceId: 'w1' });
  assert.equal(projectFor(ctx, { id: 'unknown', session }).path, '/original');
  delete session.header.cwd;
  assert.equal(projectFor(ctx, { id: 'unknown', session }).path, '/effective');
  assert.throws(() => projectFor(ctx, { id: 'one' }), /session/);
});
