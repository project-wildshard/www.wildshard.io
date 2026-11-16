#!/usr/bin/env node
// Safe sync for many lanes in ONE shared checkout on main (meta MINI-DECISIONS M1, J389; Jake, 2026-11-16: "all
// your agents ... work on one checkout of engine, commit to main push"). Kit copy (repo-kit files/scripts/) of
// engine's scripts/main-push.mjs (meta HOW-WE-BUILD WL22), itself meta's scripts/meta-push.mjs (MF7) ported.
// In place of `git commit -- <paths>`, `git pull --rebase origin main` and `git push origin main`:
//
//   node scripts/main-push.mjs -m "<subject>" [-m "<body>"]... <file>...   commit these files, then sync and push
//   node scripts/main-push.mjs                                              push commits already made
//   node scripts/main-push.mjs --onto <sha> -m "<subject>" <file>...        after a conflict: commit the files you
//                                                                           merged against origin/main at <sha>
//   options: --tries <n> (default 8), --wait <seconds> (first wait, doubling; default 5)
//
// How it stays safe beside other lanes' edits:
//   1. the commit is by pathspec (`git commit -m ... -- <files>`), after `git add` of only the named files that are
//      untracked; a directory is refused, since it would sweep in another lane's files;
//   2. `git fetch origin main`; when main lacks origin/main, the commits only main has are replayed onto origin/main
//      with `git replay` (no working tree), then `git read-tree -m -u` moves only the paths that differ and refuses,
//      before writing anything, when one of them holds an uncommitted edit; then main's ref moves;
//   3. `git push origin main`, through the normal pre-push: the kit's push lane (.githooks/run-checks.mjs) gates the
//      pushed commit in a clean copy (.githooks/push-gate-copy.mjs), so other lanes' dirty and untracked files neither
//      refuse the push nor leak in; main's own CI runs the rest, and the lane that pushed fixes a red forward at once
//      (J249).
// One run at a time: a lock directory in the git dir (main-push.lock), held through the push; a dead or 30-minute-old
// lock is taken over. Another lane's edit in the way, a held index.lock, the lock or a push race waits and tries again
// (5, 10, 20 ... 640 s). A merge commit or a refused pre-push stops at once, your commit on local main. A real conflict
// stops too, and undoes this run's own commit so the lane's edits are uncommitted again; the STOP line says what to
// merge and prints the `--onto` command that finishes it. Never a rebase, never a stash (never --autostash): in a
// shared checkout `git rebase --continue` refuses beside another lane's unstaged edit and `git rebase --abort` wipes it.
// Exit 0 when pushed; 1 with a `main-push STOP` line; 2 on bad arguments.
import { spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export class StopError extends Error {
  /** @param {string} message @param {boolean} [retry] a later try may succeed */
  constructor(message, retry = false) {
    super(message);
    this.name = 'StopError';
    this.retry = retry;
    /** @type {{upstream:string,files:string[]}|undefined} a real conflict: what to merge against */
    this.conflict = undefined;
  }
}

/** @param {string} cwd @param {string[]} args */
function run(cwd, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  return spawnSync('git', args, { cwd, env, encoding: 'utf8', maxBuffer: 64 << 20 });
}

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  const result = run(cwd, args);
  if (result.status !== 0) throw new StopError(`git ${args.join(' ')}: ${firstLines(result.stderr || result.stdout)}`);
  return result.stdout.trim();
}

/** @param {string} text @param {number} [n] */
function firstLines(text, n = 6) { return text.trim().split('\n').slice(0, n).join(' | '); }

/** Refuse anything but main with no rebase, merge, cherry-pick or revert in progress. @param {string} cwd */
export function checkState(cwd) {
  if (run(cwd, ['symbolic-ref', '--quiet', 'HEAD']).stdout.trim() !== 'refs/heads/main') {
    throw new StopError('the checkout is not on main; lanes here work on main only (M1)');
  }
  for (const name of ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
    if (existsSync(resolve(cwd, git(cwd, ['rev-parse', '--git-path', name])))) {
      throw new StopError(`a git ${name} is in progress in the shared checkout; whoever started it finishes or aborts it (git status shows it), then run this again`);
    }
  }
}

