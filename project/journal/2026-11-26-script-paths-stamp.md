# The kit's moved-path guard, stamped

> Written by: Claude (opus-kit), 2026-11-26, meta QA 11-25 row 97.

repo-kit's script-paths guard (row 82, with row 91's moved-path check)
now runs in this repo's push lane, from the kit's run-checks.mjs and
gate-report.mjs, with an empty baseline so a new stray path refuses the
push. agent-sync's hook-script rule takes src/scripts/ and stops naming
the old scripts/ folder (repo-kit 0df7330).

Its finding: vercel-prune-check looked for the old scripts/prune-deployments.mjs; it now reads and checks src/scripts/.
