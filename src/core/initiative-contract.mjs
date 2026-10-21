// Ported from OpenSpecGUI src/core/initiative-contract.js; pure provider contract logic.
import crypto from 'node:crypto';

var DESCRIPTOR_SCHEMA_VERSION = 1;
var MAX_DESCRIPTORS_PER_PROVIDER = 128;
var MAX_DESCRIPTOR_BYTES = 262144;
var IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
var ARTIFACT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
var DIAGNOSTIC_SEVERITIES = ['info', 'warning', 'error'];

function assertPlainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
        throw new Error(label + '必须是普通对象');
    }
    return value;
}

function assertAllowedKeys(value, allowed, label) {
    Object.keys(value).forEach(function (key) {
        if (allowed.indexOf(key) === -1) {
            throw new Error(label + '包含未支持字段：' + key);
        }
    });
}

function requireString(value, label, maximum) {
    var text = typeof value === 'string' ? value.trim() : '';
    if (!text) {
        throw new Error(label + '不能为空');
    }
    if (text.length > maximum) {
        throw new Error(label + '超过长度限制');
    }
    return text;
}

function optionalString(value, label, maximum) {
    if (value === undefined || value === null || value === '') {
        return '';
    }
    if (typeof value !== 'string' || value.length > maximum) {
        throw new Error(label + '超过长度限制');
    }
    return value.trim();
}

function normalizeIdentifier(value, label) {
    var identifier = requireString(value, label, 63);
    if (!IDENTIFIER_PATTERN.test(identifier)) {
        throw new Error(label + '必须是 English ASCII kebab-case');
    }
    return identifier;
}

function normalizeArtifactId(value) {
    var identifier = requireString(value, '成果 ID', 128);
    if (!ARTIFACT_ID_PATTERN.test(identifier)) {
        throw new Error('成果 ID 格式无效');
    }
    return identifier;
}

function normalizeDiagnostic(value, fallbackProviderId) {
    var item = assertPlainObject(value, '诊断');
    assertAllowedKeys(item, ['code', 'severity', 'title', 'message', 'providerId', 'initiativeId', 'resourceId'], '诊断');
    var severity = DIAGNOSTIC_SEVERITIES.indexOf(item.severity) === -1 ? 'error' : item.severity;
    return {
        code: requireString(item.code, '诊断代码', 80),
        severity: severity,
        title: requireString(item.title, '诊断标题', 160),
        message: requireString(item.message, '诊断内容', 1200),
        providerId: item.providerId ? normalizeIdentifier(item.providerId, 'Provider ID') : (fallbackProviderId || ''),
        initiativeId: item.initiativeId ? normalizeIdentifier(item.initiativeId, 'Initiative ID') : '',
        resourceId: item.resourceId ? requireString(item.resourceId, '资源 ID', 160) : ''
    };
}

function diagnostic(code, severity, title, message, details) {
    return normalizeDiagnostic(Object.assign({
        code: code,
        severity: severity,
        title: title,
        message: message
    }, details || {}), details && details.providerId);
}

function normalizeChangeRef(value) {
    var item = assertPlainObject(value, 'Change 关系');
    assertAllowedKeys(item, ['id', 'relationship'], 'Change 关系');
    var relationship = item.relationship;
    if (relationship !== 'owned' && relationship !== 'related') {
        throw new Error('Change 关系必须是 owned 或 related');
    }
    return {
        id: normalizeIdentifier(item.id, 'Change ID'),
        relationship: relationship
    };
}

function normalizeArtifact(value) {
    var item = assertPlainObject(value, '成果');
    assertAllowedKeys(item, ['id', 'title', 'mediaType', 'size'], '成果');
    var size = Number(item.size);
    return {
        id: normalizeArtifactId(item.id),
        title: requireString(item.title, '成果标题', 180),
        mediaType: requireString(item.mediaType, '成果媒体类型', 80),
        size: Number.isSafeInteger(size) && size >= 0 ? size : 0
    };
}

function uniqueSorted(items, keyBuilder, label) {
    var seen = new Set();
    var result = items.slice().sort(function (left, right) {
        return keyBuilder(left).localeCompare(keyBuilder(right));
    });
    result.forEach(function (item) {
        var key = keyBuilder(item);
        if (seen.has(key)) {
            throw new Error(label + '重复：' + key);
        }
        seen.add(key);
    });
    return result;
}

