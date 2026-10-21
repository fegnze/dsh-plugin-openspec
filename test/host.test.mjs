import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, inject, executeRead, fitToBudget, commandText, COMMAND_BUDGET_BYTES } from '../src/host.mjs';

function harness() {
  let definition, disposed = false, effect;
  const calls = [];
  const fs = {
    async resolve(path, options) { calls.push([path, options?.cwd]); return { targetKey: path, displayPath: path }; },
    contains: () => true,
    async stat(target) { return target.displayPath === 'openspec' ? undefined : { type: 'directory' }; },
  };
  const ctx = { typert: { register() { return () => {}; } }, plugin() {}, fs, commands: { register(value) { definition = value; return () => { disposed = true; }; } }, workspaceRegistry: { list: () => [] }, workingDirectory: { get: () => { throw new Error('must not follow changed cwd'); } }, effect(callback) { effect = callback(); } };
  apply(ctx);
  return { ctx, fs, calls, get definition() { return definition; }, dispose() { effect(); return disposed; } };
}
const agent = (id = 'session-one', cwd = '/project') => ({ id, session: { header: { cwd } } });
const invocation = (rawInput, receiving = agent()) => ({ rawInput, agent: receiving, signal: new AbortController().signal });

test('Host injects read-only seams, registers human command and disposes via ctx.effect', () => {
  const host = harness();
  assert.deepEqual(inject, ['fs', 'commands', 'workspaceRegistry', 'workingDirectory', 'typert']);
  assert.equal(host.definition.name, 'openspec-view');
  assert.equal(host.definition.recordInput, false);
  assert.equal(host.dispose(), true);
});

test('snapshot returns JSON success anchored to receiving session header, not current cwd', async () => {
  const host = harness();
  const result = await executeRead(host.ctx, invocation('{"action":"snapshot"}'));
  assert.equal(result.kind, 'success');
  assert.deepEqual(JSON.parse(result.text), { project: { path: '/project', title: 'project' }, exists: false, documents: [], warnings: [] });
  assert.deepEqual(host.calls, [['/project', undefined], ['openspec', '/project']]);
});

test('receiving Agent filesystem overrides plugin fs and each session resolves independently', async () => {
  const host = harness();
  let called = 0;
  const scoped = { ...host.fs, async resolve(path, options) { called++; return { targetKey: path, displayPath: path === 'openspec' ? 'openspec' : options?.cwd || path }; } };
  const receiving = agent('session-two', '/second');
  receiving.ctx = { get: key => { assert.equal(key, 'fs'); return scoped; } };
  let result = await executeRead(host.ctx, invocation('{"action":"snapshot"}', receiving));
  assert.equal(JSON.parse(result.text).project.path, '/second');
  assert.equal(called, 2);
  assert.equal(host.calls.length, 0);
  result = await executeRead(host.ctx, invocation('{"action":"snapshot"}', agent()));
  assert.equal(JSON.parse(result.text).project.path, '/project');
});

test('registry association is by receiving agent id, not another session cwd', async () => {
  const host = harness();
  host.ctx.workspaceRegistry.list = () => [{ id: 'w', path: '/owned', title: 'Owned', sessionIds: ['session-two'] }];
  const result = await executeRead(host.ctx, invocation('{"action":"snapshot"}', agent('session-two', '/other')));
  assert.deepEqual(JSON.parse(result.text).project, { path: '/owned', title: 'Owned', workspaceId: 'w' });
});

test('document action returns the freshly read content as JSON success', async () => {
  const host = harness();
  host.fs.stat = async target => ({ type: target.displayPath.endsWith('.md') ? 'file' : 'directory', size: 7 });
  host.fs.readBytes = async () => new TextEncoder().encode('# Fresh');
  const result = await executeRead(host.ctx, invocation('{"action":"document","path":"openspec/specs/a/spec.md"}'));
  assert.equal(result.kind, 'success');
  const data = JSON.parse(result.text);
  assert.equal(data.path, 'openspec/specs/a/spec.md');
  assert.equal(data.content, '# Fresh');
  assert.equal(data.markdown, '# Fresh');
  assert.equal(data.id, data.path);
  assert.equal(data.kind, 'spec');
  assert.equal(data.title, 'Fresh');
  assert.deepEqual(data.warnings, []);
});

