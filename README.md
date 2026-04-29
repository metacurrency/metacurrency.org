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

## Deploy (Cloudflare Pages)

1. Push the repo to GitHub.
2. In Cloudflare Pages, create a project from the repo with:
   - **Build command:** `npm run build`
   - **Build output directory:** `_site`
   - **Node version:** 20 or newer
3. The `_redirects` file is copied into the build output and is honored
   automatically by Cloudflare Pages.

GitHub Pages also works (via `actions/deploy-pages` pointing at `_site/`),
but `_redirects` is Cloudflare-specific — on GitHub Pages, legacy URLs would
need meta-refresh stubs instead.
