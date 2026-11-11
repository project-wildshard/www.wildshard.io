// Tests for src/scripts/md-wrap.mjs (72-column markdown prose). Its
// PostToolUse hook is tested in md-prose-width.test.mjs (.claude/hooks/)
// or, on the agent layout, .agents/hooks/test/hooks.test.mjs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WIDTH, breakable, findLong, reflow, width } from '../src/scripts/md-wrap.mjs';
import { ok, sandbox } from './test-helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const long = (words) => Array.from({ length: words }, (_, i) => `word${i}`).join(' ');
const fits = (text) => text.split('\n').every((line) => width(line) <= WIDTH || !breakable(line));

describe('md-wrap check', () => {
  test('flags long prose and list items', () => {
    assert.deepEqual(findLong(`# T\n\n${long(20)}\n\n- ${long(20)}\n`).map((f) => f.line), [3, 5]);
  });
  test('leaves fences, tables, headings, front matter and quotes alone', () => {
    const text = [
      '---', `description: ${long(20)}`, '---', `# ${long(20)}`, '```', long(20), '```',
      `| ${long(20)} |`, `> ${long(20)}`, `<p>${long(20)}</p>`,
    ].join('\n');
    assert.deepEqual(findLong(text), []);
  });
  test('exempts an overflow that cannot break: a URL or a code span', () => {
    assert.deepEqual(findLong(`- https://example.com/${'a'.repeat(80)}\n`), []);
    assert.deepEqual(findLong(`  \`git log --oneline --since=2026-11-04 origin/main -- docs/plans/x.md\`\n`), []);
  });
  test('reports only the requested lines', () => {
    assert.deepEqual(findLong(`${long(20)}\n${long(20)}\n`, new Set([2])).map((f) => f.line), [2]);
  });
});

describe('md-wrap reflow', () => {
  test('rewraps a long paragraph to fit, and is idempotent', () => {
    const out = reflow(`${long(40)}\n`);
    assert.ok(fits(out), out);
    assert.equal(out.replace(/\n/g, ' ').replace(/ +/g, ' ').trim(), long(40));
    assert.equal(reflow(out), out);
  });
  test('keeps list markers, checkboxes and their hanging indent', () => {
    const out = reflow(`- [ ] ${long(20)}\n1. ${long(20)}\n`);
    const lines = out.split('\n');
    assert.match(lines[0], /^- \[ \] word0/);
    assert.match(lines[1], /^ {6}\S/);
    assert.ok(lines.some((line) => /^1\. /.test(line)));
    assert.ok(lines.filter((line) => /^ {3}\S/.test(line)).length > 0);
    assert.ok(fits(out), out);
  });
  test('joins an item with its indented continuation, not the next item', () => {
    const out = reflow(`- ${long(14)}\n  more words here\n- next item\n`);
    assert.match(out, /more words here\n- next item\n$/);
  });
  test('leaves short paragraphs, code and tables untouched', () => {
    const text = `short line\nanother\n\n\`\`\`\n${long(30)}\n\`\`\`\n| ${long(30)} |\n`;
    assert.equal(reflow(text), text);
  });
  test('never splits an inline code span', () => {
    const out = reflow(`${long(9)} \`node .githooks/check-commit-message.mjs --with flags\` tail\n`);
    assert.ok(out.split('\n').some((line) => line.includes('`node .githooks/check-commit-message.mjs --with flags`')));
  });
});

describe('md-wrap CLI', () => {
  test('--check --new-only reports only lines added since HEAD', () => {
    const box = sandbox();
    box.commit({ 'doc.md': `${long(20)}\n` }, ok('docs: add doc'));
    writeFileSync(join(box.root, 'doc.md'), `${long(20)}\nshort\n${long(21)}\n`);
    const run = spawnSync(process.execPath, [join(ROOT, 'src/scripts/md-wrap.mjs'), '--check', '--new-only', 'doc.md'], { cwd: box.root, encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stdout, /doc\.md:3:/);
    assert.doesNotMatch(run.stdout, /doc\.md:1:/);
  });
});