test('workspace action exposes original workbench envelope and rejects paths', async () => {
  const host = harness();
  const result = await executeRead(host.ctx, invocation('{"action":"workspace"}'));
  assert.equal(result.kind, 'success');
  assert.deepEqual(JSON.parse(result.text), { projectId: '/project', revision: 0, snapshot: null, warnings: [] });
  assert.equal((await host.definition.handler(invocation('{"action":"workspace","path":"openspec/a.md"}'))).kind, 'error');
});

test('malformed inputs, invalid actions and document paths settle as errors', async () => {
  const host = harness();
  for (const raw of ['', 'null', '[]', '{"action":"write"}', '{"action":"snapshot","path":"x"}', '{"action":"snapshot","cwd":"/escape"}', '{"action":"document"}', '{"action":"document","path":"../secret.md"}']) {
    const result = await host.definition.handler(invocation(raw));
    assert.equal(result.kind, 'error', raw);
    assert.ok(result.text);
  }
});

test('app command reads a declared original-schema HTML entry through receiving session fs', async () => {
  const host = harness();
  const html = '<!doctype html><h1>Embedded app</h1>';
  const files = new Map([
    ['/project/openspec/programs/launch/initiative-app.json', JSON.stringify({ $schema: 'https://openspec.dev/schemas/initiative-app-v1.json', schemaVersion: 1, id: 'launch', kind: 'program', title: 'Launch', summary: 'Launch app', presentation: { type: 'embedded-app', webRoot: 'web', entry: 'index.html' } })],
    ['/project/openspec/programs/launch/web/index.html', html],
    ['/project/openspec/programs/launch/web/styles.css', 'h1 { color: blue; }'],
    ['/project/openspec/programs/launch/web/app.js', 'window.hostMustNotRun = true;'],
  ]);
  const directories = new Set(['/project', '/project/openspec', '/project/openspec/programs', '/project/openspec/programs/launch', '/project/openspec/programs/launch/web']);
  host.fs.resolve = async (path, options) => { const absolute = path.startsWith('/') ? path : `${options.cwd}/${path}`; return { targetKey: absolute, displayPath: absolute }; };
  host.fs.contains = (parent, child) => child.displayPath === parent.displayPath || child.displayPath.startsWith(`${parent.displayPath}/`);
  host.fs.stat = async target => files.has(target.displayPath) ? { type: 'file', size: Buffer.byteLength(files.get(target.displayPath)) } : directories.has(target.displayPath) ? { type: 'directory' } : undefined;
  host.fs.listDir = async target => [...directories, ...files.keys()].filter(path => path.startsWith(`${target.displayPath}/`) && !path.slice(target.displayPath.length + 1).includes('/')).map(path => ({ name: path.slice(target.displayPath.length + 1) }));
  host.fs.readBytes = async (target, signal, maxBytes) => { const bytes = Buffer.from(files.get(target.displayPath)); assert.ok(bytes.length <= maxBytes); return bytes; };
  const workspace = await executeRead(host.ctx, invocation('{"action":"workspace"}'));
  assert.equal(workspace.kind, 'success');
  const descriptor = JSON.parse(workspace.text).snapshot.initiatives[0];
  const result = await executeRead(host.ctx, invocation(JSON.stringify({ action: 'app', providerId: descriptor.providerId, initiativeId: descriptor.id, revision: 0, sourceHash: descriptor.sourceHash })));
  assert.equal(result.kind, 'success');
  assert.deepEqual(JSON.parse(result.text), { html, title: 'Launch', sourceHash: descriptor.sourceHash, assets: { 'styles.css': 'h1 { color: blue; }', 'app.js': 'window.hostMustNotRun = true;' } });
  assert.equal(globalThis.hostMustNotRun, undefined);
  files.set('/project/openspec/programs/launch/web/styles.css', 'h1 { color: red; }');
  const stale = await host.definition.handler(invocation(JSON.stringify({ action: 'app', providerId: descriptor.providerId, initiativeId: descriptor.id, revision: 0, sourceHash: descriptor.sourceHash })));
  assert.equal(stale.kind, 'error');
  assert.match(stale.text, /STALE_INITIATIVE/);
});

