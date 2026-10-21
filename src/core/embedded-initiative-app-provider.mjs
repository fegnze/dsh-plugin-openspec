import { diagnostic, IDENTIFIER_PATTERN, normalizeIdentifier, sha256, stableJson } from './initiative-contract.mjs';

const ID = 'openspec-embedded-app-v1';
const SCHEMA = 'https://openspec.dev/schemas/initiative-app-v1.json';
const RESERVED = ['archive', 'archives', 'changes', 'specs'];

function object(value, label, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${label} must be an object`);
  if (keys && Object.keys(value).some(key => !keys.includes(key))) throw new Error(`${label} contains unsupported fields`);
  return value;
}
function text(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || value.includes('\0')) throw new Error(`Invalid ${label}`);
  return value.trim();
}
function relative(value, label) {
  const result = text(value, label, 512);
  if (/[\\:%?#\x00-\x1f\x7f]/.test(result) || result.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`${label} must be a safe relative path`);
  return result;
}
function validate(value, candidate) {
  const manifest = object(value, 'Initiative App manifest', ['$schema', 'schemaVersion', 'id', 'kind', 'title', 'summary', 'presentation']);
  if (manifest.$schema !== SCHEMA || manifest.schemaVersion !== 1) throw new Error('Unsupported Initiative App schema');
  if (normalizeIdentifier(manifest.id, 'Initiative ID') !== candidate.initiativeId) throw new Error('Initiative directory and manifest ID do not match');
  const presentation = object(manifest.presentation, 'presentation', ['type', 'webRoot', 'entry', 'actions']);
  if (presentation.type !== 'embedded-app') throw new Error('Unsupported presentation.type');
  const webRoot = relative(presentation.webRoot, 'webRoot');
  const entry = relative(presentation.entry, 'entry');
  if (!/\.html$/i.test(entry)) throw new Error('Only an HTML entry is supported');
  const actions = presentation.actions === undefined ? {} : object(presentation.actions, 'actions');
  if (Object.keys(actions).length > 16) throw new Error('Too many actions');
  for (const [route, action] of Object.entries(actions)) {
    if (!route.startsWith('/') || route.length > 256 || /[\\%?#\x00-\x1f\x7f]/.test(route) || route.slice(1).split('/').some(part => !part || part === '.' || part === '..') || action !== 'openspec.open-change') throw new Error('Invalid or unsupported host action');
  }
  return { type: normalizeIdentifier(manifest.kind, 'Initiative kind'), title: text(manifest.title, 'title', 180), summary: text(manifest.summary, 'summary', 1200), webRoot, entry };
}

/** Capability-only provider: the caller supplies an immutable bounded manifest, never ambient fs. */
export function createEmbeddedInitiativeAppProvider({ fsPromises: fs, path }) {
  async function list(directory) {
    try { return await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function candidates(context) {
    const result = [];
    const collections = await list(context.openspecRealRoot);
    if (collections.length > 512) throw new Error('openspec root entry limit exceeded');
    for (const collection of collections) {
      if (!collection.isDirectory() || collection.isSymbolicLink() || !IDENTIFIER_PATTERN.test(collection.name) || RESERVED.includes(collection.name)) continue;
      const children = await list(path.join(context.openspecRealRoot, collection.name));
      if (children.length > 1024) throw new Error('Initiative collection entry limit exceeded');
      for (const child of children) {
        if (!child.isDirectory() || child.isSymbolicLink() || !IDENTIFIER_PATTERN.test(child.name)) continue;
        const resourceId = `${collection.name}/${child.name}/initiative-app.json`;
        try { await fs.lstat(path.join(context.openspecRealRoot, resourceId)); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        if (result.length >= 128) throw new Error('Initiative app candidate limit exceeded');
        result.push({ collection: collection.name, initiativeId: child.name, resourceId });
      }
    }
    return result.sort((a, b) => a.resourceId.localeCompare(b.resourceId));
  }
  async function regular(root, target, max) {
    const rel = path.relative(root, target);
    if (!rel || rel.startsWith('../') || path.isAbsolute(rel)) throw new Error('App path escapes allowed root');
    let current = root;
    for (const part of ['', ...rel.split('/')]) {
      if (part) current = path.join(current, part);
      const info = await fs.lstat(current);
      if (info.isSymbolicLink() || (current !== target && !info.isDirectory())) throw new Error('App path is not a regular path');
    }
    const info = await fs.stat(target);
    if (!info.isFile() || info.size > max) throw new Error('App file is unavailable or exceeds read limit');
    const content = await fs.readFile(target, 'utf8');
    if (Buffer.byteLength(content, 'utf8') > max || content.includes('\0')) throw new Error('App file exceeds read limit or is not text');
    return content;
  }
  async function read(context, candidate) {
    const manifest = await regular(context.openspecRealRoot, path.join(context.openspecRealRoot, candidate.resourceId), 128 * 1024);
    let parsed;
    try { parsed = JSON.parse(manifest); } catch { throw new Error('Invalid Initiative App JSON'); }
    const normalized = validate(parsed, candidate);
    const initiativeRoot = path.join(context.openspecRealRoot, candidate.collection, candidate.initiativeId);
    const webRoot = path.join(initiativeRoot, normalized.webRoot);
    const html = await regular(context.openspecRealRoot, path.join(webRoot, normalized.entry), 512 * 1024);
    const assets = {};
    let entriesSeen = 0, totalBytes = Buffer.byteLength(manifest, 'utf8') + Buffer.byteLength(html, 'utf8');
    async function collect(directory, prefix = '', depth = 0) {
      if (depth > 12) throw new Error('App asset depth limit exceeded');
      for (const item of await list(directory)) {
        if (++entriesSeen > 20000) throw new Error('App asset directory entry limit exceeded');
        const name = relative(item.name, 'asset name');
        if (name.includes('/')) throw new Error('Invalid asset directory entry');
        if (item.isSymbolicLink()) throw new Error('App asset path is not a regular path');
        const key = `${prefix}${name}`;
        if (item.isDirectory()) await collect(path.join(directory, name), `${key}/`, depth + 1);
        else if (item.isFile() && /\.(?:css|js)$/i.test(name)) {
          relative(key, 'asset path');
          if (Object.keys(assets).length >= 64) throw new Error('App asset limit 64 exceeded');
          const content = await regular(context.openspecRealRoot, path.join(webRoot, key), 512 * 1024);
          totalBytes += Buffer.byteLength(content, 'utf8');
          if (totalBytes > 8 * 1024 * 1024) throw new Error('App total content limit 8 MiB exceeded');
          assets[key] = content;
        }
      }
    }
    await collect(webRoot);
    const sourceHash = sha256(stableJson({ manifest, entry: normalized.entry, html, assets }));
    return { normalized, html, assets, sourceHash };
  }
  async function scan(context) {
    const initiatives = [], diagnostics = [], records = [], invalidInitiativeIds = [];
    for (const candidate of await candidates(context)) {
      try {
        const app = await read(context, candidate);
        initiatives.push({ schemaVersion: 1, id: candidate.initiativeId, providerId: ID, collection: candidate.collection, type: app.normalized.type, title: app.normalized.title, summary: app.normalized.summary, goal: '', status: 'active', health: 'healthy', changeRefs: [], presentation: { mode: 'embedded-app' }, artifacts: [], sourceHash: app.sourceHash, diagnostics: [] });
        records.push({ resourceId: candidate.resourceId, sourceHash: app.sourceHash });
      } catch (error) {
        diagnostics.push(diagnostic('INVALID_EMBEDDED_INITIATIVE_APP', 'error', '独立 Initiative App 清单无效', `${candidate.collection}/${candidate.initiativeId}: ${error.message}`.slice(0, 1200), { providerId: ID, initiativeId: candidate.initiativeId, resourceId: candidate.resourceId }));
        invalidInitiativeIds.push(candidate.initiativeId);
        records.push({ resourceId: candidate.resourceId, error: error.message });
      }
    }
    return { fingerprint: sha256(stableJson(records)), discovery: { initiatives, diagnostics, authoritative: invalidInitiativeIds.length === 0, invalidInitiativeIds } };
  }
  const nativeRequired = async () => { throw new Error('EMBEDDED_APP_REQUIRED: use the app action; host actions are not supported'); };
  return {
    id: ID, schemaVersions: [1],
    async fingerprint(context) { return (await scan(context)).fingerprint; },
    async discover(context) { return (await scan(context)).discovery; },
    load: nativeRequired, readArtifact: nativeRequired,
    async prepareApp(context, descriptor) {
      const collection = normalizeIdentifier(descriptor.collection, 'collection');
      const initiativeId = normalizeIdentifier(descriptor.id, 'Initiative ID');
      const app = await read(context, { collection, initiativeId, resourceId: `${collection}/${initiativeId}/initiative-app.json` });
      if (app.sourceHash !== descriptor.sourceHash) throw new Error('STALE_INITIATIVE: source hash changed');
      return { html: app.html, title: app.normalized.title, sourceHash: app.sourceHash, assets: app.assets };
    }
  };
}
