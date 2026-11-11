// AGENTS.md shape and edit rule (J241): each rule has a pass case and a
// refuse case, as pure functions and through real `git commit` /
// `git push` in sandbox repos. The last test lints this repo's own files.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEADING, MARKER, guard, guardMerge, isAiMessage, lintAgents, lintClaude } from './agents-md.mjs';
import { ENV, TRAILER, ok, roots, sandbox } from './test-helpers.mjs';

const HOOKS = dirname(fileURLToPath(import.meta.url));
const AI = ok('docs(agents): note the browser lane');
const HUMAN = 'docs(agents): rewrite my section\n\nJake gardening his rules.\n';
const human = { env: { SKIP_ATTRIB: '1' } };

/** A converted file: Jake's section, the marker, the agent section. */
const shaped = (top = 'Jake writes this part.', below = '- Commit by pathspec.') =>
  `# AGENTS.md\n\n${top}\n\n${MARKER}\n\n${HEADING}\n\n> Written by: Claude and Codex (agents).\n\n${below}\n`;
/** A file from before J241, the way the agents left it. */
const LEGACY = '# AGENTS.md\n\n> Written by: Claude\n\n## Version control\n\n- Commit early and often.\n- Push after each commit.\n';
/** The first conversion of LEGACY: the old body moves below the marker unchanged. */
const CONVERTED = `# AGENTS.md\n\n_Jake's section: empty until he writes it._\n\n${MARKER}\n\n${HEADING}\n\n${LEGACY.split('\n').slice(2).join('\n')}`;

describe('lint: AGENTS.md shape', () => {
  test('passes the J241 shape', () => {
    assert.deepEqual(lintAgents(shaped()), []);
    assert.deepEqual(lintAgents(CONVERTED), []);
  });
  test('refuses a missing file', () => {
    assert.match(lintAgents(null).join(), /AGENTS\.md is missing/);
  });
  test('refuses a file with no marker, quoting the line to add', () => {
    const [problem] = lintAgents(LEGACY);
    assert.match(problem, /no marker line/);
    assert.ok(problem.includes(MARKER));
  });
  test('refuses an altered marker and names its line', () => {
    const [problem] = lintAgents(shaped().replace('agents never edit', 'agents rarely edit'));
    assert.match(problem, /line 5 looks like the marker but is not exact/);
  });
  test('refuses the marker twice', () => {
    assert.match(lintAgents(shaped('Top.', MARKER)).join(), /marker line 2 times \(lines 5, 11\)/);
  });
  test('refuses an agent section without its heading', () => {
    assert.match(lintAgents(shaped().replace(HEADING, '## Notes')).join(), /line 7 .*must be "## Agent-written"/);
    assert.match(lintAgents(`# AGENTS.md\n\n${MARKER}\n\n`).join(), /ends at the marker/);
  });
  test('allows Jake\'s attribution above the marker and agents\' below it', () => {
    assert.deepEqual(lintAgents(shaped('> Written by: Jake')), []);
  });
  test('refuses agent attribution above the marker', () => {
    for (const line of ['> Written by: Claude', '> Written by: Codex', '> **Written by:** Claude and Codex', '- Written by: Claude', '*Written by: Codex*']) {
      const [problem] = lintAgents(shaped(line));
      assert.match(problem, /line 3 is above the marker but agent-attributed/, line);
      assert.match(problem, /Put it below the marker; Jake promotes it\./);
    }
  });
});

describe('lint: CLAUDE.md', () => {
  test('passes exactly @AGENTS.md, or no file', () => {
    assert.deepEqual(lintClaude('@AGENTS.md\n'), []);
    assert.deepEqual(lintClaude('@AGENTS.md'), []);
    assert.deepEqual(lintClaude(null), []);
  });
  test('refuses anything else', () => {
    assert.match(lintClaude('@AGENTS.md\n\nAlso: be nice.\n').join(), /exactly one line, "@AGENTS\.md"/);
    assert.equal(lintClaude('# Rules\n').length, 1);
  });
});

