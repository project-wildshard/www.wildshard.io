// pre-push: re-run the blob checks (size cap, credentials, syntax) over
// every commit this push sends, so a `git commit --no-verify` cannot
// carry a token or a huge file off the machine. Reads git's ref lines
// on stdin: <local ref> <local sha> <remote ref> <remote sha>.
import { readFileSync } from 'node:fs';
import { hatchesSet, hatchRefusal, unnamedHatches } from './check-commit-message.mjs';
import { branchCreate, refLines } from './branch-restore.mjs';
import { advertisedTips, blobSizes, checkBlob, git, peers, outgoingRange, printPeers, report } from './lib.mjs';

printPeers(peers(), 'share this repo: a red check below may be their WIP, not yours');

const ZERO = /^0+$/;
// Git passes the actual push URL ($2). Only what that destination advertises
// now narrows a new ref's range; asked once, and only when a new ref is pushed.
let advertised = null;
const tips = () => (advertised ??= advertisedTips(process.argv[2] ?? ''));
const refs = readFileSync(0, 'utf8').split('\n').filter(Boolean).map((line) => line.split(' '));

const commits = new Set();
for (const [, local, , remote] of refs) {
  if (!local || ZERO.test(local)) continue; // deleting a remote ref
  const range = outgoingRange(local, remote, !remote || ZERO.test(remote) ? tips() : []);
  for (const sha of git(['rev-list', ...range]).split('\n').filter(Boolean)) commits.add(sha);
}

const blobs = new Map(); // object -> { path, object, mode, commit }
for (const commit of commits) {
  const raw = git(['diff-tree', '-m', '-r', '-z', '--root', '--no-commit-id', '--diff-filter=ACMR', commit]).split('\0');
  for (let i = 0; i < raw.length - 1; i++) {
    if (!raw[i].startsWith(':')) continue;
    const [, , mode, object, status] = raw[i].slice(1).match(/^(\d+) (\d+) [0-9a-f]+ ([0-9a-f]+) ([A-Z])/) ?? [];
    const path = status === 'R' || status === 'C' ? raw[(i += 2)] : raw[++i];
    if (object && !blobs.has(object)) blobs.set(object, { path, object, mode, commit });
  }
}

// J381 (meta QA 11-25 row 51): a push made with a SKIP_* or ALLOW_* variable set names each one, with its reason, in
// a commit it sends.
// ALLOW_BRANCH_RESTORE (row 113) re-creates a deleted branch whose published commits cannot be edited to name it; it
// never applies to a main push, so there it is named like any other hatch.
const restoreOnly = refs.length > 0 && refLines(refs.map((row) => row.join(' ')).join('\n')).every(branchCreate);
const hatches = hatchesSet().filter((name) => !(restoreOnly && name === 'ALLOW_BRANCH_RESTORE'));
if (hatches.length && commits.size) {
  const messages = [...commits].map((sha) => git(['log', '-1', '--format=%B', sha]));
  const unnamed = hatches.filter((name) => messages.every((message) => unnamedHatches(message, [name]).length));
  if (unnamed.length) {
    console.error(`\n  X push blocked: no outgoing commit names its escape hatch. ${hatchRefusal(unnamed)}\n    Amend the commit's body, then push again.\n`);
    process.exit(1);
  }
}

const sizes = blobSizes([...blobs.keys()]);
const problems = [...blobs.values()].flatMap((entry) =>
  checkBlob(entry, sizes.get(entry.object) ?? 0).map((problem) => `${entry.commit.slice(0, 9)} ${problem}`));
if (report('push blocked: an outgoing commit fails the blob checks', problems)) process.exit(1);
console.error(`  - pre-push: ${commits.size} outgoing commit(s), ${blobs.size} blob(s) clean`);
