export const WORKTREES: '.worktrees';
export const WORKTREE_GLOB: string;
export function isWorktreePath(path: string): boolean;
export function worktreeWatchIgnored(root?: string): RegExp[];
