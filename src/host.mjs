import { projectFor, readDocument, snapshot, loadWorkspace } from './workspace.mjs';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { TYPERT } from './remote-contract.mjs';

/**
 * Command-channel output budget. DSH persists `command/done.text` verbatim into the
 * session transcript, so an unbounded payload is written to disk on every execution
 * and re-parsed on every session switch. The Typert UI path stays unbounded because
 * it is not persisted; only the human command is reduced.
 */
export const COMMAND_BUDGET_BYTES = 32 * 1024;

const CLIP_MARK = '…[clipped]';

function bytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function clipText(value, max) {
  return typeof value === 'string' && value.length > max ? `${value.slice(0, max)}${CLIP_MARK}` : value;
}

function slimDocument(document) {
  if (!document || typeof document !== 'object') return document;
  const tasks = document.tasks && typeof document.tasks === 'object' ? document.tasks : {};
  return {
    path: document.path,
    title: document.title,
    kind: document.kind,
    collection: document.collection,
    group: document.group,
    summary: clipText(document.summary, 200),
    tasks: { total: Number(tasks.total) || 0, completed: Number(tasks.completed) || 0 },
    requirementCount: countValue(document.requirements),
    scenarioCount: countValue(document.scenarios),
  };
}

function slimInitiative(initiative) {
  if (!initiative || typeof initiative !== 'object') return initiative;
  return {
    id: initiative.id,
    providerId: initiative.providerId,
    kind: initiative.kind,
    title: initiative.title,
    summary: clipText(initiative.summary, 200),
    sourceHash: initiative.sourceHash,
    presentation: initiative.presentation,
  };
}

function clipDeep(value, max, depth = 0) {
  if (typeof value === 'string') return clipText(value, max);
  if (Array.isArray(value)) return value.slice(0, 200).map(item => clipDeep(item, max, depth + 1));
  if (value && typeof value === 'object' && depth < 12) {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = clipDeep(item, max, depth + 1);
    return out;
  }
  return value;
}

function reduce(data, budget) {
  const note = `Output exceeded ${budget} bytes and was reduced; read a single document with {"action":"document","path":"openspec/..."}.`;
  if (data && typeof data === 'object' && data.snapshot && typeof data.snapshot === 'object') {
    return {
      ...data,
      snapshot: {
        ...data.snapshot,
        documents: Array.isArray(data.snapshot.documents) ? data.snapshot.documents.map(slimDocument) : [],
        initiatives: Array.isArray(data.snapshot.initiatives) ? data.snapshot.initiatives.map(slimInitiative) : [],
      },
      truncated: true,
      note,
    };
  }
  if (data && typeof data === 'object' && Array.isArray(data.documents)) {
    return { ...data, documents: data.documents.map(slimDocument), truncated: true, note };
  }
  if (data && typeof data === 'object' && typeof data.content === 'string') {
    return {
      ...data,
      content: clipText(data.content, Math.max(1024, Math.floor(budget / 4))),
      markdown: clipText(data.markdown, Math.max(1024, Math.floor(budget / 4))),
      contentBytes: Buffer.byteLength(data.content, 'utf8'),
      truncated: true,
      note,
    };
  }
  const clipped = clipDeep(data, Math.max(1024, Math.floor(budget / 8)));
  if (Array.isArray(clipped)) return { items: clipped, truncated: true, note };
  return clipped && typeof clipped === 'object' ? { ...clipped, truncated: true, note } : { value: clipped, truncated: true, note };
}

/** Reduce a payload only until it fits the budget; smaller payloads are returned untouched. */
export function fitToBudget(data, budget = COMMAND_BUDGET_BYTES) {
  if (bytes(data) <= budget) return data;
  let candidate = reduce(data, budget);
  for (let guard = 0; bytes(candidate) > budget && guard < 12; guard += 1) {
    const documents = candidate.snapshot?.documents ?? candidate.documents;
    if (!Array.isArray(documents) || documents.length === 0) break;
    const kept = documents.slice(0, Math.floor(documents.length / 2));
    candidate = candidate.snapshot
      ? { ...candidate, snapshot: { ...candidate.snapshot, documents: kept } }
      : { ...candidate, documents: kept };
  }
  if (bytes(candidate) <= budget) return candidate;
  const project = candidate.snapshot?.project ?? candidate.project ?? null;
  return {
    projectId: candidate.projectId,
    revision: candidate.revision,
    project,
    documentCount: candidate.snapshot?.documents?.length ?? candidate.documents?.length ?? 0,
    truncated: true,
    note: `Output exceeded ${budget} bytes and was reduced to an index; read a single document with {"action":"document","path":"openspec/..."}.`,
  };
}

