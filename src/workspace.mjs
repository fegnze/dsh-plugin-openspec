import * as YAML from 'yaml';
import markdown from './core/markdown.mjs';
import { createWorkspaceModule } from './core/workspace.mjs';
import * as initiativeContract from './core/initiative-contract.mjs';
import { createDefaultInitiativeRegistry } from './core/initiative-providers.mjs';
import { manifestFilesystem, virtualPath, virtualRoot } from './core/session-fs.mjs';

/** Read-only OpenSpec projection over the inspected DSH filesystem seam. */
export const LIMITS = Object.freeze({ documents: 500, documentBytes: 512 * 1024, depth: 12, totalBytes: 8 * 1024 * 1024 });

const missing = error => ['ENOENT', 'FS_NOT_FOUND'].includes(error?.code);
const message = error => error instanceof Error ? error.message : String(error);
const basename = path => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;

export function projectFor(ctx, agent) {
  if (!agent?.session) throw new Error('OpenSpec requires a receiving Agent session');
  const workspace = ctx.workspaceRegistry.list().find(item => item.sessionIds.includes(agent.id));
  const path = workspace?.path || agent.session.header?.cwd || ctx.workingDirectory.get(agent.session);
  if (typeof path !== 'string' || !path || !(/^(?:\/|[A-Za-z]:[\\/])/.test(path))) throw new Error('Project directory must be absolute');
  return { path, title: workspace?.title || basename(path), ...(workspace ? { workspaceId: workspace.id } : {}) };
}

