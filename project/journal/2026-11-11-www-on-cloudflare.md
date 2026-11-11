# The marketing site moves to Cloudflare Workers

- Jake, 2026-11-11 ~19:00 Cancún: "Can we move the marketing website to
  cloudflare instead of vercel to get www back online?" Vercel's spend
  cap had paused `wildshard-site`, and J271 says Vercel billing must
  not take things down. Meta WWW-CLOUDFLARE-PLAN holds the rows.
- `src/site/wrangler.jsonc` deploys the vite build as Workers static
  assets under the Worker `wildshard-www`. `worker.ts` is small: the
  www 308 to the apex (as Vercel did), the old cache headers, and the
  mp4s from R2.
- The trailer and loops were on Vercel Blob. One is 36 MB, past the
  25 MiB static-asset cap, so all 14 went to the private R2 bucket
  `wildshard-records` under `site/media/`; the Worker reads only that
  prefix, with ranges. `publish-media.ts` now uploads there through
  wrangler, and `@vercel/blob` is gone.
- CI deploys only once the repo has a `CLOUDFLARE_API_TOKEN` secret;
  until then `bash src/site/tools/deploy.sh` from a Mac.
