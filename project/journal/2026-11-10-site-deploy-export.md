# The site deploy builds again

site-deploy had failed on every push since d7acaff (2026-11-09):
vite.config.ts imports `../../scripts/vite-tmp.mjs`, and deploy.sh built
its clean export under src/site/.deploy/build.X, where that path lands
in src/site/ instead of the repo root. wildshard.io stayed on f978875.

deploy.sh now unpacks the export at tmp/site-deploy.X: two levels below
the root, so the import resolves to the root's scripts/ and `vite` still
resolves from the root's node_modules. Scratch stays in the repo's
ignored tmp/, and the trap removes it.
