// Ported from OpenSpecGUI generic-initiative-provider.js. All I/O is supplied by the caller.
import * as contract from './initiative-contract.mjs';

export function createGenericInitiativeProvider(options = {}) {
const { fsPromises, path, YAML, fsConstants = { O_RDONLY: 0, O_NOFOLLOW: 0 } } = options;
if (!fsPromises || !path) { throw new TypeError('Generic initiative provider requires injected fsPromises and path'); }
var PROVIDER_ID = 'openspec-generic-initiative-v1';
var MANIFEST_NAME = 'initiative.yaml';
var MANIFEST_SCHEMA_VERSION = 1;
var MAX_MANIFEST_BYTES = 131072;
var MAX_ARTIFACT_BYTES = 1048576;
var MAX_TOTAL_ARTIFACT_BYTES = 8388608;
var MAX_INITIATIVES = 128;
var STATUS_VALUES = ['planned', 'active', 'paused', 'complete'];
var HEALTH_VALUES = ['healthy', 'attention', 'blocked', 'unknown'];
var TEXT_MEDIA_TYPES = {
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.yaml': 'application/yaml',
    '.yml': 'application/yaml'
};

function toPosix(value) {
    return value.split(path.sep).join('/');
}

function isWithin(rootPath, targetPath) {
    var relative = path.relative(rootPath, targetPath);
    return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function assertPlainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
        throw new Error(label + '必须是对象');
    }
    return value;
}

function assertKeys(value, keys, label) {
    Object.keys(value).forEach(function (key) {
        if (keys.indexOf(key) === -1) {
            throw new Error(label + '包含未支持字段：' + key);
        }
    });
}

function requireText(value, label, maximum) {
    var text = typeof value === 'string' ? value.trim() : '';
    if (!text) {
        throw new Error(label + '不能为空');
    }
    if (text.length > maximum) {
        throw new Error(label + '超过长度限制');
    }
    return text;
}

function parseManifest(content) {
    if (!YAML?.parseDocument) {
        try { return JSON.parse(content); } catch (cause) {
            var unsupported = new Error('YAML parsing is unavailable in this DSH build; use an initiative.json manifest.');
            unsupported.code = 'UNSUPPORTED_YAML';
            throw unsupported;
        }
    }
    var document = YAML.parseDocument(content, {
        maxAliasCount: 0,
        prettyErrors: false,
        strict: true,
        uniqueKeys: true
    });
    if (document.errors.length) {
        throw new Error('YAML 无效：' + document.errors[0].message);
    }
    return document.toJS({ maxAliasCount: 0 });
}

function validateRelativeArtifactPath(value) {
    var artifactPath = requireText(value, '成果路径', 320);
    var normalized = artifactPath.replace(/\\/g, '/');
    var segments = normalized.split('/');
    if (path.isAbsolute(artifactPath) || /^[a-z]+:/i.test(artifactPath) || normalized.charAt(0) === '/' || segments.some(function (segment) {
        return !segment || segment === '.' || segment === '..';
    })) {
        throw new Error('成果路径必须是 openspec 根内的安全相对路径');
    }
    if (!TEXT_MEDIA_TYPES[path.extname(normalized).toLowerCase()]) {
        throw new Error('成果文件类型不受支持：' + path.extname(normalized));
    }
    return normalized;
}

async function assertNoSymlink(rootPath, targetPath) {
    if (!isWithin(rootPath, targetPath)) { throw new Error('路径超出 openspec 根目录'); }
    var relative = path.relative(rootPath, targetPath);
    var segments = relative ? relative.split(path.sep) : [];
    if ((await fsPromises.lstat(rootPath)).isSymbolicLink()) { throw new Error('拒绝符号链接根目录'); }
    var current = rootPath;
    for (var index = 0; index < segments.length; index += 1) {
        current = path.join(current, segments[index]);
        var stat = await fsPromises.lstat(current);
        if (stat.isSymbolicLink()) {
            throw new Error('拒绝符号链接路径：' + toPosix(relative));
        }
    }
}

