# Marketing site import

- Copied `site/` to `src/site/` and `site-deploy.yml` to
  `.github/workflows/` from Raynos/project-wildshard-singleplayer at
  3bd238492b, fresh history (J12). The root stays thin, so it lands
  under `src/`. The bytes are unchanged in this commit; lint and format
  skip `src/site/` until the next commits wire it in (D28).
