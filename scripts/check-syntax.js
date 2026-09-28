import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(entries.map((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? collect(fullPath) : entry.name.endsWith('.js') ? [fullPath] : [];
  }));
  return paths.flat();
}

const files = [...await collect('src'), ...await collect('scripts')];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('Syntax check passed for ' + files.length + ' JavaScript files.');
