# Vercel deployment prune

- Meta VERCEL-SPEND-PLAN (Jake, 2026-11-11: storage pruner on all
  repos). The deploy workflow now runs `scripts/prune-deployments.mjs`
  after each deploy, for wildshard-site, keeping the newest two plus the
  live and aliased ones. The script and `scripts/vercel-prune-check.mjs`
  are copies from repo-kit `f6a55e0`; `pnpm check` runs the check, so a
  deploy workflow without the prune step goes red. Why: every deployment
  is a full copy billed as storage, the 1-day retention policy does not
  clear them, and singleplayer's 448ef9a dropped its prune silently.
