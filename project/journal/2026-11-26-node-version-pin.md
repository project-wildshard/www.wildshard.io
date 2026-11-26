# Every setup-node step reads one Node major

> Written by: Claude (opus-kit), 2026-11-26, meta QA 11-25 row 100.

setup-node read package.json's engines range, so the runner picked
whichever Node major it had cached. This repo now takes the kit's
`.node-version` (26) and every setup-node step reads it; the kit's
`.githooks/workflow-node-major.test.mjs` refuses a step that leaves
the major open, as engine's row 95 test does there.
