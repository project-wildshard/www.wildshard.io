# repo-kit sync

- Stamped the agent layer from repo-kit v2.2.0: the SubagentStop
  hook stops a finished lane's background shells and the processes
  in its worktree or tmp/<lane> (meta MULTI-AGENT-TOOLING MA11, RK-1).

- Stamped the agent layer from repo-kit v2.2.1: the SubagentStop
  cleanup hook defers while a lane waits on a quoted background
  command instead of killing it (meta RK-1).