/** Subjects of the commits this run made (commitFiles), so a push can tell its own from another lane's. A sync replays
 * them to new SHAs, so the subject is what survives. */
const OWN = new Set();

/** One `lane-receipts.log` line, `<HH:MM Cancún> <lane> <text>` (the Mac's clock is Cancún time). WS_MAIN_PUSH_RECEIPT=0
 * (the tests) writes none. @param {string} text */
function receipt(text) {
  if (process.env.WS_MAIN_PUSH_RECEIPT === '0') return;
  const file = resolve(process.env.WS_LANE_RECEIPTS ?? join(homedir(), '.cache/wildshard/lane-receipts.log'));
  const lane = /^[a-z][a-z0-9_-]*$/u.test(process.env.WS_LANE_NAME ?? '') ? process.env.WS_LANE_NAME : 'main-push';
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${new Date().toTimeString().slice(0, 5)} Cancún ${lane} ${text.replaceAll(/\s+/gu, ' ').slice(0, 1000)}\n`);
  } catch {
    /* a receipt is best effort */
  }
}

/**
 * Commit exactly these files by pathspec. Untracked ones are added first, one by one.
 * @param {string} cwd @param {string[]} files @param {string[]} messages
 */
export function commitFiles(cwd, files, messages) {
  for (const file of files) {
    const full = resolve(cwd, file);
    if (existsSync(full) && statSync(full).isDirectory()) throw new StopError(`${file} is a directory; name each file, so no other lane's file rides along`);
  }
  const untracked = files.filter((file) => existsSync(resolve(cwd, file)) && run(cwd, ['ls-files', '--error-unmatch', '--', file]).status !== 0);
  if (untracked.length > 0) git(cwd, ['add', '--', ...untracked]);
  const commit = run(cwd, ['commit', ...messages.flatMap((message) => ['-m', message]), '--', ...files]);
  if (commit.status !== 0) {
    if (untracked.length > 0) run(cwd, ['reset', '--quiet', '--', ...untracked]);
    throw new StopError(`git commit refused: ${firstLines(`${commit.stdout}\n${commit.stderr}`, 12)}`);
  }
  const made = git(cwd, ['rev-parse', '--short=8', 'HEAD']);
  OWN.add(git(cwd, ['log', '-1', '--format=%s', 'HEAD']));
  return made;
}

/**
 * Bring main up to origin/main without touching unrelated files (engine's main-pull.mjs's way).
 * @param {string} cwd @param {string} [remote] @returns {string} what it did
 */