async function readRegularFile(rootPath, targetPath, maximumBytes, label) {
    await assertNoSymlink(rootPath, targetPath);
    var realPath = await fsPromises.realpath(targetPath);
    if (!isWithin(rootPath, realPath)) {
        throw new Error(label + '超出 openspec 根目录');
    }
    var handle = await fsPromises.open(realPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    try {
        var stat = await handle.stat();
        if (!stat.isFile()) {
            throw new Error(label + '不是普通文件');
        }
        if (stat.size > maximumBytes) {
            throw new Error(label + '超过读取限制');
        }
        var content = Buffer.from(await handle.readFile());
        if (content.byteLength > maximumBytes) { throw new Error(label + '超过读取限制'); }
        return { realPath: realPath, stat: Object.assign(Object.create(stat), { size: content.byteLength }), content: content };
    } finally {
        await handle.close();
    }
}

async function validateArtifact(openspecRealRoot, value) {
    var item = assertPlainObject(value, '成果');
    assertKeys(item, ['id', 'title', 'path'], '成果');
    var relativePath = validateRelativeArtifactPath(item.path);
    var target = path.resolve(openspecRealRoot, relativePath);
    if (!isWithin(openspecRealRoot, target)) {
        throw new Error('成果路径超出 openspec 根目录');
    }
    var opened = await readRegularFile(openspecRealRoot, target, MAX_ARTIFACT_BYTES, '成果');
    return {
        id: contract.normalizeArtifactId(item.id),
        title: requireText(item.title, '成果标题', 180),
        relativePath: relativePath,
        absolutePath: target,
        realPath: opened.realPath,
        mediaType: TEXT_MEDIA_TYPES[path.extname(relativePath).toLowerCase()],
        size: opened.stat.size,
        contentHash: contract.sha256(opened.content)
    };
}

function validateChangeRefs(value) {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value) || value.length > 256) {
        throw new Error('changes 必须是最多 256 项的数组');
    }
    return value.map(function (entry) {
        var item = assertPlainObject(entry, 'Change 关系');
        assertKeys(item, ['id', 'relationship'], 'Change 关系');
        if (item.relationship !== 'owned' && item.relationship !== 'related') {
            throw new Error('Change 关系必须是 owned 或 related');
        }
        return { id: contract.normalizeIdentifier(item.id, 'Change ID'), relationship: item.relationship };
    });
}

async function resolveManifestPath(directory) {
    var jsonPath = path.join(directory, 'initiative.json');
    try { await fsPromises.lstat(jsonPath); return jsonPath; } catch (error) {
        if (error.code !== 'ENOENT') { throw error; }
    }
    return path.join(directory, MANIFEST_NAME);
}

