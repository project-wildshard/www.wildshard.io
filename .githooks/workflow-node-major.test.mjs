// Meta QA 11-25 row 100 (engine row 95, 40b0442f4; J505): setup-node's `node-version-file: package.json` resolves
// engines `>=24.18.0 <27` to whatever Node the runner image cached, so engine ci 45754077050 ran 23 jobs on 24.22.3 and
// 3 on 26.13.1, and a Node 26 break showed on one shard by chance. Every setup-node step in a workflow or local action
// names one major: the root `.node-version` (the kit stamps 26), or a literal version on that same major. A range,
// `lts/*`, `latest` or no version at all leaves the major to the runner, and this test refuses it.
// Kit-owned: edit repo-kit's copy under files/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PIN_FILE = '.node-version';
/** A version that names its major: `26`, `26.13`, `v26.13.1`. No `x`, range, alias or expression. */
const FIXED = /^v?(\d+)(?:\.\d+){0,2}$/u;

/** Each setup-node step's text, by the line its `- ` item starts on. @param {string} text */
export function setupNodeSteps(text) {
  const lines = text.split('\n');
  /** @type {{ line: number, body: string }[]} */
  const steps = [];
  lines.forEach((row, at) => {
    if (!/uses:\s*actions\/setup-node@/u.test(row)) return;
    let start = at;
    while (start > 0 && !/^\s*- /u.test(lines[start] ?? '')) start -= 1;
    const indent = /^(\s*)- /u.exec(lines[start] ?? '')?.[1]?.length ?? 0;
    let end = start + 1;
    while (end < lines.length) {
      const next = lines[end] ?? '';
      if (next.trim() !== '' && next.length - next.trimStart().length <= indent) break;
      end += 1;
    }
    steps.push({ line: start + 1, body: lines.slice(start, end).join('\n') });
  });
  return steps;
}

/** The step's `with:` value for `key`, block or flow style, unquoted. @param {string} body @param {string} key */
function withValue(body, key) {
  const value = new RegExp(`(?:^|[\\s{,])${key}:\\s*([^,}\\n#]+)`, 'u').exec(body)?.[1]?.trim();
  return value?.replace(/^(['"])(.*)\1$/u, '$2');
}

/**
 * Why a setup-node step leaves the Node major open, or undefined when it names `major`.
 * @param {string} body @param {string} major
 * @param {(file: string) => string | undefined} readPin the text of a `node-version-file` the step names
 */
export function openMajor(body, major, readPin) {
  const version = withValue(body, 'node-version');
  const file = withValue(body, 'node-version-file');
  if (version === undefined && file === undefined) return 'names no node-version, so the runner image picks the Node';
  let named = version;
  if (version === undefined && file !== undefined) {
    // A second checkout of the repo (api-server's deploy reads candidate/.node-version) holds the same pin.
    if (file !== PIN_FILE && !file.endsWith(`/${PIN_FILE}`)) return `reads node-version-file ${file}; read ${PIN_FILE}, which names one major`;
    named = readPin(PIN_FILE)?.trim();
    if (named === undefined) return `reads ${file}, but ${PIN_FILE} is missing`;
  }
  const got = FIXED.exec(named ?? '')?.[1];
  if (got === undefined) return `node-version "${named}" is not one fixed version, so the runner's cache picks the major`;
  if (got !== major) return `node-version "${named}" is Node ${got}, not ${PIN_FILE}'s ${major}`;
  return undefined;
}

/** The repo's workflow files and local actions, from `root`. @param {string} root */
export function workflowFiles(root) {
  /** @type {string[]} */
  const files = [];
  const workflows = join(root, '.github/workflows');
  if (existsSync(workflows)) for (const name of readdirSync(workflows)) if (/\.ya?ml$/u.test(name)) files.push(`.github/workflows/${name}`);
  const actions = join(root, '.github/actions');
  if (existsSync(actions)) {
    for (const action of readdirSync(actions)) {
      for (const name of ['action.yml', 'action.yaml']) if (existsSync(join(actions, action, name))) files.push(`.github/actions/${action}/${name}`);
    }
  }
  return files;
}

/** Every setup-node step in `root` that leaves the major open, as `<file>:<line> <why>`. @param {string} root */
export function nodeMajorFindings(root) {
  const steps = workflowFiles(root).flatMap((file) => setupNodeSteps(readFileSync(join(root, file), 'utf8')).map((step) => ({ file, ...step })));
  if (steps.length === 0) return [];
  const pin = join(root, PIN_FILE);
  if (!existsSync(pin)) return [`${PIN_FILE} is missing: ${steps.length} setup-node step(s) need one Node major to read`];
  const major = readFileSync(pin, 'utf8').trim();
  /** @param {string} file */
  const read = (file) => (existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8') : undefined);
  /** @type {string[]} */
  const findings = [];
  if (!FIXED.test(major) || major.includes('.')) findings.push(`${PIN_FILE} holds "${major}", not one Node major`);
  for (const step of steps) {
    const why = openMajor(step.body, major, read);
    if (why !== undefined) findings.push(`${step.file}:${step.line} ${why}`);
  }
  const range = existsSync(join(root, 'package.json')) ? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))?.engines?.node : undefined;
  const [, low, high] = /^>=(\d+)\.\d+\.\d+ <(\d+)$/u.exec(String(range ?? '')) ?? [];
  if (low !== undefined && !(Number(low) <= Number(major) && Number(major) < Number(high))) findings.push(`engines.node "${range}" does not admit ${PIN_FILE}'s Node ${major}`);
  return findings;
}

test('every setup-node step names the one Node major in .node-version', () => {
  assert.deepEqual(nodeMajorFindings(process.cwd()), []);
});