export function syncMain(cwd, remote = 'origin') {
  checkState(cwd);
  const fetched = run(cwd, ['fetch', '--quiet', remote, 'main']);
  if (fetched.status !== 0) throw new StopError(`git fetch ${remote} main: ${firstLines(fetched.stderr)}`, true);
  const head = git(cwd, ['rev-parse', 'HEAD']);
  const upstream = git(cwd, ['rev-parse', `refs/remotes/${remote}/main`]);
  if (run(cwd, ['merge-base', '--is-ancestor', upstream, head]).status === 0) return `main current at ${head.slice(0, 8)}`;
  let target = upstream;
  let how = 'fast-forward';
  if (run(cwd, ['merge-base', '--is-ancestor', head, upstream]).status !== 0) {
    const own = git(cwd, ['rev-list', '--count', `${upstream}..refs/heads/main`]);
    const replayed = run(cwd, ['replay', '--ref-action=print', '--onto', upstream, `${upstream}..refs/heads/main`]);
    if (replayed.status !== 0 && /merge commit/iu.test(replayed.stderr)) {
      throw new StopError(`the ${own} local commit(s) include a merge, which git replay cannot move; ask the coordinator`);
    }
    if (replayed.status !== 0) {
      // git replay prints nothing on a conflict; merge-tree names the files without touching anything.
      const named = run(cwd, ['merge-tree', '--write-tree', '--name-only', '--no-messages', upstream, head]).stdout.trim().split('\n').slice(1).filter(Boolean);
      const files = [...new Set(named)];
      const detail = firstLines(replayed.stderr || replayed.stdout, 3);
      const error = new StopError(`your commit(s) conflict with origin/main${files.length > 0 ? ` in ${files.join(', ')}` : ` (${detail === '' ? 'git replay failed' : detail})`}; nothing moved`);
      error.conflict = { upstream, files };
      throw error;
    }
    const line = replayed.stdout.trim().split('\n').find((row) => /^update(-ref)? refs\/heads\/main /u.test(row));
    const sha = line?.split(/\s+/u)[2] ?? '';
    if (!/^[a-f0-9]{40}$/u.test(sha)) throw new StopError(`git replay gave no new main (${replayed.stdout.trim().slice(0, 200)})`);
    target = sha;
    how = `replayed ${own} local commit(s)`;
  }
  if (git(cwd, ['rev-parse', 'HEAD']) !== head) throw new StopError('another lane committed while syncing; nothing moved', true);
  run(cwd, ['update-index', '-q', '--refresh']);
  const moved = run(cwd, ['read-tree', '-m', '-u', head, target]);
  if (moved.status !== 0) {
    if (/index\.lock/u.test(moved.stderr)) throw new StopError('another git command holds the index (index.lock); nothing moved', true);
    const untracked = [...moved.stderr.matchAll(/^error: Untracked working tree file '([^']+)'/gmu)].map((match) => match[1]);
    if (untracked.length > 0) throw new StopError(`untracked files sit where origin/main adds files: ${untracked.join(', ')}; nothing moved. Another lane's? It commits soon`, true);
    const files = [...moved.stderr.matchAll(/^error: Entry '([^']+)'/gmu)].map((match) => match[1]);
    throw new StopError(`uncommitted edits in paths origin/main changes: ${files.length > 0 ? files.join(', ') : firstLines(moved.stderr, 1)}; nothing moved. Another lane's? It commits soon`, true);
  }
  const ref = run(cwd, ['update-ref', '-m', `main-push: ${how}`, 'refs/heads/main', target, head]);
  if (ref.status !== 0) {
    const now = git(cwd, ['rev-parse', 'HEAD']);
    const back = run(cwd, ['read-tree', '-m', '-u', target, now]);
    if (back.status !== 0) throw new StopError(`another lane committed while syncing and the tree could not be put back (${firstLines(back.stderr, 1)}): git status, then git read-tree -m -u ${target.slice(0, 10)} HEAD`);
    throw new StopError('another lane committed while syncing; nothing moved', true);
  }
  return `main ${head.slice(0, 8)} -> ${target.slice(0, 8)} (${how}); other lanes' files untouched`;
}

