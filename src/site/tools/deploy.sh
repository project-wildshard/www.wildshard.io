#!/usr/bin/env bash
# Deploy the marketing site (MARKETING-SITE MS4, E465): by hand or from CI on a push to src/site/ (site-deploy.yml).
# Builds from a clean export of this folder at HEAD (nobody's half-finished files ship), then uploads the static output
# to the Cloudflare Worker `wildshard-www` (wrangler.jsonc; it left Vercel's `wildshard-site` on 2026-11-11, J271).
#
#   bash src/site/tools/deploy.sh                 # commit first: it ships HEAD, not the working tree
#   bash src/site/tools/deploy.sh --build-only    # build the export into src/site/dist and stop (no upload)
#
# The export holds only this folder (P1-W1): its pages, COPY.md, public/ and facts.json, the game's facts committed here.
# It is unpacked at tmp/site-deploy.XXXXXX, two levels below the repo root, so `vite` resolves from the root's
# node_modules and vite.config.ts's `../../scripts/vite-tmp.mjs` finds the root's scripts/ (d7acaff). CI runs it too
# (.github/workflows/site-deploy.yml, MS10) on every push that changes src/site/. There CLOUDFLARE_API_TOKEN is the credential; locally wrangler's own login is.
set -euo pipefail

site="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$site"
sha="$(git rev-parse --short HEAD)"
dirty="$(git status --porcelain -- . | grep -v '^??' || true)"
if [ -n "$dirty" ]; then
  echo "deploy-site: src/site/ has uncommitted edits; HEAD ($sha) ships without them:" >&2
  echo "$dirty" >&2
fi

repo="$(git rev-parse --show-toplevel)"
mkdir -p "$repo/tmp"
work="$(mktemp -d "$repo/tmp/site-deploy.XXXXXX")"
trap 'rm -rf "$work"' EXIT
git archive HEAD | tar -x -C "$work" # run from this folder, git archives only it, unprefixed
test -f "$work/index.html" || { echo "deploy-site: the export of HEAD holds no index.html" >&2; exit 1; }

echo "deploy-site: building $sha"
vite="$(cd "$work" && node -p "require('node:path').join(require('node:path').dirname(require.resolve('vite/package.json')), 'bin/vite.js')")"
(cd "$work" && SITE_BUILD_SHA="$sha" node "$vite" build --logLevel warn)

if [ "${1:-}" = "--build-only" ]; then
  rm -rf "$site/dist" && cp -R "$work/dist" "$site/dist"
  echo "deploy-site: built $sha into $site/dist (no upload)"
  exit 0
fi

# Upload to the Worker wildshard-www (wrangler.jsonc: static assets plus worker.ts), on Cloudflare since 2026-11-11
# (meta WWW-CLOUDFLARE-PLAN, J271). Locally wrangler's own login is the credential; CI passes CLOUDFLARE_API_TOKEN.
echo "deploy-site: uploading"
(cd "$repo" && SITE_DIR="$work" pnpm -s site:deploy:cf)

live="${SITE_LIVE:-https://wildshard.io}"
# Retry, uncached: the edge can serve the preceding version for a moment after the upload.
for _ in {1..12}; do
  build="$(curl -fsS -H 'Cache-Control: no-cache' "$live/version.json?t=$(date +%s)" | sed -E 's/.*"build":"([^"]+)".*/\1/' || true)"
  case "$build" in "$sha"*) echo "deploy-site: live at $live (build $build)"; exit 0 ;; esac
  sleep 5
done
echo "deploy-site: $live reports build $build, not $sha" >&2
exit 1
