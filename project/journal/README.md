# Journal

A running log of what changed and why, so a cold pickup can resume.
A commit of 30+ changed lines stages an entry here (D25;
`.githooks/pre-commit` checks it; `SKIP_JOURNAL=1` skips it).

- One file per topic: `YYYY-MM-DD-<topic>.md` (e.g.
  `2026-11-04-asks.md`), named for the day the work started. Append
  to the bottom while that work goes on. Parallel branches then write
  different files and never conflict, which a shared daily file
  always did. (`2026-11-04.md` is the one older daily file.)
- Informal and short: a line or a few bullets per commit. What you
  did, why, anything surprising. No required fields.
- History only. Live state belongs in the plans' `Status:` lines.
