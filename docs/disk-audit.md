# Daily disk audit

> Written by: Codex

> **State:** active, 2026-11-15. REPO-DISK J358; agents own removal.

At the day's first agent audit, run:

    node scripts/disk-audit.mjs --root <repo> --root <another-repo>

The JSON lines list ended, live and unknown scratch and old keep-copies.
Save the report in your existing lane scratch folder. The helper only
reads; repeat it after an interrupted audit.

Review ended entries individually. Check the owner, current processes,
Git alternates and unpublished work before choosing an exact path.
Keep live entries. Unknown owners need investigation; age alone never
authorizes removal.

Before removing an audited Git worktree, run scripts/keep-copy.mjs
with that exact worktree. Verify its manifest, bundle, patch and archive.
A failed or incomplete copy means retain the source. For ordinary
scratch, keep its irreplaceable files in an explicitly owned destination
and verify the copy before manually removing the exact audited folder.
Never delete dependencies' borrowed Git object directories.

Review 14-day keep-copies with scripts/keep-copy-report.mjs. Inspect
them before manually removing a particular old capture. No helper purges
them.

After the audit, append one lane receipt naming what was reviewed,
copied, removed or retained. Record the disk change when anything
material was removed. No launchd task, SessionEnd hook or receipt
watcher removes other lanes' scratch (J358).
