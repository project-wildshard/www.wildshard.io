// Hook contract tests (meta MULTI-AGENT-TOOLING MA7): each shared script in
// .agents/hooks/ is fed payloads recorded from real Claude Code and Codex
// CLI 0.167.1 sessions (fixtures/, 2026-11-10) and must give both tools
// the same verdict. Sandboxes live in the repo's tmp/ and are removed.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchPaths, readPayload } from '../lib/payload.mjs';

const HOOKS = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(HOOKS, '..', '..');
const FIXTURES = join(HOOKS, 'test', 'fixtures');
const TOOLS = ['claude', 'codex'];
const scratch = join(REPO, 'tmp', 'agent-hooks-test');
mkdirSync(scratch, { recursive: true });
const boxes = [];
after(() => {
  for (const box of boxes) rmSync(box, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

// A clean environment: no agent or herdr variables, no GIT_* from a hook running this suite.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:GIT_|HERDR_|CLAUDE_)/.test(key)));
const fixture = (tool, name, root = '/repo') => JSON.parse(readFileSync(join(FIXTURES, tool, `${name}.json`), 'utf8').replaceAll('__ROOT__', root));
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...ENV, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });

/** A git repo holding a copy of .agents/hooks/ (and the md-wrap tool), with one commit. */
function sandbox() {
  const root = realpathSync(mkdtempSync(join(scratch, 'box-')));
  boxes.push(root);
  git(root, ['init', '-q', '-b', 'main']);
  cpSync(HOOKS, join(root, '.agents', 'hooks'), { recursive: true, filter: (path) => !path.includes(`${join('hooks', 'test')}`) });
  if (existsSync(join(REPO, 'src/scripts/md-wrap.mjs'))) cpSync(join(REPO, 'src/scripts/md-wrap.mjs'), join(root, 'src/scripts/md-wrap.mjs'));
  writeFileSync(join(root, 'notes.md'), '# t\n\nhello\n');
  git(root, ['add', '-A']);
  git(root, ['-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'init']);
  return root;
}
const run = (root, script, payload, env = {}) => {
  const result = spawnSync('bash', [join(root, '.agents', 'hooks', script)], { cwd: root, input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8', env: { ...ENV, ...env } });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr.replaceAll(root, '<root>') };
};
const withCommand = (tool, command) => {
  const payload = fixture(tool, 'pre-bash');
  payload.tool_input.command = command;
  return payload;
};

describe('payload adapter', () => {
  test('reads the shell command from both tools', () => {
    for (const tool of TOOLS) {
      const payload = readPayload(JSON.stringify(fixture(tool, 'pre-bash')));
      assert.deepEqual([payload.tool, payload.command, payload.paths], ['shell', 'git status --short', []], tool);
      assert.ok(payload.session, tool);
    }
  });
  test('reads edited paths from Claude Edit and Write and from a Codex patch', () => {
    assert.deepEqual(readPayload(JSON.stringify(fixture('claude', 'post-edit'))).paths, ['/repo/notes.md']);
    assert.deepEqual(readPayload(JSON.stringify(fixture('claude', 'post-write'))).paths, ['/repo/b.md']);
    assert.deepEqual(readPayload(JSON.stringify(fixture('codex', 'post-apply-patch'))).paths, ['/repo/notes.md', '/repo/b.md']);
    assert.equal(readPayload(JSON.stringify(fixture('codex', 'pre-apply-patch'))).tool, 'edit');
  });
  test('a patch names added, updated, deleted and moved files; relative ones resolve against cwd', () => {
    const patch = '*** Begin Patch\n*** Update File: a.md\n*** Move to: docs/b.md\n@@\n-x\n+y\n*** Delete File: c.md\n*** Add File: /abs/d.md\n+z\n*** Update File: a.md\n*** End Patch';
    assert.deepEqual(patchPaths(patch), ['a.md', 'docs/b.md', 'c.md', '/abs/d.md']);
    const payload = { cwd: '/w', tool_name: 'apply_patch', tool_input: { command: patch } };
    assert.deepEqual(readPayload(JSON.stringify(payload)).paths, ['/w/a.md', '/w/docs/b.md', '/w/c.md', '/abs/d.md']);
  });
  test('session start has a session id and no tool', () => {
    for (const tool of TOOLS) {
      const payload = readPayload(JSON.stringify(fixture(tool, 'session-start')));
      assert.equal(payload.tool, '', tool);
      assert.match(payload.session, /^[\w-]{8,}$/, tool);
    }
  });
  test('bad input reads as nothing, and the CLI never fails a session', () => {
    for (const raw of ['', 'not json', '[]', '{"tool_name":"Read"}']) assert.deepEqual(readPayload(raw), { tool: '', command: '', paths: [], session: '', cwd: '' });
    assert.equal(readPayload('{"tool_name":"Bash","tool_input":"x"}').command, '');
    const cli = spawnSync(process.execPath, [join(HOOKS, 'lib', 'payload.mjs'), 'command'], { input: 'garbage', encoding: 'utf8' });
    assert.deepEqual([cli.status, cli.stdout], [0, '']);
    const cwd = spawnSync(process.execPath, [join(HOOKS, 'lib', 'payload.mjs'), 'cwd'], { input: JSON.stringify({ tool_name: 'Bash', cwd: '/repo', tool_input: { command: 'ls' } }), encoding: 'utf8' });
    assert.deepEqual([cwd.status, cwd.stdout], [0, '/repo']);
  });
});

describe('guard-git-add.sh: same verdict from both tools', () => {
  const root = sandbox();
  const verdict = (tool, command) => run(root, 'guard-git-add.sh', withCommand(tool, command));
  const blocked = ['git add -A', 'git add .', 'git add -u', 'git -C /repo add --all', 'git commit -am "fix: x"', 'git commit -m "fix: x"', 'git diff -- a && git commit -m "fix: x"'];
  const allowed = ['git status --short', 'git add src/new.ts', 'git commit -m "fix: x" -- a.ts', 'git commit --amend --no-edit', 'SKIP_SWEEPGUARD=1 git commit -m "chore: all"', 'echo "git add -A"'];
  for (const command of blocked) {
    test(`blocks: ${command}`, () => {
      const [claude, codex] = TOOLS.map((tool) => verdict(tool, command));
      assert.equal(claude.status, 2);
      assert.match(claude.stderr, /BLOCKED by \.agents\/hooks\/guard-git-add\.sh/);
      assert.deepEqual(codex, claude);
    });
  }
  for (const command of allowed) {
    test(`allows: ${command}`, () => {
      const [claude, codex] = TOOLS.map((tool) => verdict(tool, command));
      assert.equal(claude.status, 0, claude.stderr);
      assert.deepEqual(codex, claude);
    });
  }
  test('ignores an edit payload and empty input', () => {
    for (const payload of [fixture('claude', 'pre-edit', root), fixture('codex', 'pre-apply-patch', root), '']) assert.equal(run(root, 'guard-git-add.sh', payload).status, 0);
  });
});

describe('md-prose-width.sh: same advice from both tools', { skip: !existsSync(join(REPO, 'src/scripts/md-wrap.mjs')) && 'no src/scripts/md-wrap.mjs here' }, () => {
  const long = (n) => `${'word '.repeat(n).trim()}`;
  const codexPatch = (root, files) => {
    const payload = fixture('codex', 'post-apply-patch', root);
    payload.tool_input.command = `*** Begin Patch\n${files.map((file) => `*** Update File: ${root}/${file}\n@@\n+x`).join('\n')}\n*** End Patch`;
    return payload;
  };
  const claudeEdit = (root, file) => {
    const payload = fixture('claude', 'post-edit', root);
    payload.tool_input.file_path = `${root}/${file}`; // not join(): a lexical .. must reach the hook
    return payload;
  };
  test('a long new line: both tools get exit 2 and the same advice', () => {
    const root = sandbox();
    writeFileSync(join(root, 'notes.md'), `# t\n\nhello\n${long(20)}\n`);
    const claude = run(root, 'md-prose-width.sh', claudeEdit(root, 'notes.md'));
    const codex = run(root, 'md-prose-width.sh', codexPatch(root, ['notes.md']));
    assert.equal(claude.status, 2, claude.stderr);
    assert.match(claude.stderr, /notes\.md:4: \d+ chars[\s\S]*node src\/scripts\/md-wrap\.mjs "notes\.md"/);
    assert.deepEqual(codex, claude);
  });
  test('Claude Write and Codex Add File, recorded payloads as sent', () => {
    const root = sandbox();
    writeFileSync(join(root, 'b.md'), `${long(20)}\n`);
    writeFileSync(join(root, 'notes.md'), '# t\n\nhello world\n');
    const claude = run(root, 'md-prose-width.sh', fixture('claude', 'post-write', root));
    const codex = run(root, 'md-prose-width.sh', fixture('codex', 'post-apply-patch', root));
    assert.equal(claude.status, 2);
    assert.match(claude.stderr, /b\.md:1:/);
    assert.deepEqual(codex, claude);
  });
  test('one patch over two long files reports both', () => {
    const root = sandbox();
    writeFileSync(join(root, 'a.md'), `${long(20)}\n`);
    writeFileSync(join(root, 'notes.md'), `# t\n\nhello\n${long(21)}\n`);
    const codex = run(root, 'md-prose-width.sh', codexPatch(root, ['a.md', 'notes.md']));
    assert.equal(codex.status, 2);
    assert.match(codex.stderr, /a\.md:1:[\s\S]*notes\.md:4:/);
  });
  test('a plan worktree file is checked in that worktree, and a lexical .. is resolved first (DS11)', () => {
    const root = sandbox();
    assert.equal(git(root, ['worktree', 'add', '-q', '-b', 'plan/p', '.worktrees/p']).status, 0);
    const tree = join(root, '.worktrees', 'p');
    writeFileSync(join(tree, 'new.md'), `${long(20)}\n`);
    const [claude, codex] = [run(root, 'md-prose-width.sh', claudeEdit(root, '.worktrees/p/new.md')), run(root, 'md-prose-width.sh', codexPatch(root, ['.worktrees/p/new.md']))];
    assert.equal(claude.status, 2, claude.stderr);
    assert.match(claude.stderr, /^ {2}new\.md:1: \d+ chars/mu);
    assert.doesNotMatch(claude.stderr, /\.worktrees/u);
    assert.deepEqual(codex, claude);
    writeFileSync(join(root, 'top.md'), `${long(20)}\n`);
    const lexical = run(root, 'md-prose-width.sh', claudeEdit(root, '.worktrees/p/../../top.md'));
    assert.equal(lexical.status, 2, lexical.stderr);
    assert.match(lexical.stderr, /^ {2}top\.md:1: \d+ chars/mu);
    assert.deepEqual(run(root, 'md-prose-width.sh', codexPatch(root, ['.worktrees/p/../../top.md'])), lexical);
  });
  test('short lines, other files, other repos and skipped folders pass for both', () => {
    const root = sandbox();
    writeFileSync(join(root, 'notes.md'), '# t\n\nhello there\n');
    writeFileSync(join(root, 'code.ts'), `// ${long(30)}\n`);
    mkdirSync(join(root, 'tmp'), { recursive: true });
    writeFileSync(join(root, 'tmp', 'x.md'), `${long(30)}\n`);
    const other = sandbox();
    writeFileSync(join(other, 'notes.md'), `${long(30)}\n`);
    for (const file of ['notes.md', 'code.ts', 'tmp/x.md']) {
      assert.equal(run(root, 'md-prose-width.sh', claudeEdit(root, file)).status, 0, file);
      assert.equal(run(root, 'md-prose-width.sh', codexPatch(root, [file])).status, 0, file);
    }
    assert.equal(run(root, 'md-prose-width.sh', claudeEdit(other, 'notes.md')).status, 0);
    assert.equal(run(root, 'md-prose-width.sh', codexPatch(other, ['notes.md'])).status, 0);
    assert.equal(run(root, 'md-prose-width.sh', codexPatch(root, ['notes.md']), { SKIP_MDWRAP: '1' }).status, 0);
  });
});

describe('session-brief.sh: same brief from both tools', () => {
  test('prints this repo\'s name, read at run time, and the same text', () => {
    const root = sandbox();
    const [claude, codex] = TOOLS.map((tool) => run(root, 'session-brief.sh', fixture(tool, 'session-start', root)));
    assert.equal(claude.status, 0, claude.stderr);
    assert.match(claude.stdout, new RegExp(`^== ${basename(root)} session brief \\(\\.agents/hooks/session-brief\\.sh\\) ==`));
    assert.match(claude.stdout, /\(not running inside herdr\)/);
    assert.deepEqual(codex, claude);
  });
  test('a plan worktree reports its canonical checkout\'s name', () => {
    const root = sandbox();
    assert.equal(git(root, ['worktree', 'add', '-q', '-b', 'plan/x', '.worktrees/x']).status, 0);
    cpSync(join(root, '.agents'), join(root, '.worktrees', 'x', '.agents'), { recursive: true });
    const result = run(join(root, '.worktrees', 'x'), 'session-brief.sh', fixture('codex', 'session-start', root));
    assert.match(result.stdout, new RegExp(`^== ${basename(root)} session brief`));
  });
  test('plan worktrees are allowed only where the worktree tool is (J240), stray anywhere else (D27)', () => {
    const mainOnly = (root) => run(root, 'session-brief.sh', fixture('claude', 'session-start', root)).stdout.split('-- main only')[1].split('\n-- ')[0];
    const root = sandbox();
    assert.equal(git(root, ['worktree', 'add', '-q', '-b', 'plan/foo', '.worktrees/foo']).status, 0);
    assert.match(mainOnly(root), /!! worktree .*\.worktrees\/foo/);
    assert.match(mainOnly(root), /!! branch plan\/foo/);
    mkdirSync(join(root, 'scripts'));
    writeFileSync(join(root, 'scripts', 'worktree.mjs'), '');
    const allowed = mainOnly(root);
    assert.match(allowed, /plan worktrees \(1\): \.worktrees\/foo/);
    assert.match(allowed, /\(clean: main only\)/);
    assert.doesNotMatch(allowed, /!!/);
    assert.equal(git(root, ['worktree', 'add', '-q', '--detach', join(root, 'tmp-wt')]).status, 0);
    assert.match(mainOnly(root), /!! worktree .*tmp-wt/);
  });
  test('from a plan worktree, peers are listed from the canonical checkout with where they work (DS6)', () => {
    const root = sandbox();
    assert.equal(git(root, ['worktree', 'add', '-q', '-b', 'plan/x', '.worktrees/x']).status, 0);
    cpSync(join(root, '.agents'), join(root, '.worktrees', 'x', '.agents'), { recursive: true });
    const bin = join(root, 'tmp-bin');
    mkdirSync(bin);
    const agents = [
      { pane_id: 'w1:p1', agent_status: 'working', cwd: root, agent_session: { value: 'a' }, terminal_title_stripped: 'On main' },
      { pane_id: 'w1:p2', agent_status: 'idle', cwd: join(root, '.worktrees', 'x', 'src'), agent_session: { value: 'b' }, terminal_title_stripped: 'In plan x' },
    ];
    writeFileSync(join(bin, 'agents.json'), JSON.stringify({ result: { agents } }));
    writeFileSync(join(bin, 'herdr'), `#!/usr/bin/env bash\n[ "$1 $2" = "agent list" ] && cat "${join(bin, 'agents.json')}"\n`);
    chmodSync(join(bin, 'herdr'), 0o755);
    const out = run(join(root, '.worktrees', 'x'), 'session-brief.sh', fixture('codex', 'session-start', root), { HERDR_ENV: '1', PATH: `${bin}:${process.env.PATH}` }).stdout;
    assert.match(out, /w1:p1 {2}working {2}On main {2}\[main\]/);
    assert.match(out, /w1:p2 {2}idle {2}In plan x {2}\[\.worktrees\/x\]/);
  });
  test('leaves out its own session, read from either tool\'s stdin', () => {
    const root = sandbox();
    const bin = join(root, 'tmp-bin');
    mkdirSync(bin);
    const agents = TOOLS.map((tool, index) => ({ pane_id: `w1:p${index + 1}`, agent_status: 'working', cwd: root, agent_session: { value: fixture(tool, 'session-start').session_id }, terminal_title_stripped: `Self ${tool}` }));
    agents.push({ pane_id: 'w1:p9', agent_status: 'idle', cwd: root, agent_session: { value: 'peer' }, terminal_title_stripped: 'Build the queue view' });
    writeFileSync(join(bin, 'agents.json'), JSON.stringify({ result: { agents } }));
    writeFileSync(join(bin, 'herdr'), `#!/usr/bin/env bash\n[ "$1 $2" = "agent list" ] && cat "${join(bin, 'agents.json')}"\n`);
    chmodSync(join(bin, 'herdr'), 0o755);
    for (const tool of TOOLS) {
      const out = run(root, 'session-brief.sh', fixture(tool, 'session-start', root), { HERDR_ENV: '1', PATH: `${bin}:${process.env.PATH}` }).stdout;
      assert.match(out, /w1:p9 {2}idle {2}Build the queue view {2}\[main\]/, tool);
      assert.doesNotMatch(out, new RegExp(`Self ${tool}`), tool);
    }
  });
});