async function readValidatedManifest(context, directory) {
    var initiativeId = path.basename(directory);
    var manifestPath = await resolveManifestPath(directory);
    var openedManifest = await readRegularFile(context.openspecRealRoot, manifestPath, MAX_MANIFEST_BYTES, 'Initiative 清单');
    var content = openedManifest.content.toString('utf8');
    var manifest = assertPlainObject(parseManifest(content), 'Initiative 清单');
    assertKeys(manifest, ['schemaVersion', 'id', 'title', 'summary', 'goal', 'status', 'health', 'changes', 'artifacts'], 'Initiative 清单');
    if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
        throw new Error('Initiative 清单 schemaVersion 不受支持');
    }
    var manifestId = contract.normalizeIdentifier(manifest.id, 'Initiative ID');
    if (manifestId !== initiativeId) {
        throw new Error('Initiative 目录名与清单 ID 不一致');
    }
    if (STATUS_VALUES.indexOf(manifest.status) === -1) {
        throw new Error('Initiative status 不受支持');
    }
    if (HEALTH_VALUES.indexOf(manifest.health) === -1) {
        throw new Error('Initiative health 不受支持');
    }
    var artifactValues = manifest.artifacts === undefined ? [] : manifest.artifacts;
    if (!Array.isArray(artifactValues) || artifactValues.length > 256) {
        throw new Error('artifacts 必须是最多 256 项的数组');
    }
    var artifacts = [];
    for (var artifactIndex = 0; artifactIndex < artifactValues.length; artifactIndex += 1) {
        artifacts.push(await validateArtifact(context.openspecRealRoot, artifactValues[artifactIndex]));
    }
    if (artifacts.reduce(function (total, artifact) { return total + artifact.size; }, 0) > MAX_TOTAL_ARTIFACT_BYTES) {
        throw new Error('Initiative 成果总量超过 8 MiB 发现限制');
    }
    artifacts.sort(function (left, right) { return left.id.localeCompare(right.id); });
    for (var index = 1; index < artifacts.length; index += 1) {
        if (artifacts[index - 1].id === artifacts[index].id) {
            throw new Error('成果 ID 重复：' + artifacts[index].id);
        }
    }
    var sourceHash = contract.sha256(contract.stableJson({
        manifest: content,
        artifacts: artifacts.map(function (artifact) {
            return { path: artifact.relativePath, size: artifact.size, contentHash: artifact.contentHash };
        })
    }));
    return {
        manifestPath: manifestPath,
        manifest: manifest,
        content: content,
        changeRefs: validateChangeRefs(manifest.changes),
        artifacts: artifacts,
        sourceHash: sourceHash
    };
}