describe('guard: AI commits edit only below the marker', () => {
  test('reads the AI trailer, not comments or the commit -v diff', () => {
    assert.equal(isAiMessage(AI), true);
    assert.equal(isAiMessage(HUMAN), false);
    assert.equal(isAiMessage(`${HUMAN}# ------------------------ >8 ------------------------\n+${TRAILER}\n ${TRAILER}\n`), false);
    assert.equal(isAiMessage(`${HUMAN}# ${TRAILER}\n`), false);
  });
  test('refuses an AI commit that only changes the line endings of Jake\'s section', () => {
    const crlf = shaped().replace('Jake writes this part.\n', 'Jake writes this part.\r\n');
    assert.deepEqual(lintAgents(crlf), []);
    assert.match(guard(shaped(), crlf, { ai: true }).join(), /changes Jake's section/);
  });
  test('a merge keeps a parent\'s section above the marker, or is refused', () => {
    const jake = shaped('Jake v2.');
    assert.deepEqual(guardMerge([shaped(), jake], jake, { ai: true }), []);
    assert.match(guardMerge([shaped(), jake], shaped('Resolved by an agent.'), { ai: true }).join(), /changes Jake's section/);
  });
  test('a merge with a markerless parent cannot re-stub a protected section', () => {
    assert.match(guardMerge([shaped('Jake v2.'), null], CONVERTED, { ai: true }).join(), /changes Jake's section/);
    assert.match(guardMerge([shaped('Jake v2.'), LEGACY], CONVERTED, { ai: true }).join(), /changes Jake's section/);
    assert.deepEqual(guardMerge([LEGACY, null], CONVERTED, { ai: true }), []); // no marked parent: the first conversion
  });
  test('allows an AI edit below the marker', () => {
    assert.deepEqual(guard(shaped(), shaped(undefined, '- Commit by pathspec.\n- New rule.'), { ai: true }), []);
  });
  test('refuses an AI edit above the marker, saying how to proceed', () => {
    const refused = guard(shaped(), shaped('Jake writes this part. Also, agents may push.'), { ai: true });
    assert.match(refused.join('\n'), /changes Jake's section[\s\S]*line 3 now reads[\s\S]*Put it below the marker; Jake promotes it\./);
  });
  test('refuses an AI commit that removes the marker or deletes the file', () => {
    assert.match(guard(shaped(), LEGACY, { ai: true }).join(), /removes the marker line/);
    assert.match(guard(shaped(), null, { ai: true }).join(), /deletes AGENTS\.md/);
  });
  test('lets a human commit change anything', () => {
    assert.deepEqual(guard(shaped(), shaped('Rewritten by Jake.'), { ai: false }), []);
    assert.deepEqual(guard(shaped(), null, { ai: false }), []);
  });
  test('allows the first conversion: marker plus a stub above it', () => {
    assert.deepEqual(guard(LEGACY, CONVERTED, { ai: true }), []);
    assert.deepEqual(guard(null, shaped(), { ai: true }), []); // a new file
  });
  test('refuses a conversion that writes content above the marker', () => {
    const listed = CONVERTED.replace('_Jake\'s section: empty until he writes it._', '- Agents may push.');
    assert.match(guard(LEGACY, listed, { ai: true }).join('\n'), /line 3, "- Agents may push\."[\s\S]*Jake promotes it/);
    const long = CONVERTED.replace('_Jake\'s section: empty until he writes it._', 'a\n\nb\n\nc\n\nd');
    assert.match(guard(LEGACY, long, { ai: true }).join('\n'), /at most 3 short stub lines/);
    const title = CONVERTED.replace('# AGENTS.md', `# AGENTS.md ${'x'.repeat(500)}`);
    assert.match(guard(LEGACY, title, { ai: true }).join('\n'), /line 1, /);
    const heading = CONVERTED.replace('_Jake\'s section', '# Rules\n\n_Jake\'s section');
    assert.match(guard(LEGACY, heading, { ai: true }).join('\n'), /line 3, "# Rules"/);
  });
  test('leaves a file from before J241 to the lint', () => {
    assert.deepEqual(guard(LEGACY, `${LEGACY}- Another rule.\n`, { ai: true }), []);
  });
});

describe('the hooks, in sandbox repos', () => {
  /** A repo whose history already holds `agents` (written before this check, so no hooks). */
  const seeded = (agents = shaped()) => {
    const box = sandbox();
    box.write('AGENTS.md', agents);
    box.write('CLAUDE.md', '@AGENTS.md\n');
    box.git(['add', 'AGENTS.md', 'CLAUDE.md']);
    assert.equal(box.git(['commit', '-q', '--no-verify', '-m', HUMAN]).status, 0);
    return box;
  };

  test('commit: a well-shaped repo commits other files', () => {
    const result = seeded().commit({ 'a.txt': 'a\n' }, AI);
    assert.equal(result.status, 0, result.stderr);
  });
  test('commit: a broken shape is refused on any commit', () => {
    const box = seeded();
    const result = box.commit({ 'AGENTS.md': shaped().replace(HEADING, '## Notes') }, HUMAN, human);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /AGENTS\.md \/ CLAUDE\.md shape[\s\S]*must be "## Agent-written"/);
  });
  test('commit: a CLAUDE.md with more than @AGENTS.md is refused', () => {
    const result = seeded().commit({ 'CLAUDE.md': '@AGENTS.md\nExtra rules.\n' }, AI);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CLAUDE\.md must be exactly one line/);
  });
  test('commit: deleting AGENTS.md is refused', () => {
    const box = seeded();
    box.git(['rm', '-q', 'AGENTS.md']);
    const result = box.git(['commit', '-q', '-m', HUMAN], { SKIP_ATTRIB: '1' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /deletes AGENTS\.md/);
  });
  test('commit: an AI edit below the marker passes', () => {
    const result = seeded().commit({ 'AGENTS.md': shaped(undefined, '- Commit by pathspec.\n- Push after each commit.') }, AI);
    assert.equal(result.status, 0, result.stderr);
  });
  test('commit: an AI edit above the marker is refused, by pathspec commit too', () => {
    const box = seeded();
    const result = box.commit({ 'AGENTS.md': shaped('Agents may rewrite this.') }, AI);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /agents edit AGENTS\.md only below the marker[\s\S]*Put it below the marker; Jake promotes it\./);
    const pathspec = box.git(['commit', '-q', '-m', AI, '--', 'AGENTS.md']);
    assert.notEqual(pathspec.status, 0);
    assert.match(pathspec.stderr, /changes Jake's section/);
  });
  test('commit: a pathspec commit is judged by what it commits, not the shared index', () => {
    const box = seeded();
    box.write('AGENTS.md', shaped('Agents may rewrite this.'));
    box.git(['add', 'AGENTS.md']); // the shared index holds an above-marker edit…
    box.write('AGENTS.md', shaped(undefined, '- Below only.')); // …the commit takes the worktree's below-only one
    const below = box.git(['commit', '-q', '-m', AI, '--', 'AGENTS.md']);
    assert.equal(below.status, 0, below.stderr);
    box.write('AGENTS.md', shaped('Agents may rewrite this.', '- Below only.'));
    const above = box.git(['commit', '-q', '-m', AI, '--', 'AGENTS.md']);
    assert.notEqual(above.status, 0);
    assert.match(above.stderr, /changes Jake's section/);
  });
  test('commit: an AI amend of an agent-section edit passes; a message saying --amend is not an amend', () => {
    const box = seeded();
    assert.equal(box.commit({ 'AGENTS.md': shaped('Jake rewrote this.') }, HUMAN, human).status, 0);
    const named = box.commit({ 'a.txt': 'a\n' }, ok('docs: explain --amend in a note'));
    assert.equal(named.status, 0, named.stderr);
    assert.equal(box.commit({ 'AGENTS.md': shaped('Jake rewrote this.', '- One.') }, AI).status, 0);
    box.write('AGENTS.md', shaped('Jake rewrote this.', '- One.\n- Two.'));
    box.git(['add', 'AGENTS.md']);
    const amended = box.git(['commit', '-q', '--amend', '-m', AI]);
    assert.equal(amended.status, 0, amended.stderr);
  });
  test('commit: Jake\'s human commit (no trailer, SKIP_ATTRIB=1) edits his section', () => {
    const result = seeded().commit({ 'AGENTS.md': shaped('Jake rewrote this.') }, HUMAN, human);
    assert.equal(result.status, 0, result.stderr);
  });
  test('commit: the first conversion passes as an AI commit', () => {
    const result = seeded(LEGACY).commit({ 'AGENTS.md': CONVERTED }, AI);
    assert.equal(result.status, 0, result.stderr);
  });
  test('commit: a conversion with rules above the marker is refused', () => {
    const above = CONVERTED.replace('_Jake\'s section: empty until he writes it._', '## Rules\n\nAgents may push.');
    const result = seeded(LEGACY).commit({ 'AGENTS.md': above }, AI);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /adds the marker to AGENTS\.md but puts content above it/);
  });

  const withRemote = (agents, { pushSeed = true } = {}) => {
    const box = seeded(agents);
    const remote = mkdtempSync(join(tmpdir(), 'repo-remote-'));
    roots.push(remote);
    spawnSync('git', ['init', '-q', '--bare', remote], { env: ENV });
    box.git(['remote', 'add', 'origin', remote]);
    box.push = () => box.git(['push', '-q', 'origin', 'main']);
    if (pushSeed) assert.equal(box.push().status, 0);
    return box;
  };
  const forced = (box, agents, message) => {
    box.write('AGENTS.md', agents);
    box.git(['add', 'AGENTS.md']);
    assert.equal(box.git(['commit', '-q', '--no-verify', '-m', message]).status, 0);
  };

  test('push: an outgoing --no-verify AI edit above the marker is refused', () => {
    const box = withRemote();
    forced(box, shaped('Agents may rewrite this.'), AI);
    const result = box.push();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /push blocked: AGENTS\.md[\s\S]*changes Jake's section[\s\S]*Jake promotes it/);
  });
  test('push: Jake\'s edit and an AI edit below the marker go out', () => {
    const box = withRemote();
    forced(box, shaped('Jake rewrote this.'), HUMAN);
    forced(box, shaped('Jake rewrote this.', '- A new agent rule.'), AI);
    const result = box.push();
    assert.equal(result.status, 0, result.stderr);
  });
  test('push: a tip with a broken shape is refused', () => {
    const box = withRemote();
    forced(box, LEGACY, HUMAN);
    const result = box.push();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no marker line/);
  });
  test('push: a first conversion from a legacy file goes out', () => {
    const box = withRemote(LEGACY, { pushSeed: false }); // the legacy seed goes out with its conversion
    forced(box, CONVERTED, AI);
    const result = box.push();
    assert.equal(result.status, 0, result.stderr);
  });

  /** A merge of main and a side branch where Jake edited his section, with `agents` as its result. */
  const merged = (box, agents, message) => {
    const base = box.git(['rev-parse', 'HEAD']).stdout.trim();
    forced(box, shaped('Jake v2.'), HUMAN);
    const side = box.git(['rev-parse', 'HEAD']).stdout.trim();
    box.git(['reset', '-q', '--hard', base]);
    forced(box, shaped(undefined, '- Main moved on.'), AI);
    box.write('AGENTS.md', agents);
    box.git(['add', 'AGENTS.md']);
    const tree = box.git(['write-tree']).stdout.trim();
    const merge = box.git(['commit-tree', tree, '-p', 'HEAD', '-p', side, '-m', message]).stdout.trim();
    box.git(['update-ref', 'refs/heads/main', merge]);
  };
  test('push: an AI merge that keeps Jake\'s side goes out', () => {
    const box = withRemote();
    merged(box, shaped('Jake v2.', '- Main moved on.'), AI);
    const result = box.push();
    assert.equal(result.status, 0, result.stderr);
  });
  test('push: an AI merge that writes new text above the marker is refused', () => {
    const box = withRemote();
    merged(box, shaped('Resolved by an agent.', '- Main moved on.'), AI);
    const result = box.push();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /changes Jake's section/);
  });
  test('push: an amend that relabels Jake\'s commit as an AI commit is refused', () => {
    const box = withRemote();
    assert.equal(box.commit({ 'AGENTS.md': shaped('Jake rewrote this.') }, HUMAN, human).status, 0);
    box.git(['commit', '-q', '--amend', '-m', AI]); // the commit hook cannot see the replaced commit…
    const result = box.push(); // …so pre-push judges it against its real parent
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /changes Jake's section/);
  });

  /** Side branch with Jake's edit above the marker, main with `mainTop` above it; leaves main checked out. */
  const branched = (box, mainTop) => {
    box.git(['checkout', '-q', '-b', 'side']);
    forced(box, shaped('Jake v2.'), HUMAN);
    box.git(['checkout', '-q', 'main']);
    forced(box, shaped(mainTop, '- Main moved on.'), mainTop === undefined ? AI : HUMAN);
  };
  test('commit: a real AI merge that takes Jake\'s side passes', () => {
    const box = seeded();
    branched(box);
    const result = box.git(['merge', '-q', '--no-ff', 'side', '-m', AI]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(box.git(['show', 'HEAD:AGENTS.md']).stdout, /Jake v2\.[\s\S]*Main moved on/);
  });
  test('commit: an AI conflict resolution that writes new text above the marker is refused', () => {
    const box = seeded();
    branched(box, 'Jake v3.');
    assert.notEqual(box.git(['merge', '-q', 'side', '-m', AI]).status, 0); // conflict
    box.write('AGENTS.md', shaped('Resolved by an agent.', '- Main moved on.'));
    box.git(['add', 'AGENTS.md']);
    const invented = box.git(['commit', '-q', '-m', AI]);
    assert.notEqual(invented.status, 0);
    assert.match(invented.stderr, /changes Jake's section/);
    box.write('AGENTS.md', shaped('Jake v2.', '- Main moved on.'));
    box.git(['add', 'AGENTS.md']);
    const kept = box.git(['commit', '-q', '-m', AI]);
    assert.equal(kept.status, 0, kept.stderr);
  });
  test('push: a tip whose ours-merge dropped AGENTS.md from history is not a bootstrap', () => {
    const box = sandbox();
    box.write('a.txt', 'a\n');
    box.git(['add', 'a.txt']);
    box.git(['commit', '-q', '--no-verify', '-m', HUMAN]);
    box.git(['checkout', '-q', '-b', 'side']);
    forced(box, shaped(), HUMAN);
    box.git(['checkout', '-q', 'main']);
    assert.equal(box.git(['merge', '-q', '-s', 'ours', '--no-verify', 'side', '-m', HUMAN]).status, 0);
    const remote = mkdtempSync(join(tmpdir(), 'repo-remote-'));
    roots.push(remote);
    spawnSync('git', ['init', '-q', '--bare', remote], { env: ENV });
    box.git(['remote', 'add', 'origin', remote]);
    const result = box.git(['push', '-q', 'origin', 'main']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /This push deletes AGENTS\.md/);
  });
  test('push: a new branch whose tip deleted AGENTS.md is refused; a tag of a good tip goes out', () => {
    const box = withRemote();
    box.git(['tag', '-a', 'v0.0.1', '-m', 'release']);
    const tagged = box.git(['push', '-q', 'origin', 'v0.0.1']);
    assert.equal(tagged.status, 0, tagged.stderr);
    box.git(['rm', '-q', 'AGENTS.md']);
    assert.equal(box.git(['commit', '-q', '--no-verify', '-m', HUMAN]).status, 0);
    const result = box.git(['push', '-q', 'origin', 'main:refs/heads/other']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /This push deletes AGENTS\.md/);
  });

  test('lint: the CLI refuses a repo with no AGENTS.md and passes a shaped one', () => {
    const empty = sandbox();
    const missing = spawnSync(process.execPath, ['.githooks/agents-md.mjs', 'lint'], { cwd: empty.root, encoding: 'utf8', env: ENV });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /AGENTS\.md is missing/);
    const box = seeded();
    const passed = spawnSync(process.execPath, ['.githooks/agents-md.mjs', 'lint'], { cwd: box.root, encoding: 'utf8', env: ENV });
    assert.equal(passed.status, 0, passed.stderr);
  });
});

describe('this repo', () => {
  test('its own AGENTS.md and CLAUDE.md have the J241 shape', () => {
    const result = spawnSync(process.execPath, [join(HOOKS, 'agents-md.mjs'), 'lint'], { cwd: join(HOOKS, '..'), encoding: 'utf8', env: ENV });
    assert.equal(result.status, 0, result.stderr);
  });
});
