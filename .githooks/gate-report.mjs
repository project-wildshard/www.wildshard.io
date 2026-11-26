// The gate's report of a failed job (meta QA 11-25 row 75). A `pnpm check` that fails in its last step prints thousands
// of passing lines first, and every reader that keeps a head (an agent's tool output, land's STOP cause, a release
// prepare's log) showed only passing tests: shard-format's refusing engine typecheck was found by rerunning the check
// by hand. So a long output goes whole to a log file, and the report is short and ends with the failure: an `X` line
// that names the failing step's own error (land's pushStopCause reads the first `X` line), the output's last lines
// and the hatch.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** An output this long or shorter prints whole. */
export const WHOLE = 60;
/** The last lines a longer output shows. */
export const TAIL = 40;
const STRIP = /\u001B\[[0-9;]*m/gu;
const FAILURE = /(?:^|\s)(?:error|ERR!?|ERR_[A-Z_]+|failed|FAIL|✖|not ok|Error:)(?:\s|:|\(|$)|error TS\d+|AssertionError|ELIFECYCLE/u;

/**
 * The line that names why a job failed: the last line in its output that reads as an error, else its last line.
 * @param {string} output @returns {string}
 */
export function failureLine(output) {
  const lines = output.replaceAll(STRIP, '').split('\n').map((line) => line.trim()).filter(Boolean);
  // A summary (`Found 2 errors`, `ℹ fail 1`) or the runner's exit line names no step; the error it counts does.
  const noise = (line) => /^(?:ℹ|#)\s/u.test(line) || /\bfail \d+\b/u.test(line) || /^ELIFECYCLE\b.*Command failed/u.test(line)
    || /^(?:Found\s+)?\d+\s+(?:errors?|failed|failures?)\b/u.test(line);
  return (lines.findLast((line) => FAILURE.test(line) && !noise(line)) ?? lines.at(-1) ?? '(no output)').slice(0, 240);
}

/**
 * The report of one failed job. A long output is written whole to `logPath` (when given) and only its tail is shown.
 * @param {{ name: string, output: string, logPath?: string, write?: (path: string, text: string) => void }} job
 * @returns {string}
 */
export function failureReport({ name, output, logPath, write = writeWhole }) {
  const text = output.trim();
  const lines = text.split('\n');
  const head = `  X pnpm ${name} failed: ${failureLine(text)}`;
  if (lines.length <= WHOLE) return `${head}\n${text.replace(/^/gmu, '    ')}`;
  let where = 'not saved';
  if (logPath !== undefined) {
    try {
      write(logPath, `${text}\n`);
      where = logPath;
    } catch (error) {
      where = `not saved: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  const tail = lines.slice(-TAIL).join('\n').replace(/^/gmu, '    ');
  return `${head}\n    … ${lines.length - TAIL} earlier lines (whole output: ${where}); the last ${TAIL}:\n${tail}`;
}

/** @param {string} path @param {string} text */
function writeWhole(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
