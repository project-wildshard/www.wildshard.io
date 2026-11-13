import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { TestContext } from 'node:test'

import { createTempRepo } from './git.ts'

import type { TempRepo } from './git.ts'

function setup(context: TestContext): TempRepo {
  const repo = createTempRepo()
  context.after((): void => {
    repo.cleanup()
  })
  return repo
}

describe('createTempRepo', (): void => {
  it('stays inside its own repo even when run from a git hook', (context: TestContext): void => {
    const repo = setup(context)

    assert.equal(repo.git(['rev-parse', '--show-toplevel']), repo.dir)
    assert.equal(repo.git(['config', 'core.bare']), 'false')
  })

  it('creates a repo with commits on the trunk branch', (context: TestContext): void => {
    const repo = setup(context)

    const sha = repo.commit({ 'README.md': 'hello\n' }, 'Initial commit')

    assert.match(sha, /^[0-9a-f]{40}$/u)
    assert.equal(repo.git(['branch', '--show-current']), 'main')
    assert.equal(repo.git(['log', '--format=%s']), 'Initial commit')
  })

  it('stacks branches across linked worktrees', (context: TestContext): void => {
    const repo = setup(context)
    const base = repo.commit({ 'a.txt': 'a\n' }, 'Base')
    const lower = repo.addWorktree('lower', 'layer-1')
    const lowerHead = repo.commit({ 'b.txt': 'b\n' }, 'Layer 1', lower)
    const upper = repo.addWorktree('upper', 'layer-2', 'layer-1')
    repo.commit({ 'c.txt': 'c\n' }, 'Layer 2', upper)

    const branches = repo
      .git(['worktree', 'list', '--porcelain'])
      .split('\n')
      .filter((line: string): boolean => line.startsWith('branch '))
    assert.deepEqual(branches, [
      'branch refs/heads/main',
      'branch refs/heads/layer-1',
      'branch refs/heads/layer-2',
    ])
    assert.equal(repo.git(['merge-base', 'main', 'layer-2']), base)
    assert.equal(repo.git(['merge-base', 'layer-1', 'layer-2']), lowerHead)
  })

  it('removes everything on cleanup', (context: TestContext): void => {
    const repo = setup(context)

    repo.cleanup()

    assert.equal(existsSync(repo.dir), false)
  })
})
