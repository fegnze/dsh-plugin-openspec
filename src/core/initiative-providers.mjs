import { createGenericInitiativeProvider } from './generic-initiative-provider.mjs';
import { createEmbeddedInitiativeAppProvider } from './embedded-initiative-app-provider.mjs';
import { InitiativeProviderRegistry } from './initiative-provider-registry.mjs';

/**
 * Original OpenSpecGUI registry contracts with caller-owned capability I/O.
 * fsPromises must be a bounded, workspace-scoped adapter, never ambient node:fs.
 * Embedded apps return only their declared HTML entry; no assets or host actions.
 */
export function createDefaultInitiativeRegistry(options = {}) {
    return new InitiativeProviderRegistry([
        createGenericInitiativeProvider(options),
        createEmbeddedInitiativeAppProvider(options)
    ]);
}
