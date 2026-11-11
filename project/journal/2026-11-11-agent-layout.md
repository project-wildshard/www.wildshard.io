# One agent layout for Claude Code and Codex

Jake asked for every repo to work with both tools from one source.
This is meta MULTI-AGENT-TOOLING row MA6, the rollout after the
shard-nine-dragon pilot (`6c30b3f`), stamped from repo-kit `90c41f1`
with `node ../repo-kit/scripts/agent-sync.mjs --from ../repo-kit`.

Skills now live in `.agents/skills/`, where Codex reads them, and each
`.claude/skills/<name>` is a link to that directory. The hook scripts
moved to `.agents/hooks/`; they find the repo with git and read either
tool's hook input through `lib/payload.mjs`. `.agents/hooks.json`
declares the hooks once, and `scripts/agent-sync.mjs` writes Claude's
settings hooks and `.codex/hooks.json` from it.

`pnpm check` now runs `check:agent-sync`, `test:agent-hooks` (each
hook on recorded Claude and Codex payloads, plus shellcheck 0.11.0,
which CI installs by checksum) and `check:parity --strict`. The kit's
hook tests and `lib.mjs` take leftover `4e04b01`'s agent-layout hunks,
which find the scripts in either layout; the width-hook tests moved
from `md-wrap.test.mjs` into `.agents/hooks/test/`.

This checkout is trusted in `~/.codex/config.toml` (plan decision 2),
so Codex loads `.codex/hooks.json` here. A pathspec commit cannot turn
a tracked skill directory into a link, so the swap is staged in the
index and amended in whole.
The journal entry rides in that amend too, so D25's check sees it.

Later the same day: repo-kit `eb3db9e` took engine's plan-worktree
support into the kit's brief and herdr-peers (with two hook tests), so
this repo takes the kit's bytes again.
