# npm for the website's format dependency

NP9 (codex-np9), from meta's NPM-PUBLISH plan: use the public npm
package under the existing format import name and document the npm SDK
install command (J315).

The reversible pin is 0.4.5, the first real registry release. It keeps
the site's 25-cell catalogue and 0.1 excerpt; newer format releases
change that catalogue. Refreshing facts changes only schemaPaths,
8604 to 8674. No placement or memory numbers move.

Validation: pnpm install, pnpm site:facts and pnpm check; the normal
commit and push hooks gate the change. The existing NP9 row carries
this coordinated work, so it needs no separate ask.
