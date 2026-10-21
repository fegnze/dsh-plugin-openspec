// Hand-authored strict Typert contract. UI reads are not human commands.
// JSON strings preserve the existing bounded request/result protocol; Host
// action/path/hash validation remains authoritative after this wire check.
import { z } from 'zod';
const stringCodec = typeSymbol => ({
  mode: 'strict', typeSymbol,
  create: () => z.string(),
  jsonSchema: { type: 'string' },
});
export const TYPERT_REMOTE = {
  package: '@fegnze/dsh-plugin-openspec',
  descriptors: [{
    id: '@fegnze/dsh-plugin-openspec#openspec/read', service: 'openspec', namespace: 'openspec', method: 'read',
    invocation: { kind: 'direct' },
    parameters: [
      { name: 'agent', wire: 'agentId', source: 'lookup', lookup: 'agent', codec: stringCodec('@deepseek-ai/dsh-session/types#SessionId') },
      { name: 'requestJson', wire: 'requestJson', source: 'json', codec: stringCodec('@fegnze/dsh-plugin-openspec#ReadRequestJson') },
    ],
    cancellation: { parameter: 'signal' },
    result: stringCodec('@fegnze/dsh-plugin-openspec#ReadResultJson'),
    description: 'Read the receiving session project OpenSpec without writing command records.',
  }],
};
export const TYPERT = {
  package: '@fegnze/dsh-plugin-openspec', face: 'host', schemas: [],
  model: { services: [{ key: 'openspec', exportName: 'OpenSpecRemote', tags: [], members: [{ kind: 'method', name: 'read', signature: 'async read(agent: Agent, requestJson: string, signal: AbortSignal): Promise<string>' }], types: [] }], events: [], objects: [] },
  invocations: TYPERT_REMOTE.descriptors,
};