const REPORT_SECTION_LIMIT = 50;

function oneLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function countValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  return Array.isArray(value) ? value.length : 0;
}

function taskProgress(entity) {
  const tasks = entity && typeof entity.tasks === 'object' && entity.tasks ? entity.tasks : {};
  const total = Number(tasks.total) || 0;
  return total ? `${Number(tasks.completed) || 0}/${total}` : '';
}

function documentPath(entity) {
  const documents = Array.isArray(entity && entity.documents) ? entity.documents : [];
  const hit = documents.find(item => item && typeof item.path === 'string') || documents.find(item => item && typeof item.id === 'string');
  return hit ? hit.path || hit.id : '';
}

function pushSection(lines, title, entries, limit) {
  if (entries.length === 0) return;
  lines.push('', `${title}（${entries.length}）`);
  lines.push(...entries.slice(0, limit));
  if (entries.length > limit) lines.push(`… 其余 ${entries.length - limit} 项未列出`);
}

function renderWorkspaceReport(data) {
  const snapshot = data && typeof data.snapshot === 'object' && data.snapshot ? data.snapshot : {};
  const stats = snapshot.stats && typeof snapshot.stats === 'object' ? snapshot.stats : {};
  const project = snapshot.project && typeof snapshot.project === 'object' ? snapshot.project : {};
  const lines = [
    `OpenSpec · ${oneLine(project.name || project.path || data.projectId) || '当前项目'}`,
    `规格 ${stats.specs ?? 0} · 变更 ${stats.activeChanges ?? 0} · 归档 ${stats.archivedChanges ?? 0} · 任务 ${stats.completedTasks ?? 0}/${stats.totalTasks ?? 0} · 待办 ${stats.pendingTasks ?? 0} · 告警 ${stats.issues ?? 0}`,
  ];
  const changes = (Array.isArray(snapshot.changes) ? snapshot.changes : []).map(change => {
    const progress = taskProgress(change);
    const path = documentPath(change);
    return `- ${change.id}${progress ? `  ${progress}` : ''}  ${oneLine(change.title)}${path ? `\n  ${path}` : ''}`;
  });
  pushSection(lines, '进行中的变更', changes, REPORT_SECTION_LIMIT);
  const specs = (Array.isArray(snapshot.specs) ? snapshot.specs : []).map(spec => {
    const requirements = countValue(spec.requirements);
    const scenarios = countValue(spec.scenarios);
    const path = documentPath(spec);
    return `- ${spec.id}  ${requirements} 需求 / ${scenarios} 场景${path ? `  ${path}` : ''}`;
  });
  pushSection(lines, '规格', specs, REPORT_SECTION_LIMIT);
  const archives = (Array.isArray(snapshot.archives) ? snapshot.archives : []).map(item => `- ${item.id}  ${oneLine(item.title)}`);
  pushSection(lines, '已归档变更', archives, 8);
  const tasks = (Array.isArray(snapshot.taskQueue) ? snapshot.taskQueue : []).map(task => `- [${task.changeId}] ${task.id} ${oneLine(task.text)}`);
  pushSection(lines, '待办任务', tasks, 10);
  const warnings = Array.isArray(snapshot.warnings) ? snapshot.warnings : [];
  if (warnings.length) pushSection(lines, '告警', warnings.map(item => `- ${oneLine(item)}`), 5);
  lines.push('', '查看单篇全文：/openspec-view {"action":"document","path":"openspec/..."}');
  return lines.join('\n');
}

function renderSnapshotReport(data) {
  const project = data && typeof data.project === 'object' && data.project ? data.project : {};
  const documents = Array.isArray(data.documents) ? data.documents : [];
  const lines = [`OpenSpec · ${oneLine(project.title || project.path) || '当前项目'} — ${documents.length} 篇文档`];
  pushSection(lines, '文档', documents.map(document => {
    const progress = taskProgress(document);
    return `- ${document.path}${progress ? `  ${progress}` : ''}`;
  }), REPORT_SECTION_LIMIT);
  const warnings = Array.isArray(data.warnings) ? data.warnings : [];
  if (warnings.length) pushSection(lines, '告警', warnings.map(item => `- ${oneLine(item)}`), 5);
  lines.push('', '查看单篇全文：/openspec-view {"action":"document","path":"openspec/..."}');
  return lines.join('\n');
}