function normalizeDescriptor(value, expectedProviderId) {
    var item = assertPlainObject(value, 'InitiativeDescriptor');
    assertAllowedKeys(item, [
        'schemaVersion', 'id', 'providerId', 'collection', 'type', 'title', 'summary', 'goal', 'status', 'health',
        'changeRefs', 'presentation', 'artifacts', 'sourceHash', 'diagnostics'
    ], 'InitiativeDescriptor');
    if (item.schemaVersion !== DESCRIPTOR_SCHEMA_VERSION) {
        throw new Error('InitiativeDescriptor schema version 不受支持');
    }
    var providerId = normalizeIdentifier(item.providerId, 'Provider ID');
    if (expectedProviderId && providerId !== expectedProviderId) {
        throw new Error('InitiativeDescriptor Provider ID 与注册项不一致');
    }
    var presentation = assertPlainObject(item.presentation, 'presentation');
    assertAllowedKeys(presentation, ['mode'], 'presentation');
    if (presentation.mode !== 'generic' && presentation.mode !== 'embedded-app') {
        throw new Error('presentation.mode 必须是 generic 或 embedded-app');
    }
    var changeRefs = uniqueSorted((item.changeRefs || []).map(normalizeChangeRef), function (ref) {
        return ref.id + ':' + ref.relationship;
    }, 'Change 关系');
    var artifacts = uniqueSorted((item.artifacts || []).map(normalizeArtifact), function (artifact) {
        return artifact.id;
    }, '成果 ID');
    var normalized = {
        schemaVersion: DESCRIPTOR_SCHEMA_VERSION,
        id: normalizeIdentifier(item.id, 'Initiative ID'),
        providerId: providerId,
        collection: normalizeIdentifier(item.collection || 'initiatives', 'Initiative collection'),
        type: normalizeIdentifier(item.type, 'Initiative 类型'),
        title: requireString(item.title, 'Initiative 标题', 180),
        summary: optionalString(item.summary, 'Initiative 摘要', 1200),
        goal: optionalString(item.goal, 'Initiative 目标', 4000),
        status: requireString(item.status, 'Initiative 状态', 80),
        health: requireString(item.health, 'Initiative health', 80),
        changeRefs: changeRefs,
        presentation: { mode: presentation.mode },
        artifacts: artifacts,
        sourceHash: requireString(item.sourceHash, 'source hash', 128),
        diagnostics: (item.diagnostics || []).map(function (entry) {
            return normalizeDiagnostic(entry, providerId);
        })
    };
    if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > MAX_DESCRIPTOR_BYTES) {
        throw new Error('InitiativeDescriptor 超过 payload 限制');
    }
    return normalized;
}

function canonicalize(value) {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (value && typeof value === 'object') {
        return Object.keys(value).sort().reduce(function (result, key) {
            result[key] = canonicalize(value[key]);
            return result;
        }, {});
    }
    return value;
}

function stableJson(value) {
    return JSON.stringify(canonicalize(value));
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function createRelationshipIndex(changes, initiatives) {
    var changeIds = new Set(changes.map(function (change) { return change.referenceId || change.id; }));
    var activeChangeIds = new Set(changes.filter(function (change) {
        return change.type !== 'archive';
    }).map(function (change) { return change.referenceId || change.id; }));
    var owners = new Map();
    var diagnostics = [];

    initiatives.forEach(function (initiative) {
        initiative.changeRefs.forEach(function (ref) {
            if (!changeIds.has(ref.id)) {
                diagnostics.push(diagnostic(
                    'DANGLING_CHANGE_REFERENCE', 'warning', 'Change 引用已失效',
                    'Initiative ' + initiative.id + ' 引用了不存在的 Change：' + ref.id,
                    { providerId: initiative.providerId, initiativeId: initiative.id, resourceId: ref.id }
                ));
                return;
            }
            if (ref.relationship === 'owned') {
                if (!owners.has(ref.id)) {
                    owners.set(ref.id, []);
                }
                owners.get(ref.id).push({ providerId: initiative.providerId, initiativeId: initiative.id });
            }
        });
    });

    owners.forEach(function (entries, changeId) {
        entries.sort(function (left, right) {
            return (left.providerId + ':' + left.initiativeId).localeCompare(right.providerId + ':' + right.initiativeId);
        });
        if (entries.length > 1) {
            diagnostics.push(diagnostic(
                'MULTIPLE_CHANGE_OWNERS', 'error', 'Change 存在多重归属',
                'Change ' + changeId + ' 同时被 ' + entries.length + ' 个 Initiative 声明为 owned。',
                { resourceId: changeId }
            ));
        }
    });

    return {
        allChangeIds: Array.from(changeIds).sort(),
        independentChangeIds: Array.from(activeChangeIds).filter(function (changeId) {
            return !owners.has(changeId) || owners.get(changeId).length !== 1;
        }).sort(),
        owners: Array.from(owners.keys()).sort().map(function (changeId) {
            return { changeId: changeId, initiatives: owners.get(changeId) };
        }),
        diagnostics: diagnostics.sort(function (left, right) {
            return (left.code + ':' + left.resourceId + ':' + left.initiativeId).localeCompare(right.code + ':' + right.resourceId + ':' + right.initiativeId);
        })
    };
}

export {
    ARTIFACT_ID_PATTERN,
    DESCRIPTOR_SCHEMA_VERSION,
    IDENTIFIER_PATTERN,
    MAX_DESCRIPTORS_PER_PROVIDER,
    MAX_DESCRIPTOR_BYTES,
    createRelationshipIndex,
    diagnostic,
    normalizeArtifactId,
    normalizeDescriptor,
    normalizeDiagnostic,
    normalizeIdentifier,
    sha256,
    stableJson
};