async function listInitiativeDirectories(context) {
    var root = path.join(context.openspecRoot, 'initiatives');
    var entries;
    try {
        entries = await fsPromises.readdir(root, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
    return entries.filter(function (entry) {
        return entry.isDirectory() && !entry.isSymbolicLink();
    }).map(function (entry) {
        return path.join(root, entry.name);
    }).sort();
}

function descriptorFromValidated(validated) {
    return {
        schemaVersion: contract.DESCRIPTOR_SCHEMA_VERSION,
        id: validated.manifest.id,
        providerId: PROVIDER_ID,
        collection: 'initiatives',
        type: 'generic-initiative',
        title: validated.manifest.title,
        summary: validated.manifest.summary || '',
        goal: validated.manifest.goal || '',
        status: validated.manifest.status,
        health: validated.manifest.health,
        changeRefs: validated.changeRefs,
        presentation: { mode: 'generic' },
        artifacts: validated.artifacts.map(function (artifact) {
            return { id: artifact.id, title: artifact.title, mediaType: artifact.mediaType, size: artifact.size };
        }),
        sourceHash: validated.sourceHash,
        diagnostics: []
    };
}

function manifestDiagnostic(directory, error) {
    var candidateId = path.basename(directory);
    var initiativeId = contract.IDENTIFIER_PATTERN.test(candidateId) ? candidateId : '';
    return contract.diagnostic(
        error.code === 'UNSUPPORTED_YAML' ? 'UNSUPPORTED_YAML' : 'INVALID_GENERIC_INITIATIVE', 'error', '普通 Initiative 清单无效',
        candidateId + '：' + error.message,
        { providerId: PROVIDER_ID, initiativeId: initiativeId, resourceId: toPosix(path.relative(path.dirname(path.dirname(directory)), directory)) }
    );
}

function GenericInitiativeProvider() {
    this.id = PROVIDER_ID;
    this.schemaVersions = [contract.DESCRIPTOR_SCHEMA_VERSION];
}

GenericInitiativeProvider.prototype.discover = async function (context) {
    var directories = await listInitiativeDirectories(context);
    var initiatives = [];
    var diagnostics = [];
    if (directories.length > MAX_INITIATIVES) {
        throw new Error('Initiative 候选目录超过 ' + MAX_INITIATIVES + ' 项');
    }
    for (var index = 0; index < directories.length; index += 1) {
        try {
            initiatives.push(descriptorFromValidated(await readValidatedManifest(context, directories[index])));
        } catch (error) {
            diagnostics.push(manifestDiagnostic(directories[index], error));
        }
    }
    return {
        initiatives: initiatives,
        diagnostics: diagnostics,
        authoritative: diagnostics.length === 0,
        invalidInitiativeIds: diagnostics.map(function (item) { return item.initiativeId; }).filter(Boolean)
    };
};

GenericInitiativeProvider.prototype.fingerprint = async function (context) {
    var directories = await listInitiativeDirectories(context);
    if (directories.length > MAX_INITIATIVES) { throw new Error('Initiative 候选目录超过限制'); }
    var entries = [];
    for (var index = 0; index < directories.length; index += 1) {
        var manifestPath = await resolveManifestPath(directories[index]);
        try {
            var stat = await fsPromises.lstat(manifestPath);
            if (stat.isSymbolicLink() || stat.size > MAX_MANIFEST_BYTES) {
                entries.push({ name: path.basename(directories[index]), size: stat.size, symbolicLink: stat.isSymbolicLink() });
            } else {
                try {
                    var validated = await readValidatedManifest(context, directories[index]);
                    entries.push({ name: path.basename(directories[index]), sourceHash: validated.sourceHash });
                } catch (validationError) {
                    entries.push({
                        name: path.basename(directories[index]),
                        manifestHash: contract.sha256((await readRegularFile(context.openspecRealRoot, manifestPath, MAX_MANIFEST_BYTES, 'Initiative 清单')).content),
                        validationError: validationError.message
                    });
                }
            }
        } catch (error) {
            entries.push({ name: path.basename(directories[index]), error: error.code || error.message });
        }
    }
    return contract.sha256(contract.stableJson(entries));
};

GenericInitiativeProvider.prototype.load = async function (context, descriptor) {
    contract.normalizeIdentifier(descriptor.id, 'Initiative ID');
    var directory = path.join(context.openspecRoot, 'initiatives', descriptor.id);
    var validated = await readValidatedManifest(context, directory);
    if (validated.sourceHash !== descriptor.sourceHash) {
        var stale = new Error('Initiative 权威输入已变化，请刷新工作区');
        stale.code = 'STALE_INITIATIVE';
        throw stale;
    }
    return {
        descriptor: contract.normalizeDescriptor(descriptor, PROVIDER_ID),
        sourceHash: validated.sourceHash,
        artifactIndex: validated.artifacts.map(function (artifact) {
            return { id: artifact.id, title: artifact.title, mediaType: artifact.mediaType, size: artifact.size };
        })
    };
};

GenericInitiativeProvider.prototype.readArtifact = async function (context, descriptor, request) {
    contract.normalizeIdentifier(descriptor.id, 'Initiative ID');
    var directory = path.join(context.openspecRoot, 'initiatives', descriptor.id);
    var validated = await readValidatedManifest(context, directory);
    if (request.sourceHash !== descriptor.sourceHash || validated.sourceHash !== descriptor.sourceHash) {
        var stale = new Error('Initiative 成果版本已变化，请刷新工作区');
        stale.code = 'STALE_INITIATIVE';
        throw stale;
    }
    var artifactId = contract.normalizeArtifactId(request.artifactId);
    var artifact = validated.artifacts.find(function (item) { return item.id === artifactId; });
    if (!artifact) {
        var missing = new Error('成果不存在或未登记');
        missing.code = 'ARTIFACT_NOT_FOUND';
        throw missing;
    }
    var openedArtifact = await readRegularFile(context.openspecRealRoot, artifact.absolutePath, MAX_ARTIFACT_BYTES, '成果');
    if (openedArtifact.realPath !== artifact.realPath) {
        var forbidden = new Error('成果真实路径校验失败');
        forbidden.code = 'ARTIFACT_FORBIDDEN';
        throw forbidden;
    }
    return {
        id: artifact.id,
        title: artifact.title,
        mediaType: artifact.mediaType,
        size: openedArtifact.stat.size,
        sourceHash: validated.sourceHash,
        content: openedArtifact.content.toString('utf8')
    };
};


return new GenericInitiativeProvider();
}

export class GenericInitiativeProvider {
 constructor(options) { return createGenericInitiativeProvider(options); }
}