test('app requests strictly validate provider identity, revision, hash and extra fields before IO', async () => {
  const host = harness();
  const valid = { action: 'app', providerId: 'openspec-embedded-app-v1', initiativeId: 'launch', revision: 0, sourceHash: 'a'.repeat(64) };
  for (const change of [{ revision: 1 }, { revision: '0' }, { sourceHash: undefined }, { sourceHash: 'stale' }, { sourceHash: 123 }, { providerId: '../escape' }, { initiativeId: '../escape' }, { path: 'index.html' }, { html: '<script>bad</script>' }, { artifactId: 'x' }]) {
    const result = await host.definition.handler(invocation(JSON.stringify({ ...valid, ...change })));
    assert.equal(result.kind, 'error', JSON.stringify(change));
    assert.equal(host.calls.length, 0, 'invalid request must not touch filesystem');
  }
  const accepted = await host.definition.handler(invocation(JSON.stringify(valid)));
  assert.equal(accepted.kind, 'error');
  assert.match(accepted.text, /OpenSpec directory does not exist/);
  assert.equal(host.calls.length, 2);
});

test('filesystem failures, missing Agent session and cancellation become error results', async () => {
  const host = harness();
  host.fs.resolve = async () => { throw new Error('Backend unavailable'); };
  assert.deepEqual(await host.definition.handler(invocation('{"action":"snapshot"}')), { kind: 'error', text: 'Backend unavailable' });
  assert.equal((await host.definition.handler(invocation('{"action":"snapshot"}', { id: 'no-session' }))).kind, 'error');
  const controller = new AbortController(); controller.abort();
  assert.equal((await host.definition.handler({ ...invocation('{"action":"snapshot"}'), signal: controller.signal })).kind, 'error');
});

function wideWorkspace(documents = 400) {
  const files = new Map();
  const directories = new Set(['/project', '/project/openspec', '/project/openspec/specs']);
  for (let index = 0; index < documents; index += 1) {
    const directory = `/project/openspec/specs/s${index}`;
    directories.add(directory);
    files.set(`${directory}/spec.md`, `# Spec ${index}\n\n## Why\n\nreason ${index}\n`);
  }
  return { files, directories };
}

function attachFs(host, { files, directories }) {
  host.fs.resolve = async (path, options) => {
    const absolute = path.startsWith('/') ? path : `${options.cwd}/${path}`;
    return { targetKey: absolute, displayPath: absolute };
  };
  host.fs.contains = (parent, child) => child.displayPath === parent.displayPath || child.displayPath.startsWith(`${parent.displayPath}/`);
  host.fs.stat = async target => files.has(target.displayPath)
    ? { type: 'file', size: Buffer.byteLength(files.get(target.displayPath)) }
    : directories.has(target.displayPath) ? { type: 'directory' } : undefined;
  host.fs.listDir = async target => [...directories, ...files.keys()]
    .filter(path => path.startsWith(`${target.displayPath}/`) && !path.slice(target.displayPath.length + 1).includes('/'))
    .map(path => ({ name: path.slice(target.displayPath.length + 1) }));
  host.fs.readBytes = async (target, signal, maxBytes) => {
    const bytes = Buffer.from(files.get(target.displayPath));
    assert.ok(bytes.length <= maxBytes);
    return bytes;
  };
}

test('human command stays inside the persistence budget while Typert reads stay unbounded', async () => {
  const host = harness();
  attachFs(host, wideWorkspace());
  const request = invocation('{"action":"snapshot"}');

  const command = await host.definition.handler(request);
  assert.equal(command.kind, 'success');
  assert.ok(Buffer.byteLength(command.text, 'utf8') <= COMMAND_BUDGET_BYTES, `command output ${Buffer.byteLength(command.text)} exceeded budget`);
  assert.match(command.text, /^OpenSpec · /);
  assert.match(command.text, /400 篇文档/);
  assert.match(command.text, /openspec\/specs\/s0\/spec\.md/);
  assert.doesNotMatch(command.text, /"projectId"/, 'command output must be readable text, not one collapsed JSON line');

  const remote = await executeRead(host.ctx, request);
  assert.equal(remote.kind, 'success');
  assert.ok(Buffer.byteLength(remote.text, 'utf8') > COMMAND_BUDGET_BYTES);
  const full = JSON.parse(remote.text);
  assert.equal(full.truncated, undefined);
  assert.equal(full.documents.length, 400);
});

