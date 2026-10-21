import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { TYPERT, TYPERT_REMOTE } from '../src/remote-contract.mjs';
import { OpenSpecRemote } from '../src/host.mjs';

test('strict remote uses official agent identity and rejects non-string wire input', () => {
  const descriptor = TYPERT_REMOTE.descriptors[0];
  assert.equal(TYPERT.invocations[0], descriptor);
  assert.equal(descriptor.parameters[0].lookup, 'agent');
  assert.equal(descriptor.parameters[0].codec.typeSymbol, '@deepseek-ai/dsh-session/types#SessionId');
  for (const parameter of descriptor.parameters) {
    assert.equal(parameter.codec.create().parse('value'), 'value');
    assert.throws(() => parameter.codec.create().parse({}));
  }
});
test('real Cordis service reads scoped project without invoking or writing command events', async () => {
  const ctx = new Context();
  let writes = 0;
  for (const key of ['commands', 'workspaceRegistry', 'workingDirectory', 'fs']) ctx.provide(key);
  ctx.set('commands', { execute() { writes++; throw new Error('must not execute commands'); } });
  ctx.set('workspaceRegistry', { list: () => [] });
  ctx.set('workingDirectory', { get: () => '/wrong' });
  ctx.set('fs', { async resolve(path) { return { targetKey: path, displayPath: path }; }, contains: () => true, async stat(target) { return target.displayPath === 'openspec' ? undefined : { type: 'directory' }; } });
  const remote = new OpenSpecRemote(ctx);
  const agent = { id: 's', session: { header: { cwd: '/owned' }, append() { writes++; } } };
  const signal = new AbortController().signal;
  const result = JSON.parse(await remote.read(agent, '{"action":"workspace"}', signal));
  assert.equal(result.projectId, '/owned'); assert.equal(writes, 0);
  await assert.rejects(remote.read(agent, '{"action":"write"}', signal));
  assert.equal(writes, 0);

});
