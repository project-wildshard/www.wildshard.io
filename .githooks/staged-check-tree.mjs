import {execFileSync, spawnSync} from 'node:child_process';

/** @param {string} root @param {string[]} args */
function git(root, args) {
  return execFileSync('git', args, {cwd: root, encoding: 'utf8', maxBuffer: 64 << 20});
}

/** Capture the exact index Git supplied to pre-commit, including pathspec commits.
 * @param {string} root */
export function stagedCheckTree(root) {
  const tree = git(root, ['write-tree']).trim();
  const head = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], {cwd: root, encoding: 'utf8'}).stdout.trim();
  const files = head === ''
    ? git(root, ['ls-tree', '-r', '-z', '--name-only', tree])
    : git(root, ['diff-tree', '-r', '-z', '--name-only', '--diff-filter=ACMR', head, tree]);
  const hasPackage = git(root, ['ls-tree', '--name-only', tree, '--', 'package.json']).trim() !== '';
  const manifest = hasPackage ? JSON.parse(git(root, ['show', `${tree}:package.json`])) : {};
  return {tree, head, files: files.split('\0').filter(Boolean), manifest};
}

/** A temporary commit object lets the ordinary gate copy check out the index.
 * This writes no branch, tag or reflog entry.
 * @param {string} root @param {{tree:string,head:string}} staged */
export function stagedCheckCommit(root, {tree, head}) {
  return git(root, ['-c', 'user.name=Wildshard Commit Check', '-c', 'user.email=commit-check@wildshard.io',
    '-c', 'commit.gpgsign=false', 'commit-tree', tree, ...(head === '' ? [] : ['-p', head]),
    '-m', 'Index for the commit check']).trim();
}