test('document action renders readable text and clips oversized bodies to the budget', async () => {
  const host = harness();
  const content = `# Big\n\n${'line\n'.repeat(40000)}`;
  host.fs.stat = async target => (target.displayPath.endsWith('.md')
    ? { type: 'file', size: Buffer.byteLength(content) }
    : { type: 'directory' });
  host.fs.readBytes = async () => Buffer.from(content);
  const result = await host.definition.handler(invocation('{"action":"document","path":"openspec/project.md"}'));
  assert.equal(result.kind, 'success');
  assert.ok(Buffer.byteLength(result.text, 'utf8') <= COMMAND_BUDGET_BYTES);
  assert.match(result.text, /^openspec\/project\.md/);
  assert.match(result.text, new RegExp(`已截断：原文 ${content.length} 字符`));
  const remote = await executeRead(host.ctx, invocation('{"action":"document","path":"openspec/project.md"}'));
  assert.equal(JSON.parse(remote.text).content, content);
});

test('fitToBudget leaves small payloads byte-identical and reduces oversized ones', () => {
  const small = { project: { path: '/p' }, exists: true, documents: [], warnings: [] };
  assert.equal(fitToBudget(small), small);
  const large = { documents: Array.from({ length: 300 }, (_, index) => ({ path: `openspec/specs/s${index}/spec.md`, title: `Spec ${index}`, summary: 'x'.repeat(400), requirements: [{ id: index }], scenarios: [{ id: index }] })) };
  assert.ok(Buffer.byteLength(JSON.stringify(large)) > COMMAND_BUDGET_BYTES);
  const fitted = fitToBudget(large);
  assert.ok(Buffer.byteLength(JSON.stringify(fitted)) <= COMMAND_BUDGET_BYTES);
  assert.equal(fitted.truncated, true);
});

test('workspace report renders the real project shape instead of collapsing to an empty index', () => {
  const data = {
    projectId: 'p', revision: 0, warnings: [],
    snapshot: {
      project: { name: 'WTC-Web' },
      stats: { specs: 22, activeChanges: 3, archivedChanges: 37, completedTasks: 56, totalTasks: 62, pendingTasks: 6, issues: 0 },
      changes: [{ id: 'add-dh-delivery-dashboard', title: 'DH 双入口交付轻量总控页', tasks: { completed: 5, total: 7 }, documents: [{ path: 'openspec/changes/add-dh-delivery-dashboard/proposal.md' }] }],
      specs: [{ id: 'auth-bootstrap-resilience', title: 'auth-bootstrap-resilience', requirements: [1, 2, 3, 4], scenarios: [1, 2, 3, 4, 5, 6, 7, 8, 9], documents: [{ path: 'openspec/specs/auth-bootstrap-resilience/spec.md' }] }],
      archives: [{ id: '2026-08-14-add-game-iframe-embedding', title: 'Add Game Iframe Embedding' }],
      taskQueue: [{ changeId: 'add-dh-delivery-dashboard', id: '3.2', text: '验收专项' }],
    },
  };
  const text = commandText(data, 'workspace', COMMAND_BUDGET_BYTES);
  assert.match(text, /^OpenSpec · WTC-Web/);
  assert.match(text, /规格 22 · 变更 3 · 归档 37 · 任务 56\/62 · 待办 6/);
  assert.match(text, /进行中的变更（1）/);
  assert.match(text, /- add-dh-delivery-dashboard {2}5\/7 {2}DH 双入口交付轻量总控页/);
  assert.match(text, /openspec\/changes\/add-dh-delivery-dashboard\/proposal\.md/);
  assert.match(text, /- auth-bootstrap-resilience {2}4 需求 \/ 9 场景/);
  assert.match(text, /已归档变更（1）/);
  assert.match(text, /待办任务（1）/);
  assert.match(text, /action":"document"/);
  assert.ok(Buffer.byteLength(text, 'utf8') <= COMMAND_BUDGET_BYTES);
  assert.doesNotMatch(text, /"projectId"/);
});
