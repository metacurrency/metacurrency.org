# metacurrency.org

Static site for [metacurrency.org](https://metacurrency.org), built with
[Eleventy](https://www.11ty.dev/). Reconstructed from a manual Wayback Machine
download of the original WordPress / X Theme site.

## Layout

```
src/                 page sources, assets, and layouts
  _includes/         base.njk + page.njk Nunjucks layouts
  _data/             site.js (nav config), build.js (build year)
  assets/            css/, images/, fonts/ — copied verbatim to _site/assets/
  _redirects         Cloudflare Pages format; copied to _site/ root
  *.html             one file per page (frontmatter + body)
_site/               build output (gitignored)
```

## Develop

```bash
npm install
npm run dev          # http://localhost:8080, live reload
```

## Build

```bash
npm run build        # writes static site to _site/
```

`npm run clean` removes `_site/`. Build is fully static — no runtime JS or
server needed.

## Deploy (Cloudflare Workers)

Deployed as a **Workers** service (`metacurrency-web`) using Static Assets.
`wrangler.jsonc` declares `assets.directory = "./_site"`, so the build output
is served directly — there is no Worker script.

1. Push the repo to GitHub.
2. The connected Workers build (Workers & Pages → `metacurrency-web` → Settings
   → Build) runs:
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy` (default)
   - **Node version:** 20 or newer
3. The `_redirects` file is part of `_site/` and is honored automatically by
   Workers Static Assets.

CLI deploy (after `npm run build`): `npx wrangler deploy`.

GitHub Pages also works (via `actions/deploy-pages` pointing at `_site/`),
but `_redirects` is Cloudflare-specific — on GitHub Pages, legacy URLs would
need meta-refresh stubs instead.
