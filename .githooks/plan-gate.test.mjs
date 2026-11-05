// The light plan gate in pre-commit: a NEW docs/plans/*.md needs a
// Status line that leads with a state (block) and a <model>-<date>-<slug>
// name (warn).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ok, sandbox } from './test-helpers.mjs';

const MSG = ok('docs(plans): add a plan');
const plan = (status) => `# Queue view\n\n${status}\n\n## Rows\n\n- [ ] build it\n`;

describe('plan gate', () => {
  test('accepts a new plan with a state and a model-date name', () => {
    const result = sandbox().commit({ 'docs/plans/opus-2026-11-04-queue-view.md': plan('Status: draft 2026-11-04: waits on Jake') }, MSG);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /name it/);
  });
  test('accepts the bold and backticked Status forms', () => {
    assert.equal(sandbox().commit({ 'docs/plans/opus-2026-11-04-a.md': plan('**Status:** `in progress` 2026-11-04') }, MSG).status, 0);
  });
  test('blocks a new plan with no state', () => {
    const result = sandbox().commit({ 'docs/plans/opus-2026-11-04-a.md': plan('Status: agreed in brainstorm') }, MSG);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /new plan needs a Status line[\s\S]*opus-2026-11-04-a\.md/);
  });
  test('blocks a new plan with no Status line at all', () => {
    assert.notEqual(sandbox().commit({ 'docs/plans/opus-2026-11-04-a.md': '# A\n\nbody\n' }, MSG).status, 0);
  });
  test('warns (but allows) a plan without the model-date name', () => {
    const result = sandbox().commit({ 'docs/plans/queue-view.md': plan('Status: draft 2026-11-04') }, MSG);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /name it <model>-<YYYY-MM-DD>-<slug>\.md/);
  });
  test('editing an existing plan never trips the gate', () => {
    const box = sandbox();
    box.commit({ 'docs/plans/old.md': plan('Status: draft 2026-11-04') }, MSG);
    const result = box.commit({ 'docs/plans/old.md': plan('Status: agreed somewhere'), 'note.txt': 'n\n' }, MSG);
    assert.equal(result.status, 0, result.stderr);
  });
});
