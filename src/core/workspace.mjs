// Ported from OpenSpecGUI/src/core/workspace.js; SHA-256 b590b49756c496948f32cdf1766619397e436e3529bbe5e26d63b108a2f2a772.
// Original algorithms retained; DSH adapter supplies all filesystem capabilities.
'use strict';

export function createWorkspaceModule({ fsPromises, path, initiativeContract, createDefaultInitiativeRegistry, markdown }) {
var fs = { constants: { R_OK: 0 } };
var openspecCli = { readOfficialStatuses: async () => ({ source: 'inferred', diagnostic: 'OpenSpec CLI is unavailable in the read-only DSH adapter; status inferred from original task parser.', items: new Map() }) };

function toPosix(value) {
    return value.split(path.sep).join('/');
}

function titleFromId(value) {
    return String(value || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, function (letter) {
        return letter.toUpperCase();
    });
}

function isWithin(rootPath, targetPath) {
    var relative = path.relative(rootPath, targetPath);
    return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

async function pathExists(targetPath) {
    try {
        await fsPromises.access(targetPath, fs.constants.R_OK);
        return true;
    } catch (error) {
        return false;
    }
}

async function walkMarkdownFiles(directory) {
    var entries;
    var files = [];

    if (!await pathExists(directory)) {
        return files;
    }

    entries = await fsPromises.readdir(directory, { withFileTypes: true });
    entries.sort(function (left, right) {
        return left.name.localeCompare(right.name);
    });

    for (var index = 0; index < entries.length; index += 1) {
        var entry = entries[index];
        var entryPath = path.join(directory, entry.name);

        if (entry.isSymbolicLink()) {
            continue;
        }
        if (entry.isDirectory()) {
            files = files.concat(await walkMarkdownFiles(entryPath));
        } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
            files.push(entryPath);
        }
    }

    return files;
}

function documentKind(filePath, collection) {
    var baseName = path.basename(filePath).toLowerCase();

    if (baseName === 'proposal.md') {
        return 'proposal';
    }
    if (baseName === 'design.md') {
        return 'design';
    }
    if (baseName === 'tasks.md') {
        return 'tasks';
    }
    if (baseName === 'spec.md') {
        return collection === 'spec' ? 'spec' : 'delta-spec';
    }
    return 'document';
}

async function loadDocument(filePath, context) {
    var relativePath = toPosix(path.relative(context.projectRoot, filePath));
    var realPath = await fsPromises.realpath(filePath);
    var content;
    var stat;
    var parsed;
    var metadata;

    if (!isWithin(context.openspecRealRoot, realPath)) {
        throw new Error('文件超出 openspec 目录：' + relativePath);
    }

    content = await fsPromises.readFile(realPath, 'utf8');
    stat = await fsPromises.stat(realPath);
    parsed = markdown.parseMarkdown(content);
    metadata = {
        id: relativePath,
        path: relativePath,
        kind: documentKind(filePath, context.collection),
        title: parsed.title || path.basename(filePath),
        summary: parsed.summary,
        modifiedAt: stat.mtime.toISOString(),
        headings: parsed.headings,
        requirements: parsed.requirements,
        scenarios: parsed.scenarios,
        tasks: parsed.tasks,
        warnings: parsed.warnings,
        searchText: parsed.searchText
    };

    context.documents.set(relativePath, {
        absolutePath: filePath,
        scannedRealPath: realPath,
        metadata: metadata
    });

    return metadata;
}

function documentSort(left, right) {
    var order = { proposal: 0, design: 1, tasks: 2, 'delta-spec': 3, spec: 0, document: 4 };
    var difference = (order[left.kind] || 0) - (order[right.kind] || 0);
    return difference || left.path.localeCompare(right.path);
}

function combineWarnings(documents, ownWarnings) {
    var warnings = ownWarnings.slice();
    documents.forEach(function (document) {
        document.warnings.forEach(function (warning) {
            warnings.push(document.path + '：' + warning);
        });
    });
    return warnings;
}

async function buildChange(directory, collection, context, officialStatuses) {
    var changeId = path.basename(directory);
    var referenceId = collection === 'archive' ? changeId.replace(/^\d{4}-\d{2}-\d{2}-/, '') : changeId;
    var files = await walkMarkdownFiles(directory);
    var documents = [];
    var warnings = [];
    var proposal;
    var proposalHeading;
    var tasksDocument;
    var modifiedAt = new Date(0).toISOString();

    for (var index = 0; index < files.length; index += 1) {
        try {
            documents.push(await loadDocument(files[index], Object.assign({}, context, { collection: collection })));
        } catch (error) {
            warnings.push(toPosix(path.relative(context.projectRoot, files[index])) + '：' + error.message);
        }
    }

    documents.sort(documentSort);
    proposal = documents.find(function (document) { return document.kind === 'proposal'; });
    proposalHeading = proposal ? proposal.headings.find(function (heading) { return heading.level === 1; }) : null;
    tasksDocument = documents.find(function (document) { return document.kind === 'tasks'; });
    if (!proposal) {
        warnings.push('缺少 proposal.md');
    }
    if (!tasksDocument) {
        warnings.push('缺少 tasks.md');
    }
    documents.forEach(function (document) {
        if (document.modifiedAt > modifiedAt) {
            modifiedAt = document.modifiedAt;
        }
    });

    var inferredTasks = tasksDocument ? tasksDocument.tasks : { completed: 0, total: 0, percent: 0, items: [], groups: [] };
    var official = collection === 'active' ? officialStatuses.items.get(changeId) : null;
    var taskState = official ? {
        completed: Number(official.completedTasks) || 0,
        total: Number(official.totalTasks) || 0,
        percent: Number(official.totalTasks) ? Math.round(Number(official.completedTasks) / Number(official.totalTasks) * 100) : 0,
        items: inferredTasks.items,
        groups: inferredTasks.groups
    } : inferredTasks;
    var status = official && official.status ? official.status : (taskState.total === 0 ? 'no-tasks' : (taskState.completed === taskState.total ? 'complete' : 'in-progress'));
    var allWarnings = combineWarnings(documents, warnings);
    var nextTask = taskState.items.find(function (item) { return !item.completed; }) || null;
    var remainingTasks = Math.max(0, taskState.total - taskState.completed);
    var controlState = allWarnings.length || taskState.total === 0 ? 'attention' : (status === 'complete' ? 'ready-to-archive' : 'in-progress');
    var nextAction = controlState === 'ready-to-archive' ? '执行 OpenSpec 归档流程' : (controlState === 'attention' ? (allWarnings[0] || '补充可识别的任务清单') : (nextTask ? nextTask.id + ' ' + nextTask.text : '核对任务文件与官方状态'));

    return {
        id: changeId,
        referenceId: referenceId,
        type: collection,
        title: proposalHeading ? proposalHeading.text.replace(/^Proposal:\s*/i, '') : titleFromId(changeId),
        summary: proposal ? proposal.summary : '',
        modifiedAt: official && official.lastModified ? official.lastModified : modifiedAt,
        documents: documents.map(stripDocumentSearchText),
        tasks: taskState,
        remainingTasks: remainingTasks,
        nextTask: nextTask,
        nextAction: nextAction,
        controlState: controlState,
        status: status,
        statusSource: official ? 'cli' : 'inferred',
        warnings: allWarnings,
        hasIssues: allWarnings.length > 0,
        searchText: documents.map(function (document) { return document.searchText; }).join(' ').slice(0, 220000)
    };
}

async function buildSpec(filePath, context) {
    var document = await loadDocument(filePath, Object.assign({}, context, { collection: 'spec' }));
    var specsRoot = path.join(context.openspecRoot, 'specs');
    var capabilityId = toPosix(path.relative(specsRoot, path.dirname(filePath)));

    return {
        id: capabilityId,
        type: 'spec',
        title: document.title.replace(/\s+Specification$/i, '') || titleFromId(capabilityId),
        summary: document.summary,
        modifiedAt: document.modifiedAt,
        documents: [stripDocumentSearchText(document)],
        requirements: document.requirements.length,
        scenarios: document.scenarios.length,
        warnings: document.warnings.map(function (warning) { return document.path + '：' + warning; }),
        hasIssues: document.warnings.length > 0,
        searchText: document.searchText
    };
}

function stripDocumentSearchText(document) {
    var copy = Object.assign({}, document);
    delete copy.searchText;
    return copy;
}

async function listChildDirectories(directory) {
    var entries;

    if (!await pathExists(directory)) {
        return [];
    }
    entries = await fsPromises.readdir(directory, { withFileTypes: true });
    return entries
        .filter(function (entry) { return entry.isDirectory() && !entry.isSymbolicLink(); })
        .map(function (entry) { return path.join(directory, entry.name); })
        .sort();
}

function sortByModifiedDescending(left, right) {
    return String(right.modifiedAt).localeCompare(String(left.modifiedAt));
}

function createSearchIndex(collections, documents) {
    var entries = [];

    ['changes', 'specs', 'archives'].forEach(function (collectionName) {
        collections[collectionName].forEach(function (entity) {
            entity.documents.forEach(function (document) {
                var registered = documents.get(document.id);
                entries.push({
                    entityType: entity.type,
                    entityId: entity.id,
                    entityTitle: entity.title,
                    documentId: document.id,
                    documentKind: document.kind,
                    documentTitle: document.title,
                    path: document.path,
                    status: entity.status || 'formal',
                    controlState: entity.controlState || 'formal',
                    hasIssues: entity.hasIssues,
                    text: registered ? registered.metadata.searchText : ''
                });
            });
        });
    });

    return entries;
}

/**
 * 解析并验证目标项目根目录。
 * @param {string} requestedRoot 用户输入的项目根目录
 * @returns {Promise<object>} 项目根与 OpenSpec 根
 */
async function resolveProjectRoot(requestedRoot) {
    var requestedProjectRoot = path.resolve(requestedRoot || process.cwd());
    var projectRoot;
    var openspecRoot;
    var projectStat;
    var openspecStat;

    try {
        projectStat = await fsPromises.stat(requestedProjectRoot);
    } catch (error) {
        throw new Error('项目根目录不存在或不可读取：' + requestedProjectRoot);
    }
    if (!projectStat.isDirectory()) {
        throw new Error('项目根路径不是目录：' + requestedProjectRoot);
    }
    projectRoot = await fsPromises.realpath(requestedProjectRoot);
    openspecRoot = path.join(projectRoot, 'openspec');
    try {
        openspecStat = await fsPromises.stat(openspecRoot);
    } catch (error) {
        throw new Error('目标项目缺少可读取的 openspec/ 目录：' + projectRoot);
    }
    if (!openspecStat.isDirectory()) {
        throw new Error('openspec 路径不是目录：' + openspecRoot);
    }

    return {
        projectRoot: projectRoot,
        openspecRoot: openspecRoot,
        openspecRealRoot: await fsPromises.realpath(openspecRoot)
    };
}

/**
 * 将已注册项目上下文解析为受验证的工作区根目录。
 * @param {object} projectContext 项目注册信息
 * @returns {Promise<object>} 项目标识、展示名与工作区根目录
 */
async function resolveProjectContext(projectContext) {
    if (!projectContext || typeof projectContext !== 'object' || typeof projectContext.rootPath !== 'string') {
        throw new Error('必须提供有效的项目上下文');
    }

    var roots = await resolveProjectRoot(projectContext.rootPath);
    if (projectContext.openspecPath) {
        var registeredOpenSpecPath = await fsPromises.realpath(projectContext.openspecPath);
        if (registeredOpenSpecPath !== roots.openspecRealRoot) {
            throw new Error('注册的 openspec 路径与项目不一致，请重新关联项目');
        }
    }

    return Object.assign({}, roots, {
        projectId: typeof projectContext.id === 'string' ? projectContext.id : '',
        projectName: path.basename(roots.projectRoot)
    });
}

/**
 * 扫描项目并创建可序列化的工作区快照与文档白名单。
 * @param {object} projectContext 已注册项目上下文
 * @param {object} [options] 状态提供器等选项
 * @returns {Promise<object>} 工作区状态
 */
async function buildWorkspace(projectContext, options) {
    var roots = await resolveProjectContext(projectContext);
    var settings = options || {};
    var generatedAt = settings.now ? new Date(settings.now) : new Date();
    if (Number.isNaN(generatedAt.getTime())) {
        throw new Error('工作区快照时间无效');
    }
    var statusProvider = settings.statusProvider || openspecCli.readOfficialStatuses;
    var officialStatuses = await statusProvider(roots.projectRoot, settings.cliOptions);
    var documents = new Map();
    var context = Object.assign({ documents: documents }, roots);
    var changesRoot = path.join(roots.openspecRoot, 'changes');
    var archiveRoot = path.join(changesRoot, 'archive');
    var activeDirectories = (await listChildDirectories(changesRoot)).filter(function (directory) {
        return path.basename(directory) !== 'archive';
    });
    var archiveDirectories = await listChildDirectories(archiveRoot);
    var specFiles = (await walkMarkdownFiles(path.join(roots.openspecRoot, 'specs'))).filter(function (filePath) {
        return path.basename(filePath).toLowerCase() === 'spec.md';
    });
    var changes = [];
    var archives = [];
    var specs = [];
    var initiativeRegistry = settings.initiativeRegistry || createDefaultInitiativeRegistry();

    for (var changeIndex = 0; changeIndex < activeDirectories.length; changeIndex += 1) {
        changes.push(await buildChange(activeDirectories[changeIndex], 'active', context, officialStatuses));
    }
    for (var archiveIndex = 0; archiveIndex < archiveDirectories.length; archiveIndex += 1) {
        archives.push(await buildChange(archiveDirectories[archiveIndex], 'archive', context, officialStatuses));
    }
    for (var specIndex = 0; specIndex < specFiles.length; specIndex += 1) {
        try {
            specs.push(await buildSpec(specFiles[specIndex], context));
        } catch (error) {
            specs.push({
                id: toPosix(path.relative(path.join(roots.openspecRoot, 'specs'), path.dirname(specFiles[specIndex]))),
                type: 'spec',
                title: path.basename(path.dirname(specFiles[specIndex])),
                summary: '',
                modifiedAt: new Date(0).toISOString(),
                documents: [],
                requirements: 0,
                scenarios: 0,
                warnings: [error.message],
                hasIssues: true,
                searchText: ''
            });
        }
    }

    changes.sort(sortByModifiedDescending);
    archives.sort(sortByModifiedDescending);
    specs.sort(function (left, right) { return left.id.localeCompare(right.id); });

    var initiativeDiscovery = await initiativeRegistry.discover(roots);
    var initiatives = initiativeDiscovery.initiatives;
    var changeRelations = initiativeContract.createRelationshipIndex(changes.concat(archives), initiatives);
    var initiativeDiagnostics = initiativeDiscovery.diagnostics.concat(changeRelations.diagnostics);
    var providerFingerprint = initiativeContract.sha256(initiativeContract.stableJson(initiativeDiscovery.fingerprints));

    var collections = { changes: changes, specs: specs, archives: archives };
    var totalTasks = changes.reduce(function (total, change) { return total + change.tasks.total; }, 0);
    var completedTasks = changes.reduce(function (total, change) { return total + change.tasks.completed; }, 0);
    var taskQueue = [];
    changes.forEach(function (change) {
        change.tasks.items.forEach(function (task) {
            if (!task.completed) {
                taskQueue.push({
                    id: task.id,
                    text: task.text,
                    groupId: task.groupId,
                    groupTitle: task.groupTitle,
                    changeId: change.id,
                    changeTitle: change.title,
                    entityType: change.type,
                    modifiedAt: change.modifiedAt
                });
            }
        });
    });
    var snapshot = {
        project: {
            id: roots.projectId,
            name: roots.projectName
        },
        generatedAt: generatedAt.toISOString(),
        lifecycle: {
            source: officialStatuses.source,
            diagnostic: officialStatuses.diagnostic || null
        },
        stats: {
            specs: specs.length,
            activeChanges: changes.length,
            archivedChanges: archives.length,
            completedTasks: completedTasks,
            totalTasks: totalTasks,
            pendingTasks: Math.max(0, totalTasks - completedTasks),
            readyToArchive: changes.filter(function (change) { return change.controlState === 'ready-to-archive'; }).length,
            attentionChanges: changes.filter(function (change) { return change.controlState === 'attention'; }).length,
            inProgressChanges: changes.filter(function (change) { return change.controlState === 'in-progress'; }).length,
            issues: changes.filter(function (change) { return change.hasIssues; }).length + specs.filter(function (spec) { return spec.hasIssues; }).length,
            initiatives: initiatives.length,
            initiativeIssues: initiativeDiagnostics.filter(function (item) { return item.severity === 'error'; }).length
        },
        changes: changes,
        specs: specs,
        archives: archives,
        initiatives: initiatives,
        initiativeDiagnostics: initiativeDiagnostics,
        changeRelations: changeRelations,
        taskQueue: taskQueue,
        recent: changes.concat(archives).sort(sortByModifiedDescending).slice(0, 8).map(function (entity) {
            return { id: entity.id, type: entity.type, title: entity.title, modifiedAt: entity.modifiedAt };
        }),
        searchIndex: createSearchIndex(collections, documents)
    };

    return {
        roots: roots,
        snapshot: snapshot,
        documents: documents,
        initiativeRegistry: initiativeRegistry,
        providerFingerprint: providerFingerprint
    };
}

/**
 * 从白名单读取最新文档，并再次验证真实路径范围。
 * @param {object} workspace 工作区状态
 * @param {string} documentId 文档稳定 ID
 * @returns {Promise<object>} 文档正文与元数据
 */
async function readWorkspaceDocument(workspace, documentId) {
    var registered = workspace.documents.get(documentId);
    var realPath;
    var content;
    var parsed;
    var stat;

    if (!registered) {
        var notFound = new Error('文档不存在或未登记');
        notFound.code = 'DOCUMENT_NOT_FOUND';
        throw notFound;
    }

    try {
        realPath = await fsPromises.realpath(registered.absolutePath);
    } catch (error) {
        var deleted = new Error('文档已删除或不可读取');
        deleted.code = 'DOCUMENT_NOT_FOUND';
        throw deleted;
    }
    if (!isWithin(workspace.roots.openspecRealRoot, realPath)) {
        var forbidden = new Error('拒绝读取 openspec 目录之外的路径');
        forbidden.code = 'PATH_FORBIDDEN';
        throw forbidden;
    }

    content = await fsPromises.readFile(realPath, 'utf8');
    stat = await fsPromises.stat(realPath);
    parsed = markdown.parseMarkdown(content);
    return {
        id: documentId,
        path: documentId,
        kind: registered.metadata.kind,
        title: parsed.title || registered.metadata.title,
        modifiedAt: stat.mtime.toISOString(),
        headings: parsed.headings,
        warnings: parsed.warnings,
        markdown: content
    };
}

return {
    buildWorkspace: buildWorkspace,
    isWithin: isWithin,
    readWorkspaceDocument: readWorkspaceDocument,
    resolveProjectContext: resolveProjectContext,
    resolveProjectRoot: resolveProjectRoot
};

}
