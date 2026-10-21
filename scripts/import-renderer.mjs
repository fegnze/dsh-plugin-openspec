// Explicit maintainer import. Never runs at install/build; review upstream changes before importing.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root = resolve(process.argv[2] || '/Users/ghost/work/OpenSpecGUI');
const destination = new URL('../src/upstream/', import.meta.url);
await mkdir(destination, { recursive: true });
const files = ['src/renderer/app.js', 'src/renderer/styles.css', 'src/renderer/index.html', 'src/renderer/progress.js', 'src/renderer/host-router.js', 'src/renderer/vendor/marked.umd.js', 'src/renderer/vendor/lucide.min.js', 'licenses/MARKED-LICENSE.md', 'licenses/LUCIDE-LICENSE', 'THIRD_PARTY_NOTICES.md', 'LICENSE'];
const hashes = {};
for (const path of files) {
  const content = await readFile(resolve(root, path));
  const name = path.split('/').at(-1);
  await writeFile(new URL(name, destination), content);
  hashes[path] = createHash('sha256').update(content).digest('hex');
}
await writeFile(new URL('provenance.json', destination), JSON.stringify({ source: 'OpenSpecGUI', licenseDeclaration: 'MIT', repository: 'https://github.com/fegnze/OpenSpecGUI', files: hashes }, null, 2) + '\n');
console.log('Imported reviewed renderer source and notices.');