export function documentPath(value) {
  if (typeof value !== 'string' || value.includes('\\') || /[\x00-\x1f\x7f:%?#]/.test(value)) throw new Error('Invalid OpenSpec document path');
  const parts = value.split('/');
  if (parts[0] !== 'openspec' || parts.length < 2 || parts.length - 1 > LIMITS.depth || parts.some(part => !part || part === '.' || part === '..') || !/\.md$/i.test(value)) throw new Error('Only relative openspec Markdown paths are allowed');
  return value;
}

function classify(path) {
  const parts = path.split('/').slice(1);
  let collection = 'project', group = 'project';
  if (parts[0] === 'specs' && parts.length > 1) { collection = 'specs'; group = parts.length > 2 ? parts[1] : 'specs'; }
  if (parts[0] === 'changes' && parts.length > 1) {
    collection = parts[1] === 'archive' ? 'archive' : 'changes';
    group = parts[collection === 'archive' ? 2 : 1] || collection;
  } else if (parts[0] === 'archive' && parts.length > 1) { collection = 'archive'; group = parts[1]; }
  return { collection, group, kind: parts.at(-1).replace(/\.md$/i, '') };
}

/** Legacy projection shape, backed by the original OpenSpecGUI Markdown parser. */
export function metadata(path, content) {
  const parsed = markdown.parseMarkdown(content);
  return { path, title: parsed.title || basename(path).replace(/\.md$/i, ''), summary: parsed.summary, ...classify(path), tasks: { total: parsed.tasks.total, completed: parsed.tasks.completed, items: parsed.tasks.items.map(({ text, completed, line }) => ({ text, completed, line })) }, requirements: parsed.requirements, scenarios: parsed.scenarios };
}

async function roots(fs, project, signal) {
  const base = await fs.resolve(project.path, { signal });
  if ((await fs.stat(base, signal))?.type !== 'directory') throw new Error('Project directory is unavailable');
  const root = await fs.resolve('openspec', { cwd: project.path, signal });
  if (!fs.contains(base, root)) throw new Error('OpenSpec root escapes the project');
  const info = await fs.stat(root, signal);
  if (info && info.type !== 'directory') throw new Error('OpenSpec root is not a directory');
  return { base, root, exists: Boolean(info) };
}

async function checked(fs, project, base, root, path, signal) {
  documentPath(path);
  const target = await fs.resolve(path, { cwd: project.path, signal });
  if (!fs.contains(base, target) || !fs.contains(root, target)) throw new Error('Document escapes the OpenSpec root');
  const info = await fs.stat(target, signal);
  if (info?.type !== 'file') throw new Error('OpenSpec document is unavailable or not a regular file');
  if (info.size > LIMITS.documentBytes) throw new Error('Document exceeds 512 KiB limit');
  return target;
}

async function text(fs, target, signal, budget = LIMITS.documentBytes) {
  const cap = Math.min(budget, LIMITS.documentBytes);
  const limitError = () => new Error(budget < LIMITS.documentBytes ? 'Total content limit 8 MiB reached' : 'Document exceeds 512 KiB limit');
  let bytes;
  try { bytes = await fs.readBytes(target, signal, cap); } catch (error) {
    if (error?.code === 'FS_TOO_LARGE') throw limitError();
    throw error;
  }
  if (bytes.byteLength > cap) throw limitError();
  const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (content.includes('\0')) throw new Error('Document is not UTF-8 text');
  return { content, bytes: bytes.byteLength };
}

export async function readDocument(fs, project, path, signal) {
  documentPath(path);
  const { base, root, exists } = await roots(fs, project, signal);
  if (!exists) throw new Error('OpenSpec directory does not exist');
  const target = await checked(fs, project, base, root, path, signal);
  const content = (await text(fs, target, signal)).content;
  const kind = /\/spec\.md$/i.test(path) ? (path.startsWith('openspec/specs/') ? 'spec' : 'delta-spec') : /\/(proposal|design|tasks)\.md$/i.exec(path)?.[1].toLowerCase() || 'document';
  const absolutePath = `${virtualRoot}/${path}`;
  const fsPromises = manifestFilesystem(new Map([[absolutePath, content]]), new Set(), signal);
  const original = createWorkspaceModule({ fsPromises, path: virtualPath, initiativeContract, createDefaultInitiativeRegistry, markdown });
  const document = await original.readWorkspaceDocument({ roots: { openspecRealRoot: `${virtualRoot}/openspec` }, documents: new Map([[path, { absolutePath, metadata: { kind, title: basename(path) } }]]) }, path);
  return { ...document, content };
}

export async function snapshot(fs, project, signal, manifest) {
  const result = { project, exists: false, documents: [], warnings: [] };
  let resolved;
  try { resolved = await roots(fs, project, signal); } catch (error) {
    if (missing(error)) return result;
    throw error;
  }
  const { base, root, exists } = resolved;
  result.exists = exists;
  if (!exists) return result;
  let bytes = 0, candidates = 0, entriesSeen = 0, stopped = false;
  const visited = new Set();
  const warn = value => { if (!result.warnings.includes(value)) result.warnings.push(value); };
  async function walk(target, relative, depth) {
    signal?.throwIfAborted();
    if (!fs.contains(base, target) || !fs.contains(root, target)) { warn(`${relative}: canonical path escapes OpenSpec root`); return; }
    if (visited.has(target.targetKey)) { warn(`${relative}: duplicate or cyclic directory skipped`); return; }
    visited.add(target.targetKey);
    manifest?.directories.add(`${virtualRoot}/${relative}`);
    let entries;
    try { entries = await fs.listDir(target, signal); } catch (error) { if (signal?.aborted) throw error; warn(`${relative}: ${message(error)}`); return; }
    for (const entry of entries) {
      if (stopped) return;
      if (++entriesSeen > 20000) { warn('Directory entry limit 20000 reached; remaining entries skipped'); stopped = true; return; }
      signal?.throwIfAborted();
      const path = `${relative}/${entry.name}`;
      if (entry.name.includes('/') || entry.name.includes('\\') || /[\x00-\x1f\x7f:%?#]/.test(entry.name) || ['.', '..'].includes(entry.name)) { warn(`${relative}: invalid directory entry skipped`); continue; }
      try {
        const child = await fs.resolve(path, { cwd: project.path, signal });
        if (!fs.contains(base, child) || !fs.contains(root, child)) throw new Error('canonical path escapes OpenSpec root');
        const info = await fs.stat(child, signal);
        if (info?.type === 'directory') {
          if (depth >= LIMITS.depth - 1) warn(`${path}: depth limit 12 reached`);
          else await walk(child, path, depth + 1);
        } else if ((/\.md$/i.test(entry.name) || (manifest && /\.(?:txt|json|ya?ml|html|css|js)$/i.test(entry.name))) && info?.type === 'file') {
          if (++candidates > LIMITS.documents) { warn('Document limit 500 reached; remaining documents skipped'); stopped = true; return; }
          const file = /\.md$/i.test(path) ? await checked(fs, project, base, root, path, signal) : child;
          if (info.size > LIMITS.documentBytes) throw new Error('Document exceeds 512 KiB limit');
          if (bytes >= LIMITS.totalBytes || (info.size !== undefined && bytes + info.size > LIMITS.totalBytes)) { warn('Total content limit 8 MiB reached; remaining documents skipped'); stopped = true; return; }
          const read = await text(fs, file, signal, LIMITS.totalBytes - bytes);
          bytes += read.bytes;
          manifest?.files.set(`${virtualRoot}/${path}`, read.content);
          if (/\.md$/i.test(path)) result.documents.push(metadata(path, read.content));
        }
      } catch (error) { if (signal?.aborted) throw error; warn(`${path}: ${message(error)}`); }
    }
  }
  await walk(root, 'openspec', 0);
  return result;
}

/** Original workbench loadWorkspace payload; rebuild per request, never cache across sessions. */
export async function loadWorkspace(fs, project, signal, revision = 0, operation) {
  const manifest = { files: new Map(), directories: new Set([virtualRoot]) };
  const scan = await snapshot(fs, project, signal, manifest);
  const projectId = project.workspaceId || project.path;
  if (!scan.exists) {
    if (operation) throw new Error('OpenSpec directory does not exist');
    return { projectId, revision, snapshot: null, warnings: scan.warnings };
  }
  const fsPromises = manifestFilesystem(manifest.files, manifest.directories, signal);
  const registry = createDefaultInitiativeRegistry({ fsPromises, path: virtualPath, YAML });
  const original = createWorkspaceModule({ fsPromises, path: virtualPath, initiativeContract, createDefaultInitiativeRegistry: () => registry, markdown });
  const workspace = await original.buildWorkspace({ id: projectId, rootPath: virtualRoot }, { initiativeRegistry: registry });
  signal?.throwIfAborted();
  if (operation) {
    const descriptor = workspace.snapshot.initiatives.find(item => item.providerId === operation.providerId && item.id === operation.initiativeId);
    if (!descriptor) throw new Error('Initiative is unavailable or provider does not match');
    if (operation.action === 'app') {
      if (operation.revision !== revision) throw new Error('Invalid or stale initiative request');
      if (operation.sourceHash !== descriptor.sourceHash) throw new Error('STALE_INITIATIVE: source hash changed');
      if (descriptor.presentation.mode !== 'embedded-app') throw new Error('Initiative is not an embedded app');
      return registry.prepareApp(workspace.roots, descriptor);
    }
    if (operation.action === 'artifact') {
      if (operation.sourceHash !== descriptor.sourceHash) throw new Error('STALE_INITIATIVE: source hash changed');
      return registry.readArtifact(workspace.roots, descriptor, { sourceHash: operation.sourceHash, artifactId: operation.artifactId });
    }
    return registry.load(workspace.roots, descriptor);
  }
  workspace.snapshot.project.name = basename(project.path);
  workspace.snapshot.lifecycle.diagnostic += ' DSH fs has no modification timestamps; modifiedAt uses the Unix epoch sentinel, not actual file times.';
  workspace.snapshot.warnings = scan.warnings;
  return { projectId, revision, snapshot: workspace.snapshot, warnings: scan.warnings };
}
