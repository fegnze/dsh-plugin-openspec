// Ported from OpenSpecGUI src/core/initiative-provider-registry.js; pure provider contract logic.
import * as contract from './initiative-contract.mjs';

function providerDiagnostic(providerId, code, title, message) {
    return contract.diagnostic(code, 'error', title, message, { providerId: providerId });
}

function providerKey(context, providerId) {
    return context.projectRoot + '\n' + providerId;
}

function staleDescriptor(descriptor, providerId, message) {
    return Object.assign({}, descriptor, {
        health: 'attention',
        diagnostics: (descriptor.diagnostics || []).concat([contract.diagnostic(
            'STALE_PROVIDER_SNAPSHOT', 'warning', 'Provider 快照已失效', message,
            { providerId: providerId, initiativeId: descriptor.id }
        )])
    });
}

/**
 * 建立只包含应用打包时可信 Provider 的静态注册表。
 * @param {Array<object>} providers 可信 Provider 实例
 */
function InitiativeProviderRegistry(providers) {
    this.providers = new Map();
    this.cache = new Map();
    (providers || []).forEach(this.register.bind(this));
}

InitiativeProviderRegistry.prototype.register = function (provider) {
    if (!provider || typeof provider !== 'object') {
        throw new Error('Initiative Provider 必须是对象');
    }
    var id = contract.normalizeIdentifier(provider.id, 'Provider ID');
    if (this.providers.has(id)) {
        throw new Error('Initiative Provider 重复注册：' + id);
    }
    if (!Array.isArray(provider.schemaVersions) || provider.schemaVersions.indexOf(contract.DESCRIPTOR_SCHEMA_VERSION) === -1) {
        throw new Error('Initiative Provider 不支持当前 descriptor version：' + id);
    }
    ['discover', 'fingerprint', 'load', 'readArtifact'].forEach(function (method) {
        if (typeof provider[method] !== 'function') {
            throw new Error('Initiative Provider 缺少方法：' + id + '.' + method);
        }
    });
    this.providers.set(id, provider);
};

InitiativeProviderRegistry.prototype.list = function () {
    return Array.from(this.providers.keys()).sort();
};

InitiativeProviderRegistry.prototype.get = function (providerId) {
    return this.providers.get(providerId) || null;
};

