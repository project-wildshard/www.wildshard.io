#!/usr/bin/env bash
# Deploy the marketing site (MARKETING-SITE MS4, E465): by hand or from CI on a push to src/site/ (site-deploy.yml).
# Builds from a clean export of this folder at HEAD (nobody's half-finished files ship), then uploads the static output
# to the Vercel project `wildshard-site` (no Git link). Public from the first deploy (Jake, Q4).
#
#   bash src/site/tools/deploy.sh                 # commit first: it ships HEAD, not the working tree
#   bash src/site/tools/deploy.sh --build-only    # build the export into src/site/dist and stop (no upload)
#
# The export holds only this folder (P1-W1): its pages, COPY.md, public/ and facts.json, the game's facts committed here.
# It is unpacked under src/site/.deploy/ so `vite` resolves from the repo root's node_modules above it. CI runs it too
# (.github/workflows/site-deploy.yml, MS10) on every push that changes src/site/. There VERCEL_BUILD_TOKEN is the credential; locally the CLI's own login is.
set -euo pipefail

site="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$site"
sha="$(git rev-parse --short HEAD)"
dirty="$(git status --porcelain -- . | grep -v '^??' || true)"
if [ -n "$dirty" ]; then
  echo "deploy-site: src/site/ has uncommitted edits; HEAD ($sha) ships without them:" >&2
  echo "$dirty" >&2
fi

mkdir -p "$site/.deploy"
work="$(mktemp -d "$site/.deploy/build.XXXXXX")"
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

# Link the output folder to the project (ids are not secrets; the CLI's own login is the credential).
mkdir -p "$work/dist/.vercel"
cp vercel-project.json "$work/dist/.vercel/project.json"

echo "deploy-site: uploading"
deploy=(vercel deploy "$work/dist" --prod --yes --scope raynos-projects)
if [ -n "${VERCEL_BUILD_TOKEN:-}" ]; then deploy+=(--token "$VERCEL_BUILD_TOKEN"); fi
url="$("${deploy[@]}" | grep -Eo "https://[^ ]+vercel.app" | tail -1)" # the CLI's own errors stay visible
echo "deploy-site: $url"

live="https://wildshard-site.vercel.app"
# The production alias can briefly serve the preceding deployment after Vercel reports Ready: retry, uncached.
for _ in {1..12}; do
  build="$(curl -fsS -H 'Cache-Control: no-cache' "$live/version.json" | sed -E 's/.*"build":"([^"]+)".*/\1/' || true)"
  case "$build" in "$sha"*) echo "deploy-site: live at $live (build $build)"; exit 0 ;; esac
  sleep 5
done
echo "deploy-site: $live reports build $build, not $sha" >&2
exit 1
