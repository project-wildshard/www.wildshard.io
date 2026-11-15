#!/usr/bin/env node
// REPO-DISK DK20/J358: remind the ending session to audit its scratch.
// Agents copy and remove their own folders. This hook only reads; there is
// no automatic removal, trash rename, purge subprocess, or receipt watcher.
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// A shared lane may still contain another dev process. Never recommend
// removing its parent while a nested pidfile is live.
function busy(root, depth = 0) {
  for (const name of ['.pid', 'pid', 'pidfile', 'server.pid', 'dev.pid']) {
    try {
      const pid = Number(readFileSync(join(root, name), 'utf8').trim());
      if (!Number.isSafeInteger(pid) || pid < 1) continue;
      try { process.kill(pid, 0); return true; } catch (error) { if (error?.code === 'EPERM') return true; }
    } catch {}
  }
  if (depth < 2) try {
    return readdirSync(root, { withFileTypes: true }).some(entry => entry.isDirectory() && !entry.isSymbolicLink() && entry.name.startsWith('dev-') && busy(join(root, entry.name), depth + 1));
  } catch {}
  return false;
}

export function ownedFolders(session, root = ROOT) {
  if (typeof session !== 'string' || !/^[\w.@:-]{1,200}$/u.test(session)) return [];
  const tmp = join(root, 'tmp');
  try {
    if (!lstatSync(tmp).isDirectory() || lstatSync(tmp).isSymbolicLink()) return [];
    return readdirSync(tmp).toSorted().filter(name => {
      if (name.startsWith('.')) return false;
      try {
        const path = join(tmp, name), info = lstatSync(path), owner = join(path, '.owner');
        if (!info.isDirectory() || info.isSymbolicLink()) return false;
        if (busy(path)) return false;
        const marker = lstatSync(owner);
        if (!marker.isFile() || marker.isSymbolicLink() || marker.size > 65536) return false;
        const record = JSON.parse(readFileSync(owner, 'utf8'));
        return record?.session === session && (record.task === undefined || record.task === name);
      } catch { return false; }
    });
  } catch { return []; }
}

function main() {
  if (process.argv[2] === '--purge') return;
  let session;
  try { session = JSON.parse(readFileSync(0, 'utf8')).session_id; } catch { return; }
  const names = ownedFolders(session);
  if (names.length === 0) return;
  process.stdout.write('Scratch remains for your manual cleanup (J358): ' + names.slice(0, 3).map(name => 'tmp/' + name).join(', ') +
    (names.length > 3 ? ' and ' + (names.length - 3) + ' more' : '') +
    '. Copy first, remove your owned folders, then receipt the result.\n');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch {}
}
