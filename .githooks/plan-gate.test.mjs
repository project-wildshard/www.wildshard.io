// The light plan gate in pre-commit: a NEW docs/plans/*.md needs a
// State line that leads with a state (block) and a <model>-<date>-<slug>
// name (warn). The State vocabulary (K2, meta's write-plan): draft,
// ready for review, draft parked, in progress, held, done. Commits here
// are real pathspec commits (`git commit -- <paths>`), the way agents
// commit in a shared checkout: the hooks then read git's private index.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WIDTH, findLong } from '../src/scripts/md-wrap.mjs';
import { ok, sandbox } from './test-helpers.mjs';

const MSG = ok('docs(plans): add a plan');
const JOURNAL = 'project/journal/2026-11-04.md';
const plan = (state) => `# Queue view\n\n> Written by: Claude\n\n${state}\n\n## Rows\n\n- [ ] build it\n`;

/** Write and add the files, then commit only them by pathspec (a private index). */
function pathspecCommit(box, files, { journal = true, env = {} } = {}) {
  const all = { ...files, ...(journal ? { [JOURNAL]: `- ${Object.keys(files).join(', ')}\n` } : {}) };
  for (const [path, content] of Object.entries(all)) box.write(path, content);
  box.git(['add', '--', ...Object.keys(all)]);
  return box.git(['commit', '-q', '-m', MSG, '--', ...Object.keys(all)], env);
}

describe('plan gate', () => {
  test('accepts > **State:** ready for review, 2026-11-07. with a model-date name', () => {
    const result = pathspecCommit(sandbox(), { 'docs/plans/opus-2026-11-04-queue-view.md': plan('> **State:** ready for review, 2026-11-07.') });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /name it/);
  });
  for (const state of ['draft, 2026-11-07.', 'draft, parked, 2026-11-07: for review in December.', 'in progress, approved 2026-11-07.', 'held, 2026-11-07: waits on A3.', 'done, 2026-11-07.']) {
    test(`accepts the state "${state.split(',')[0]}"`, () => {
      const result = pathspecCommit(sandbox(), { 'docs/plans/opus-2026-11-04-a.md': plan(`> **State:** ${state}`) });
      assert.equal(result.status, 0, result.stderr);
    });
  }
  test('accepts the plain, bold and backticked State forms', () => {
    for (const line of ['State: draft 2026-11-04', '**State:** `in progress` 2026-11-04']) {
      assert.equal(pathspecCommit(sandbox(), { 'docs/plans/opus-2026-11-04-a.md': plan(line) }).status, 0, line);
    }
  });
  test('blocks a new plan whose State leads with no state', () => {
    const result = pathspecCommit(sandbox(), { 'docs/plans/opus-2026-11-04-a.md': plan('> **State:** agreed in brainstorm') });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /new plan needs a State line[\s\S]*opus-2026-11-04-a\.md[\s\S]*ready for review/);
  });
  test('blocks a new plan with no State line at all', () => {
    assert.notEqual(pathspecCommit(sandbox(), { 'docs/plans/opus-2026-11-04-a.md': '# A\n\nbody\n' }).status, 0);
  });
  test('blocks a new plan on the retired Status vocabulary', () => {
    for (const line of ['Status: draft 2026-11-04', '**Status:** in progress', '> **State:** blocked on Jake', '> **State:** finished']) {
      const result = pathspecCommit(sandbox(), { 'docs/plans/opus-2026-11-04-a.md': plan(line) });
      assert.notEqual(result.status, 0, line);
      assert.match(result.stderr, /new plan needs a State line/, line);
    }
  });
  test('warns (but allows) a plan without the model-date name', () => {
    const result = pathspecCommit(sandbox(), { 'docs/plans/queue-view.md': plan('> **State:** draft, 2026-11-04.') });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /name it <model>-<YYYY-MM-DD>-<slug>\.md/);
  });
  test('editing an existing plan never trips the gate, an old Status line included', () => {
    const box = sandbox();
    // A plan from before K2: committed with no hooks, as history holds it.
    box.write('docs/plans/old.md', plan('Status: draft 2026-11-04'));
    box.git(['add', '--', 'docs/plans/old.md']);
    assert.equal(box.git(['-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', MSG, '--', 'docs/plans/old.md']).status, 0);
    const result = pathspecCommit(box, { 'docs/plans/old.md': plan('Status: agreed somewhere'), 'note.txt': 'n\n' });
    assert.equal(result.status, 0, result.stderr);
  });
  test('a pathspec commit judges only its own new plan, not one staged beside it', () => {
    const box = sandbox();
    box.write('docs/plans/opus-2026-11-04-theirs.md', plan('no state yet'));
    box.git(['add', '--', 'docs/plans/opus-2026-11-04-theirs.md']);
    const result = pathspecCommit(box, { 'docs/plans/opus-2026-11-04-mine.md': plan('> **State:** ready for review, 2026-11-07.') });
    assert.equal(result.status, 0, result.stderr);
  });
});

// K2 keeps the other index gates exactly as they were: D25's journal,
// the staged asks and the 72-column advisory, under pathspec commits.
describe('plan gate neighbours under pathspec commits', () => {
  const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n') + '\n';
  test('a 30-line plan with no journal entry is refused (D25)', () => {
    const result = pathspecCommit(sandbox(), { 'docs/plans/opus-2026-11-04-a.md': plan('> **State:** draft, 2026-11-07.') + lines(30) }, { journal: false });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no journal entry staged/);
  });
  test('the same plan with its journal entry passes', () => {
    const result = pathspecCommit(sandbox(), { 'docs/plans/opus-2026-11-04-a.md': plan('> **State:** draft, 2026-11-07.') + lines(30) });
    assert.equal(result.status, 0, result.stderr);
  });
  test('a malformed staged ask is refused beside a good plan', (t) => {
    const box = sandbox();
    if (!box.git(['ls-files', '--others', '--', 'src/scripts/asks.mjs']).stdout.trim()) return t.skip('no ask tooling in this repo');
    const result = pathspecCommit(box, {
      'docs/plans/opus-2026-11-04-a.md': plan('> **State:** draft, 2026-11-07.'),
      'docs/tasks/asks/A1.md': '# A1\n\nno status, no ask\n',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /docs\/tasks\/asks\/A1\.md: no \*\*Ask:\*\* line[\s\S]*ask file breaks the rules/);
    const good = pathspecCommit(box, { 'docs/tasks/asks/A1.md': '# A1\n\n**Status:** open (2026-11-04)\n**Ask:** "queue view"\n' });
    assert.equal(good.status, 0, good.stderr);
  });
  test('prose past 72 columns in a new plan is advice, never a refusal', () => {
    const long = `${'word '.repeat(30).trim()}\n`;
    assert.equal(WIDTH, 72);
    assert.equal(findLong(long).length, 1, 'md-wrap still flags it');
    const result = pathspecCommit(sandbox(), { 'docs/plans/opus-2026-11-04-a.md': plan('> **State:** draft, 2026-11-07.') + long });
    assert.equal(result.status, 0, result.stderr);
  });
});
