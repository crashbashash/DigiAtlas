import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function validateRelease(tag, versions) {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
  if (!match) throw new Error('Release tags must be stable versions such as v0.1.0.');
  const version = tag.slice(1);
  for (const [file, value] of Object.entries(versions)) {
    if (value !== version) throw new Error(`${file} has version ${value}; expected ${version}.`);
  }
  return version;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = new URL('../', import.meta.url);
  const json = (file) => JSON.parse(readFileSync(new URL(file, root), 'utf8'));
  const cargo = readFileSync(new URL('src-tauri/Cargo.toml', root), 'utf8');
  const version = validateRelease(process.argv[2] ?? '', {
    'package.json': json('package.json').version,
    'tauri.conf.json': json('src-tauri/tauri.conf.json').version,
    'Cargo.toml': /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1],
    'package-lock.json': json('package-lock.json').packages[''].version,
  });
  process.stdout.write(`Release ${version} matches the application version.\n`);
}
