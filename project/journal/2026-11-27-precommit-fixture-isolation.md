# Give the alternate Git fixture its own temp folder

Stamp repo-kit 7e9e964052. Each parallel case uses its own
alternate Git store and worktree, and owns its cleanup.
