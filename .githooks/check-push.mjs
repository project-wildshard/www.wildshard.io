// pre-push: re-run the blob checks (size cap, credentials, syntax) over
// every commit this push sends, so a `git commit --no-verify` cannot
// carry a token or a huge file off the machine. Reads git's ref lines
// on stdin: <local ref> <local sha> <remote ref> <remote sha>.
import { readFileSync } from 'node:fs';
import { blobSizes, checkBlob, git, herdrPeers, printPeers, report } from './lib.mjs';

printPeers(herdrPeers(), 'share this repo: a red check below may be their WIP, not yours');

const ZERO = /^0+$/;
const refs = readFileSync(0, 'utf8').split('\n').filter(Boolean).map((line) => line.split(' '));

const commits = new Set();
for (const [, local, , remote] of refs) {
  if (!local || ZERO.test(local)) continue; // deleting a remote ref
  const range = remote && !ZERO.test(remote) ? [`${remote}..${local}`] : [local, '--not', '--remotes'];
  for (const sha of git(['rev-list', ...range]).split('\n').filter(Boolean)) commits.add(sha);
}

const blobs = new Map(); // object -> { path, object, mode, commit }
for (const commit of commits) {
  const raw = git(['diff-tree', '-r', '-z', '--root', '--no-commit-id', '--diff-filter=ACMR', commit]).split('\0');
  for (let i = 0; i < raw.length - 1; i++) {
    if (!raw[i].startsWith(':')) continue;
    const [, , mode, object, status] = raw[i].slice(1).match(/^(\d+) (\d+) [0-9a-f]+ ([0-9a-f]+) ([A-Z])/) ?? [];
    const path = status === 'R' || status === 'C' ? raw[(i += 2)] : raw[++i];
    if (object && !blobs.has(object)) blobs.set(object, { path, object, mode, commit });
  }
}

const sizes = blobSizes([...blobs.keys()]);
const problems = [...blobs.values()].flatMap((entry) =>
  checkBlob(entry, sizes.get(entry.object) ?? 0).map((problem) => `${entry.commit.slice(0, 9)} ${problem}`));
if (report('push blocked: an outgoing commit fails the blob checks', problems)) process.exit(1);
console.error(`  - pre-push: ${commits.size} outgoing commit(s), ${blobs.size} blob(s) clean`);