/** Push main. A push race retries; a refused pre-push stops. @param {string} cwd @param {string} [remote] */
export function pushMain(cwd, remote = 'origin') {
  // What this push sends: every commit local main has over origin/main. In a shared checkout that can include another
  // lane's commit, made but not yet pushed; it rides along (M1) and the receipt names it.
  const sent = git(cwd, ['rev-parse', 'HEAD']);
  const outgoing = run(cwd, ['log', '--format=%h %s', `refs/remotes/${remote}/main..${sent}`]).stdout.trim().split('\n').filter(Boolean);
  // The pre-push's whole output (the gate) goes to a log in the git dir: its RED lines are the cause on a refusal.
  const log = resolve(cwd, git(cwd, ['rev-parse', '--git-path', `main-push-${process.pid}.log`]));
  const fd = openSync(log, 'w');
  let pushed;
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    pushed = spawnSync('git', ['push', remote, `${sent}:refs/heads/main`], { cwd, env, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', fd, fd] });
  } finally {
    closeSync(fd);
  }
  // The gate's lint and type errors go to stdout, its summary to stderr: both are in the log.
  const text = readFileSync(log, 'utf8');
  if (pushed.status === 0) {
    rmSync(log, { force: true });
    const head = sent.slice(0, 10);
    const carried = outgoing.filter((row) => !OWN.has(row.slice(row.indexOf(' ') + 1)));
    const line = `pushed main ${head}: ${outgoing.length} commit(s)${carried.length > 0 ? `, ${carried.length} of them another lane's, carried along (M1): ${carried.join('; ')}` : ''}`;
    receipt(`main-push ${line}`);
    return line;
  }
  if (/\[rejected\]|fetch first|non-fast-forward|failed to update ref|cannot lock ref/iu.test(text) && !/pre-push hook/iu.test(text)) {
    rmSync(log, { force: true });
    throw new StopError('origin/main moved during the push', true);
  }
  // oxlint-disable-next-line no-control-regex -- strips terminal colour codes.
  const lines = text.split('\n').map((line) => line.replaceAll(/\u001B\[[0-9;]*m/gu, '').trim()).filter(Boolean);
  const red = lines.filter((line) => /(?:^|\s)(?:RED|X)\s|blocked|refused|Error: |error TS\d|: error /u.test(line)).slice(0, 8);
  throw new StopError(`git push refused by the pre-push: ${(red.length > 0 ? red : lines.slice(-8)).join(' | ')}. Whole output: ${log}`);
}

/**
 * Sync and push, trying again on a retryable stop. `afterSync` runs once, after the first sync that succeeds (the
 * --onto commit).
 * @param {string} cwd @param {{ tries?: number, wait?: number, sleep?: (s: number) => void, log?: (line: string) => void, afterSync?: () => void }} [options]
 */
export function syncAndPush(cwd, { tries = 8, wait = 5, sleep = sleepSeconds, log = () => { /* No logging requested. */ }, afterSync = () => { /* No deferred commit. */ } } = {}) {
  let synced = false;
  for (let attempt = 1; ; attempt++) {
    try {
      log(syncMain(cwd));
      if (!synced) {
        synced = true;
        afterSync();
      }
      if (run(cwd, ['merge-base', '--is-ancestor', 'HEAD', 'refs/remotes/origin/main']).status === 0) return 'nothing to push';
      return pushMain(cwd);
    } catch (error) {
      if (!(error instanceof StopError) || !error.retry || attempt >= tries) throw error;
      const seconds = wait * 2 ** (attempt - 1);
      log(`try ${attempt} of ${tries}: ${error.message}; trying again in ${seconds} s`);
      sleep(seconds);
    }
  }
}

/**
 * Undo this run's own commit after a conflict: main goes back one commit and the files' index entries with it, so the
 * lane's edits are uncommitted changes again, byte for byte. Only when that commit is still HEAD.
 * @param {string} cwd @param {string} sha @param {string[]} files
 */
export function uncommit(cwd, sha, files) {
  const head = git(cwd, ['rev-parse', 'HEAD']);
  if (!head.startsWith(sha)) return false;
  const parent = git(cwd, ['rev-parse', 'HEAD~1']);
  if (run(cwd, ['update-ref', '-m', 'main-push: undo own commit after a conflict', 'refs/heads/main', parent, head]).status !== 0) return false;
  run(cwd, ['reset', '--quiet', parent, '--', ...files]);
  return true;
}

/**
 * --onto <sha>: the lane merged its files against origin/main as of <sha>. Refuse when origin/main has changed one of
 * them since; otherwise point their index entries at origin/main's version, so the sync moves past them and the
 * worktree (the lane's merged content) stays as it is.
 * @param {string} cwd @param {string} onto @param {string[]} files @param {string} [remote]
 */
export function prepareOnto(cwd, onto, files, remote = 'origin') {
  const fetched = run(cwd, ['fetch', '--quiet', remote, 'main']);
  if (fetched.status !== 0) throw new StopError(`git fetch ${remote} main: ${firstLines(fetched.stderr)}`);
  const base = run(cwd, ['rev-parse', '--verify', '--quiet', `${onto}^{commit}`]).stdout.trim();
  if (!base) throw new StopError(`--onto ${onto} is not a commit here`);
  const upstream = git(cwd, ['rev-parse', `refs/remotes/${remote}/main`]);
  const blob = (/** @type {string} */ commit, /** @type {string} */ file) => run(cwd, ['rev-parse', '--verify', '--quiet', `${commit}:${file}`]).stdout.trim();
  const moved = files.filter((file) => blob(base, file) !== blob(upstream, file));
  if (moved.length > 0) {
    const error = new StopError(`origin/main changed ${moved.join(', ')} again since ${base.slice(0, 8)}; nothing moved`);
    error.conflict = { upstream, files: moved };
    throw error;
  }
  const known = files.filter((file) => blob(upstream, file));
  const fresh = files.filter((file) => !blob(upstream, file));
  if (known.length > 0) git(cwd, ['reset', '--quiet', upstream, '--', ...known]);
  if (fresh.length > 0) run(cwd, ['rm', '--cached', '--quiet', '--ignore-unmatch', '--', ...fresh]);
}

/** The shell command to run once the lane has merged its files against `upstream`.
 * @param {string} upstream @param {string[]} messages @param {string[]} files */
export function ontoCommand(upstream, messages, files) {
  const quote = (/** @type {string} */ text) => (/^[\w@%+=:,./-]+$/u.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`);
  return ['node scripts/main-push.mjs --onto', upstream.slice(0, 12), ...messages.flatMap((message) => ['-m', quote(message)]), ...files.map(quote)].join(' ');
}

/** The STOP text for a conflict: what to merge and the exact command that finishes it.
 * @param {{upstream:string,files:string[]}} conflict @param {string[]} messages @param {string[]} mine @param {boolean} undone */
export function conflictAdvice({ upstream, files }, messages, mine, undone) {
  const show = files.map((file) => `git show ${upstream.slice(0, 12)}:${file}`).join('; ');
  const where = undone ? `Your commit is undone and your edits are back, uncommitted, in ${mine.join(', ')}.` : 'Your files are as they were.';
  return `${where} Another lane changed the same lines. Do not rebase here: in this shared checkout git rebase --continue ` +
    `refuses beside other lanes' edits and git rebase --abort wipes them. Instead write each file as origin/main's version ` +
    `(${show}) plus your change (git diff -- <file> shows it), then run: ${ontoCommand(upstream, messages, mine)}`;
}

/**
 * Take the checkout's main-push lock (a directory in the git dir), so two runs never move main at once. A lock whose
 * process is gone, or that is over 10 minutes old, is taken over. Waits like a sync does, then stops.
 * @param {string} cwd @param {{tries?:number,wait?:number,sleep?:(seconds:number)=>void,log?:(line:string)=>void}} [options]
 * @returns {() => void} the release
 */
export function takeLock(cwd, { tries = 8, wait = 5, sleep = sleepSeconds, log = () => { /* No logging requested. */ } } = {}) {
  const lock = resolve(cwd, git(cwd, ['rev-parse', '--git-path', 'main-push.lock']));
  const owner = join(lock, 'pid');
  for (let attempt = 1; ; attempt++) {
    try {
      mkdirSync(lock);
      writeFileSync(owner, `${process.pid}\n`);
      return () => rmSync(lock, { recursive: true, force: true });
    } catch (error) {
      const failure = /** @type {NodeJS.ErrnoException} */ (error);
      if (failure.code !== 'EEXIST') throw new StopError(`cannot take the lock ${lock}: ${failure.message}`);
    }
    let pid = 0;
    try {
      pid = Number(readFileSync(owner, 'utf8').trim());
    } catch {
      pid = 0;
    }
    let alive = pid > 0;
    if (alive) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        alive = /** @type {NodeJS.ErrnoException} */ (error).code === 'EPERM';
      }
    }
    const old = Date.now() - (statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now()) > 30 * 60 * 1000;
    if ((!alive && pid > 0) || old) {
      log(`taking over a stale lock (pid ${pid || '?'}${old ? ', over 30 min old' : ', gone'})`);
      rmSync(lock, { recursive: true, force: true });
      continue;
    }
    if (attempt >= tries) throw new StopError(`another main-push (pid ${pid || '?'}) holds ${lock}; nothing moved. Run this again when it finishes`);
    // Another lane's gate holds the lock for a minute or two: poll at most every 15 s, so the lock never sits idle.
    const seconds = Math.min(wait * 2 ** (attempt - 1), 15);
    log(`try ${attempt} of ${tries}: another main-push (pid ${pid || '?'}) is running; trying again in ${seconds} s`);
    sleep(seconds);
  }
}

/** After a stop: the checkout must be on main and not mid-rebase or mid-merge. Say so loudly when it is not.
 * @param {string} cwd */
export function verifyAfterStop(cwd) {
  try {
    checkState(cwd);
    return '';
  } catch (error) {
    return `!! main-push STOPPED AND THE SHARED CHECKOUT IS NOT CLEAN: ${error instanceof Error ? error.message : String(error)}. Tell the coordinator now`;
  }
}

/** @param {number} seconds */
function sleepSeconds(seconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {{messages:string[],files:string[],tries:number,wait:number,onto:string}} */
  const out = { messages: [], files: [], tries: 8, wait: 5, onto: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-m' || arg === '--message') out.messages.push(argv[++i] ?? '');
    else if (arg === '--tries') out.tries = Number(argv[++i]);
    else if (arg === '--wait') out.wait = Number(argv[++i]);
    else if (arg === '--onto') out.onto = argv[++i] ?? '';
    else if (arg === '--') { out.files.push(...argv.slice(i + 1)); i = argv.length; }
    else if (arg.startsWith('-')) return { error: `unknown option ${arg}` };
    else out.files.push(arg);
  }
  if (out.files.length > 0 && !out.messages.some((message) => message.trim())) return { error: 'files need a message: -m "<subject>"' };
  if (out.files.length === 0 && out.messages.length > 0) return { error: '-m needs the files to commit' };
  if (out.onto !== '' && !/^[0-9a-f]{7,40}$/u.test(out.onto)) return { error: '--onto takes the origin/main SHA the STOP line printed' };
  if (out.onto && out.files.length === 0) return { error: '--onto needs -m and the files' };
  if (!Number.isInteger(out.tries) || out.tries < 1 || !Number.isFinite(out.wait) || out.wait < 0) return { error: '--tries takes 1 or more, --wait seconds' };
  return out;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = parseArgs(process.argv.slice(2));
  if ('error' in options) {
    console.error(`main-push: ${options.error}\nusage: node scripts/main-push.mjs [-m "<subject>" [-m "<body>"]... <file>...] [--tries n] [--wait s]`);
    process.exit(2);
  }
  const cwd = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  const log = (/** @type {string} */ line) => console.log(`main-push ${line}`);
  let release = () => { /* No lock acquired yet. */ };
  let made = '';
  try {
    checkState(cwd);
    // Five lanes' gates can queue for the lock: wait up to about 30 min for it unless --tries says otherwise.
    release = takeLock(cwd, { tries: process.argv.includes('--tries') ? options.tries : 120, wait: options.wait, log });
    const commit = () => {
      made = commitFiles(cwd, options.files, options.messages);
      log(`committed ${made}`);
    };
    if (options.onto) {
      prepareOnto(cwd, options.onto, options.files);
      try {
        log(syncAndPush(cwd, { tries: options.tries, wait: options.wait, log, afterSync: commit }));
      } catch (error) {
        if (!made) run(cwd, ['reset', '--quiet', 'HEAD', '--', ...options.files]);
        throw error;
      }
    } else {
      if (options.files.length > 0) commit();
      log(syncAndPush(cwd, { tries: options.tries, wait: options.wait, log }));
    }
  } catch (error) {
    if (!(error instanceof StopError)) throw error;
    let message = error.message;
    if (error.conflict && options.files.length > 0) {
      const undone = made !== '' && uncommit(cwd, made, options.files);
      message += `. ${conflictAdvice(error.conflict, options.messages, options.files, undone)}`;
    } else if (error.conflict) {
      message += ". Your commits stay on local main. Do not rebase here (--continue refuses beside other lanes' edits, --abort wipes them); ask the coordinator";
    }
    console.error(`main-push STOP ${message}`);
    const loud = verifyAfterStop(cwd);
    if (loud) console.error(loud);
    process.exitCode = 1;
  } finally {
    release();
  }
}
