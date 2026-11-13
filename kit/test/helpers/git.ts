import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Real git in a throwaway directory. Tests never mock git.

// Git hooks export GIT_DIR, GIT_INDEX_FILE and friends; inheriting them
// would point every test command at the outer repo. Drop them all.
const INHERITED_ENV: NodeJS.ProcessEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]: readonly [string, string | undefined]): boolean =>
      !key.startsWith('GIT_'),
  ),
)

const GIT_ENV: NodeJS.ProcessEnv = {
  ...INHERITED_ENV,
  // Keep the developer's own git config out of tests.
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'www.wildshard.io test',
  GIT_AUTHOR_EMAIL: 'test@www.wildshard.io.invalid',
  GIT_COMMITTER_NAME: 'www.wildshard.io test',
  GIT_COMMITTER_EMAIL: 'test@www.wildshard.io.invalid',
  GIT_TERMINAL_PROMPT: '0',
}

export interface TempRepo {
  /** Absolute, symlink-resolved path of the main worktree. */
  readonly dir: string
  /** Runs git in `cwd` (default: the main worktree) and returns trimmed stdout. */
  readonly git: (args: readonly string[], cwd?: string) => string
  /** Writes files (path → contents) into `cwd`, stages them and commits. Returns the new HEAD sha. */
  readonly commit: (
    files: Readonly<Record<string, string>>,
    message: string,
    cwd?: string,
  ) => string
  /** Adds a linked worktree on a new branch, at `<root>/<name>`. Returns its path. */
  readonly addWorktree: (
    name: string,
    branch: string,
    startPoint?: string,
  ) => string
  /** Removes every directory this repo created. */
  readonly cleanup: () => void
}

export function createTempRepo(trunk = 'main'): TempRepo {
  const prefix = path.join(tmpdir(), 'www.wildshard.io-test-')
  const root = realpathSync(mkdtempSync(prefix))
  const dir = path.join(root, 'repo')
  mkdirSync(dir)

  const git = (args: readonly string[], cwd = dir): string =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: GIT_ENV,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()

  git(['init', '--quiet', `--initial-branch=${trunk}`])

  return {
    dir,
    git,
    commit(files, message, cwd = dir): string {
      for (const [file, contents] of Object.entries(files)) {
        const target = path.join(cwd, file)
        mkdirSync(path.dirname(target), { recursive: true })
        writeFileSync(target, contents)
      }
      git(['add', '--', ...Object.keys(files)], cwd)
      git(['commit', '--quiet', '--message', message], cwd)
      return git(['rev-parse', 'HEAD'], cwd)
    },
    addWorktree(name, branch, startPoint = 'HEAD'): string {
      const worktree = path.join(root, name)
      git(['worktree', 'add', '--quiet', '-b', branch, worktree, startPoint])
      return worktree
    },
    cleanup(): void {
      rmSync(root, { recursive: true, force: true })
    },
  }
}
