import path from 'node:path/posix';

// Virtual paths never leave this manifest. No host filesystem capability is imported.
export const virtualPath = path;
export const virtualRoot = '/project';
export function manifestFilesystem(files, directories, signal) {
  const normalize = value => path.resolve(value);
  const fail = value => Object.assign(new Error(`Manifest path unavailable: ${value}`), { code: 'ENOENT' });
  function node(value) {
    signal?.throwIfAborted();
    const key = normalize(value);
    if (!files.has(key) && !directories.has(key)) throw fail(value);
    const file = files.get(key);
    return { key, file, info: { size: file ? new TextEncoder().encode(file).length : 0, mtime: new Date(0), isFile: () => files.has(key), isDirectory: () => directories.has(key), isSymbolicLink: () => false } };
  }
  const api = {
    async access(value) { node(value); },
    async realpath(value) { return node(value).key; },
    async stat(value) { return node(value).info; },
    async lstat(value) { return node(value).info; },
    async readFile(value, encoding) {
      const entry = node(value);
      if (!entry.info.isFile()) throw fail(value);
      return encoding ? entry.file : Buffer.from(entry.file);
    },
    async readdir(value) {
      const parent = node(value);
      if (!parent.info.isDirectory()) throw fail(value);
      const children = [...new Set([...files.keys(), ...directories])].filter(key => key !== parent.key && path.dirname(key) === parent.key);
      return children.sort().map(key => ({ name: path.basename(key), ...node(key).info }));
    },
    async open(value) {
      node(value);
      return { stat: () => api.stat(value), readFile: encoding => api.readFile(value, encoding), close: async () => {} };
    },
  };
  return api;
}
