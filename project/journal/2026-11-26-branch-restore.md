# Re-creating a deleted branch skips the push gate (opus-kit2, meta QA 11-25 row 113)

- Meta row 96 swept 12 branches by mistake, and putting them back on origin at their exact shas needed `--no-verify`:
  engine's and sharddev's pre-push run the full gate on any branch push, the old branches predate the lean move so the
  gate cannot pass, and `SKIP_CHECK` counts only when an outgoing commit names it, which a published commit cannot.
- `.githooks/branch-restore.mjs` (stamped; run-checks.mjs calls it after the delete-only skip): a push whose every line
  creates a non-main branch at a sha on the destination's advertised main, or at the sha
  `~/.cache/wildshard/deleted-branches.log` (`WS_BRANCH_LOG`) recorded for this repo and branch, sends no new code and
  skips the push lane. check-push's blob checks still run on it.
- `ALLOW_BRANCH_RESTORE=1` (J381) is the named hatch for a branch create the log missed. It covers only creates of
  non-main branches, and check-push does not ask an outgoing commit to name it there. A push to main never takes
  either path, and an update of an existing branch is no restore.
- The kit pre-push now exports `WS_PUSH_DESTINATION` (engine's already did) so the check asks the push's own
  destination, never another remote's tracking refs. Engine and sharddev keep their own run-checks.mjs and pre-push
  variants, so each took the same call by hand.
- Proof: `.githooks/branch-restore.test.mjs` (stamped, runs in every consumer's `.githooks/*.test.mjs`) drives real
  pushes against a gate that always fails: a logged-sha restore passes, a logged sha under another branch name, new
  work on a new branch, a main push at a logged sha or with the hatch, and a branch update with the hatch stay gated; a
  sha on main and the hatch on an unlogged create pass. The kit runs it on a stamped copy in
  `test/tooling/branch-restore.test.mjs`.
