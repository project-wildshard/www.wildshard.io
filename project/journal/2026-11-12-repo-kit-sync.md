# repo-kit sync

- Stamped the agent layer from repo-kit v2.2.0: the SubagentStop
  hook stops a finished lane's background shells and the processes
  in its worktree or tmp/<lane> (meta MULTI-AGENT-TOOLING MA11, RK-1).

- Stamped the agent layer from repo-kit v2.2.1: the SubagentStop
  cleanup hook defers while a lane waits on a quoted background
  command instead of killing it (meta RK-1).

- Synced repo-kit at 9c8e54b (15 files, 1807 lines):
  chore(kit): stamp land tool and plan worktrees.