function renderDocumentReport(data, budget) {
  const header = [oneLine(data.path || data.id), oneLine(data.title) ? `# ${oneLine(data.title)}` : ''].filter(Boolean).join('\n');
  const content = typeof data.content === 'string' ? data.content : (typeof data.markdown === 'string' ? data.markdown : '');
  const room = Math.max(512, budget - header.length - 120);
  const clipped = content.length > room ? `${content.slice(0, room)}\n…（已截断：原文 ${content.length} 字符）` : content;
  return `${header}\n\n${clipped}`;
}

function trimToBudget(text, budget) {
  if (Buffer.byteLength(text, 'utf8') <= budget) return text;
  const kept = [];
  let used = 0;
  for (const line of text.split('\n')) {
    const cost = Buffer.byteLength(line, 'utf8') + 1;
    if (used + cost > budget - 96) break;
    kept.push(line);
    used += cost;
  }
  kept.push('…（输出已截断至命令预算内，用 {"action":"document","path":"openspec/..."} 查看全文）');
  return kept.join('\n');
}

/** Human-facing command text: readable lines, never a single collapsed JSON blob. */
export function commandText(data, action, budget) {
  if (action === 'workspace') return trimToBudget(renderWorkspaceReport(data), budget);
  if (action === 'snapshot') return trimToBudget(renderSnapshotReport(data), budget);
  if (action === 'document') return trimToBudget(renderDocumentReport(data, budget), budget);
  return JSON.stringify(fitToBudget(data, budget));
}

export class OpenSpecRemote extends TypertRemoteService {
  constructor(ctx) { super(ctx, 'openspec'); }
  async read(agent, requestJson, signal) {
    const result = await executeRead(this.ctx, { agent, rawInput: requestJson, signal });
    if (result.kind !== 'success') throw new Error(result.text);
    return result.text;
  }
}

export const inject = ['fs', 'commands', 'workspaceRegistry', 'workingDirectory', 'typert'];

export function apply(ctx) {
  ctx.effect(() => ctx.typert.register(TYPERT));
  ctx.plugin(OpenSpecRemote);
  ctx.effect(() => ctx.commands.register({
    name: 'openspec-view',
    description: '只读查看当前会话项目的 OpenSpec 规范与变更',
    input: { hint: '{"action":"workspace"}、{"action":"snapshot"} 或 {"action":"document","path":"openspec/project.md"}' },
    recordInput: false,
    handler: invocation => executeRead(ctx, invocation, { report: true, budget: COMMAND_BUDGET_BYTES }),
  }));
}

export async function executeRead(ctx, invocation, options = {}) {
      try {
        const input = JSON.parse(invocation.rawInput);
        if (!input || Array.isArray(input) || typeof input !== 'object' || !['snapshot', 'document', 'workspace', 'initiative', 'artifact', 'app'].includes(input.action)) throw new Error('Expected a supported OpenSpec JSON action');
        const providerAction = ['initiative', 'artifact', 'app'].includes(input.action);
        const allowed = providerAction ? ['action', 'providerId', 'initiativeId', 'revision', ...(input.action === 'artifact' ? ['artifactId', 'sourceHash'] : input.action === 'app' ? ['sourceHash'] : [])] : ['action', ...(input.action === 'document' ? ['path'] : [])];
        if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error('Unexpected action parameter');
        if (providerAction && (typeof input.providerId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(input.providerId) || typeof input.initiativeId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(input.initiativeId) || input.revision !== 0)) throw new Error('Invalid or stale initiative request');
        if (input.action === 'app' && !/^[a-f0-9]{64}$/.test(typeof input.sourceHash === 'string' ? input.sourceHash : '')) throw new Error('Invalid app source hash');
        if (input.action === 'artifact' && (typeof input.artifactId !== 'string' || typeof input.sourceHash !== 'string')) throw new Error('Invalid artifact request');
        invocation.signal?.throwIfAborted();
        const project = projectFor(ctx, invocation.agent);
        const fs = invocation.agent.ctx?.get?.('fs') || ctx.fs;
        if (!fs) throw new Error('Session filesystem is unavailable');
        const data = input.action === 'workspace' || providerAction
          ? await loadWorkspace(fs, project, invocation.signal, 0, providerAction ? input : undefined)
          : input.action === 'snapshot'
            ? await snapshot(fs, project, invocation.signal)
            : await readDocument(fs, project, input.path, invocation.signal);
        if (options.report) return { kind: 'success', text: commandText(data, input.action, options.budget ?? COMMAND_BUDGET_BYTES) };
        const payload = options.budget ? fitToBudget(data, options.budget) : data;
        return { kind: 'success', text: JSON.stringify(payload) };
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) };
      }
}