InitiativeProviderRegistry.prototype.discover = async function (context) {
    var initiatives = [];
    var diagnostics = [];
    var fingerprints = [];
    var seenIds = new Map();
    var conflictedIds = new Set();
    var providerIds = this.list();

    function appendDescriptors(descriptors, providerId) {
        descriptors.forEach(function (descriptor) {
            if (conflictedIds.has(descriptor.id)) {
                return;
            }
            if (seenIds.has(descriptor.id)) {
                initiatives = initiatives.filter(function (item) { return item.id !== descriptor.id; });
                conflictedIds.add(descriptor.id);
                diagnostics.push(providerDiagnostic(
                    providerId,
                    'DUPLICATE_INITIATIVE_ID',
                    'Initiative ID 冲突',
                    descriptor.id + ' 已由 Provider ' + seenIds.get(descriptor.id) + ' 发现，冲突候选已拒绝。'
                ));
                return;
            }
            seenIds.set(descriptor.id, providerId);
            initiatives.push(descriptor);
        });
    }

    for (var providerIndex = 0; providerIndex < providerIds.length; providerIndex += 1) {
        var providerId = providerIds[providerIndex];
        var provider = this.providers.get(providerId);
        var cacheKey = providerKey(context, providerId);
        var fingerprint;
        var fingerprintRecord;
        try {
            try {
                fingerprint = String(await provider.fingerprint(context));
                fingerprintRecord = { providerId: providerId, value: fingerprint };
            } catch (fingerprintError) {
                fingerprintRecord = { providerId: providerId, error: 'FINGERPRINT_FAILED' };
                throw fingerprintError;
            }
            var discovery = await provider.discover(context);
            var discovered = Array.isArray(discovery) ? discovery : discovery && discovery.initiatives;
            var authoritative = Array.isArray(discovery) || discovery.authoritative !== false;
            var invalidInitiativeIds = Array.isArray(discovery) ? [] : (discovery.invalidInitiativeIds || []);
            if (!Array.isArray(discovered)) {
                throw new Error('discover 必须返回 Initiative 数组');
            }
            if (!Array.isArray(invalidInitiativeIds) || invalidInitiativeIds.length > contract.MAX_DESCRIPTORS_PER_PROVIDER) {
                throw new Error('discover invalidInitiativeIds 无效');
            }
            invalidInitiativeIds = invalidInitiativeIds.map(function (initiativeId) {
                return contract.normalizeIdentifier(initiativeId, '无效 Initiative ID');
            });
            if (!authoritative && !invalidInitiativeIds.length) {
                throw new Error('非权威 discover 结果必须声明无效 Initiative ID');
            }
            if (discovery && Array.isArray(discovery.diagnostics)) {
                discovery.diagnostics.forEach(function (item) {
                    diagnostics.push(contract.normalizeDiagnostic(item, providerId));
                });
            }
            if (discovered.length > contract.MAX_DESCRIPTORS_PER_PROVIDER) {
                throw new Error('descriptor 数量超过限制');
            }
            var normalized = discovered.map(function (descriptor) {
                return contract.normalizeDescriptor(descriptor, providerId);
            }).sort(function (left, right) {
                return left.id.localeCompare(right.id);
            });
            var serialized = contract.stableJson(normalized);
            var previous = this.cache.get(cacheKey);
            if (!authoritative) {
                var currentIds = new Set(normalized.map(function (descriptor) { return descriptor.id; }));
                var invalidIds = new Set(invalidInitiativeIds);
                var lastSuccessful = normalized.slice();
                var staleDescriptors = [];
                if (previous) {
                    previous.initiatives.filter(function (descriptor) {
                        return invalidIds.has(descriptor.id) && !currentIds.has(descriptor.id);
                    }).forEach(function (descriptor) {
                        lastSuccessful.push(descriptor);
                        staleDescriptors.push(staleDescriptor(
                            descriptor,
                            providerId,
                            '当前 Initiative 清单无法通过校验，此条目仅保留上一个可读快照供参考。'
                        ));
                    });
                }
                lastSuccessful.sort(function (left, right) { return left.id.localeCompare(right.id); });
                normalized = normalized.concat(staleDescriptors).sort(function (left, right) { return left.id.localeCompare(right.id); });
                this.cache.set(cacheKey, {
                    fingerprint: fingerprint,
                    serialized: contract.stableJson(lastSuccessful),
                    initiatives: lastSuccessful
                });
            } else if (previous && previous.fingerprint === fingerprint && previous.serialized !== serialized) {
                diagnostics.push(providerDiagnostic(
                    providerId,
                    'UNSTABLE_PROVIDER_RESULT',
                    'Provider 结果不稳定',
                    '相同 fingerprint 产生了不同 Initiative 集合，已保留上一个稳定结果。'
                ));
                normalized = previous.initiatives;
                serialized = previous.serialized;
            } else {
                this.cache.set(cacheKey, {
                    fingerprint: fingerprint,
                    serialized: serialized,
                    initiatives: normalized
                });
            }
            appendDescriptors(normalized, providerId);
            fingerprints.push(fingerprintRecord);
        } catch (error) {
            diagnostics.push(providerDiagnostic(providerId, 'PROVIDER_DISCOVERY_FAILED', 'Provider 发现失败', error.message));
            fingerprints.push(fingerprintRecord || { providerId: providerId, error: 'FINGERPRINT_FAILED' });
            var historical = this.cache.get(cacheKey);
            if (historical) {
                appendDescriptors(historical.initiatives.map(function (descriptor) {
                    return staleDescriptor(
                        descriptor,
                        providerId,
                        '当前 Provider 无法产生有效数据，此条目仅保留上一个可读快照供参考。'
                    );
                }), providerId);
            }
        }
    }

    initiatives.sort(function (left, right) {
        return (left.providerId + ':' + left.id).localeCompare(right.providerId + ':' + right.id);
    });
    diagnostics.sort(function (left, right) {
        return (left.providerId + ':' + left.code + ':' + left.initiativeId).localeCompare(right.providerId + ':' + right.code + ':' + right.initiativeId);
    });
    return { initiatives: initiatives, diagnostics: diagnostics, fingerprints: fingerprints };
};

InitiativeProviderRegistry.prototype.fingerprint = async function (context) {
    var values = [];
    var providerIds = this.list();
    for (var index = 0; index < providerIds.length; index += 1) {
        var providerId = providerIds[index];
        try {
            values.push({ providerId: providerId, value: String(await this.providers.get(providerId).fingerprint(context)) });
        } catch (error) {
            values.push({ providerId: providerId, error: 'FINGERPRINT_FAILED' });
        }
    }
    return contract.sha256(contract.stableJson(values));
};

InitiativeProviderRegistry.prototype.load = function (context, descriptor) {
    var provider = this.get(descriptor.providerId);
    if (!provider) {
        throw new Error('Initiative Provider 未注册');
    }
    return provider.load(context, descriptor);
};

InitiativeProviderRegistry.prototype.readArtifact = function (context, descriptor, request) {
    var provider = this.get(descriptor.providerId);
    if (!provider) {
        throw new Error('Initiative Provider 未注册');
    }
    return provider.readArtifact(context, descriptor, request);
};

InitiativeProviderRegistry.prototype.prepareApp = function (context, descriptor) {
    var provider = this.get(descriptor.providerId);
    if (!provider || typeof provider.prepareApp !== 'function') {
        var error = new Error('Initiative Provider 不支持独立应用');
        error.code = 'EMBEDDED_APP_UNAVAILABLE';
        return Promise.reject(error);
    }
    return provider.prepareApp(context, descriptor);
};

export {
    InitiativeProviderRegistry
};
