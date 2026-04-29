#!/usr/bin/env node
// Extract clean page bodies + assets from the manual Wayback HTML capture.
//
// Reads from ../manual/<Page Title>.html (and matching _files/ directory)
// and writes:
//   src/<slug>.html       — page body wrapped in `layout: page.njk` frontmatter
//   src/assets/images/    — copied/renamed local images + fetched bg images

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, basename, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MANUAL = resolve(ROOT, "manual");
const SRC = resolve(ROOT, "src");
const IMG_OUT = resolve(SRC, "assets", "images");

mkdirSync(IMG_OUT, { recursive: true });

// Page table: source HTML (without .html) → target slug + nav title + permalink.
const PAGES = [
  {
    file: "Home - The MetaCurrency Project",
    slug: "index",
    title: "Home",
    permalink: "/",
    description: "Developing tools and platforms for open sourcing the next economy.",
  },
  {
    file: "Our Philosophy - The MetaCurrency Project",
    slug: "about",
    title: "Our Philosophy",
    permalink: "/about/",
    description: "Deep Wealth: the heart of a thrivable future.",
  },
  {
    file: "Our Team - The MetaCurrency Project",
    slug: "team",
    title: "Our Team",
    permalink: "/team/",
    description: "The MetaCurrency team.",
  },
  {
    file: "FAQ - The MetaCurrency Project",
    slug: "faq",
    title: "FAQ",
    permalink: "/faq/",
    description: "Frequently asked questions about open currencies.",
  },
  // Contact is hand-authored — see src/contact.html. The Wayback capture is
  // too sparse (one paragraph + four social icons in placeholder columns) to
  // be useful as a source. Excluded from extract so manual edits aren't
  // overwritten on re-runs.
];

// Slug map for internal Wayback links → local site routes.
const INTERNAL = {
  "/": "/",
  "/about/": "/about/",
  "/team/": "/team/",
  "/faq/": "/faq/",
  "/contact/": "/contact/",
  "/deep_wealth": "https://medium.com/metacurrency-project",
  "/deep_wealth/": "https://medium.com/metacurrency-project",
};

// ------------------------------------------------------------------
// URL helpers
// ------------------------------------------------------------------

const WAYBACK_RE =
  /^https?:\/\/web\.archive\.org\/web\/\d+(?:im_|cs_|js_)?\/(.+)$/i;

function unwrapWayback(u) {
  if (!u) return u;
  const m = u.match(WAYBACK_RE);
  return m ? m[1] : u;
}

function rewriteLinkHref(u) {
  if (!u) return u;
  // Anchor-only links and javascript: scheme — pass through.
  if (u.startsWith("#") || u.startsWith("javascript:") || u.startsWith("mailto:")) return u;
  const original = unwrapWayback(u);
  // Skip wayback-internal anchors
  if (/^https?:\/\/web\.archive\.org\//i.test(original)) return null;
  if (/^https?:\/\/web-static\.archive\.org\//i.test(original)) return null;
  if (/^https?:\/\/wiki\.archiveteam\.org\//i.test(original)) return null;
  if (/^https?:\/\/archive\.org\//i.test(original)) return null;
  try {
    const url = new URL(original);
    const host = url.host.replace(/^www\./, "");
    if (host === "metacurrency.org") {
      const path = url.pathname;
      const hash = url.hash || "";
      const search = url.search || "";
      // Known page (or explicit override like /deep_wealth → external).
      if (INTERNAL[path] !== undefined) {
        const target = INTERNAL[path];
        // External overrides drop the hash; internal pages keep it.
        if (/^https?:\/\//.test(target)) return target;
        return target + search + hash;
      }
      // Unknown metacurrency.org URL but it's a same-page anchor (the
      // pathname matches one of our known pages with a fragment).
      if (hash) {
        // Best effort: drop the path, keep the hash so on-page TOCs work.
        return hash;
      }
      // Unknown page, no hash — collapse to home.
      return "/";
    }
  } catch {
    /* not a URL — leave alone */
  }
  return original;
}

// ------------------------------------------------------------------
// Asset helpers
// ------------------------------------------------------------------

const copiedAssets = new Set();
const fetchedAssets = new Map(); // original URL → local filename

// Fallbacks for local _files images that the manual save missed but we have
// substitutes for (e.g. github.png never downloaded by the browser).
const ASSET_FALLBACKS = {
  "github.png": "github.svg",
};

function copyLocalAsset(srcRelPath, sourceDir) {
  // srcRelPath like: ./Home - The MetaCurrency Project_files/foo.png
  const cleaned = srcRelPath.replace(/^\.\//, "");
  const abs = resolve(sourceDir, cleaned);
  const fname = basename(cleaned);
  if (!existsSync(abs)) {
    const fallback = ASSET_FALLBACKS[fname];
    if (fallback && existsSync(join(IMG_OUT, fallback))) {
      console.warn(`  ! local asset missing: ${fname} → using ${fallback}`);
      return `/assets/images/${fallback}`;
    }
    console.warn(`  ! local asset missing: ${abs}`);
    return null;
  }
  const dest = join(IMG_OUT, fname);
  if (!copiedAssets.has(fname)) {
    copyFileSync(abs, dest);
    copiedAssets.add(fname);
  }
  return `/assets/images/${fname}`;
}

async function fetchAsset(url) {
  if (fetchedAssets.has(url)) return fetchedAssets.get(url);
  const original = unwrapWayback(url);
  let fname = basename(new URL(original, "https://x/").pathname).split("?")[0];
  if (!fname) fname = "asset";
  const dest = join(IMG_OUT, fname);
  // Idempotent: if file already exists on disk from a prior run, reuse it.
  if (existsSync(dest)) {
    const localUrl = `/assets/images/${fname}`;
    fetchedAssets.set(url, localUrl);
    console.log(`  cached ${fname}`);
    return localUrl;
  }
  console.log(`  fetch ${url}`);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "metacurrency-extract/0.1" },
      redirect: "follow",
    });
    if (!res.ok) {
      console.warn(`    ! HTTP ${res.status}`);
      fetchedAssets.set(url, null);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 64) {
      console.warn(`    ! tiny payload (${buf.length} bytes)`);
      fetchedAssets.set(url, null);
      return null;
    }
    writeFileSync(dest, buf);
    const localUrl = `/assets/images/${fname}`;
    fetchedAssets.set(url, localUrl);
    console.log(`    → ${localUrl} (${buf.length} bytes)`);
    return localUrl;
  } catch (e) {
    console.warn(`    ! fetch failed: ${e.message}`);
    fetchedAssets.set(url, null);
    return null;
  }
}

// ------------------------------------------------------------------
// Style attr rewriting (background-image: url(...))
// ------------------------------------------------------------------

async function rewriteStyleBackgrounds(styleStr) {
  // Match background[-image]: url("...") OR url(...) OR url('...')
  const re = /url\(\s*(?:&quot;|"|')?([^"'()]+)(?:&quot;|"|')?\s*\)/gi;
  const matches = [...styleStr.matchAll(re)];
  let out = styleStr;
  for (const m of matches) {
    const orig = m[1];
    const original = unwrapWayback(orig);
    let local = null;
    // Wayback im_ URL → fetch from same Wayback URL
    if (/^https?:\/\/web\.archive\.org\//i.test(orig)) {
      local = await fetchAsset(orig);
    } else if (/^https?:\/\//i.test(original)) {
      local = await fetchAsset(original);
    }
    if (local) {
      out = out.split(m[0]).join(`url("${local}")`);
    } else {
      // strip the broken background entirely
      out = out.replace(/background-image\s*:\s*[^;]+;?/gi, "");
    }
  }
  return out;
}

// ------------------------------------------------------------------
// Per-page post-processing hooks.
// Keyed by page slug. Run after generic rewrites, before serialization.
// ------------------------------------------------------------------

const POST_PROCESS = {
  // Home: drop the two project cards for organisations that no longer exist
  // (Coventina Foundation, The Commons Engine), then re-grid surviving cards
  // from 1/3 width (3 across) to 1/2 width (2 across) for 4 cards total.
  index($, $entry) {
    const dropHosts = ["coventina.org", "commonsengine.org"];
    $entry.find("div.x-column").each((_, col) => {
      const $col = $(col);
      const hrefs = $col
        .find("a[href]")
        .map((_, a) => $(a).attr("href") || "")
        .get();
      if (hrefs.some((h) => dropHosts.some((d) => h.includes(d)))) {
        $col.remove();
      }
    });
    // Collect surviving project-card columns (those containing .x-feature-box)
    // and merge them into a single grid container. The X Theme's float-based
    // x-column system gives clunky stacking when card count != row count;
    // a flex/grid wrapper is responsive without per-row management.
    const projectCols = $entry
      .find("div.x-column")
      .filter((_, col) => $(col).find(".x-feature-box").length > 0)
      .toArray();
    if (projectCols.length > 0) {
      const $grid = $('<div class="mc-project-grid"></div>');
      $(projectCols[0])
        .closest(".x-section")
        .find(".x-container")
        .filter((_, c) => $(c).find(".x-feature-box").length > 0)
        .each((i, c) => {
          if (i === 0) $(c).before($grid);
          $(c).remove();
        });
      for (const col of projectCols) {
        const $col = $(col);
        $col.removeClass("x-1-3 x-1-2 x-1-4").addClass("mc-project-card");
        $grid.append($col);
      }
    }
  },
};

// ------------------------------------------------------------------
// Per-page processing
// ------------------------------------------------------------------

async function processPage(page) {
  const htmlPath = resolve(MANUAL, `${page.file}.html`);
  const filesDir = resolve(MANUAL, `${page.file}_files`);
  console.log(`\n=== ${page.file} ===`);
  if (!existsSync(htmlPath)) {
    console.warn(`  ! missing ${htmlPath}`);
    return;
  }
  const html = readFileSync(htmlPath, "utf8");
  const $ = cheerio.load(html, { decodeEntities: false });

  // Drop Wayback-injected toolbar / banner / scripts before extraction.
  $("#wm-ipp-base, #wm-ipp, #wm-ipp-print, #donato, .wb-autocomplete-suggestions").remove();
  $('script[src*="archive.org"], script[src*="web-static.archive.org"]').remove();
  $('link[rel="stylesheet"][href*="archive.org"]').remove();

  const $article = $('article[id^="post-"]').first();
  if (!$article.length) {
    console.warn("  ! no <article id=post-N>");
    return;
  }
  const $entry = $article.find(".entry-content").first();
  if (!$entry.length) {
    console.warn("  ! no .entry-content");
    return;
  }

  // Drop comment forms / sharing widgets if present.
  $entry.find(".sharedaddy, .jp-relatedposts, #respond, #comments, .x-comments-area").remove();

  // 1. Rewrite <img src> and <a href>.
  $entry.find("img").each((_, el) => {
    const $img = $(el);
    const src = $img.attr("src");
    if (!src) return;
    if (src.startsWith("./") || src.startsWith(`${page.file}_files`)) {
      const local = copyLocalAsset(src, MANUAL);
      if (local) $img.attr("src", local);
    } else {
      const unwrapped = unwrapWayback(src);
      // Skip Wayback toolbar etc.
      if (/^https?:\/\/(?:web-static\.archive\.org|archive\.org|wiki\.archiveteam\.org)\//i.test(unwrapped)) {
        $img.remove();
        return;
      }
      $img.attr("src", unwrapped);
    }
    // Drop srcset entirely — points to wayback gravatar etc., we don't fetch those.
    $img.removeAttr("srcset");
    $img.removeAttr("data-x-src");
    $img.removeAttr("data-x-srcset");
  });

  $entry.find("a[href]").each((_, el) => {
    const $a = $(el);
    const href = $a.attr("href");
    const rewritten = rewriteLinkHref(href);
    if (rewritten === null) {
      // unwrap the link
      $a.replaceWith($a.html() || "");
      return;
    }
    $a.attr("href", rewritten);
  });

  // 2. Rewrite inline style="background-image: url(...)"
  const styleEls = $entry.find("[style]").toArray();
  for (const el of styleEls) {
    const style = $(el).attr("style");
    if (!style || !/url\(/i.test(style)) continue;
    const rewritten = await rewriteStyleBackgrounds(style);
    $(el).attr("style", rewritten);
  }

  // 3. Strip data-x-* hook attributes that drove the original X Theme JS, but
  //    KEEP data-x-icon-* — those carry the Unicode glyph used by CSS
  //    `content: attr(data-x-icon-X)` to render FontAwesome icons.
  $entry.find("*").each((_, el) => {
    for (const name of Object.keys(el.attribs || {})) {
      if (name.startsWith("data-x-") && !name.startsWith("data-x-icon")) {
        $(el).removeAttr(name);
      }
    }
  });

  // 4. Rewrite iframes that point at locally-saved Wayback YouTube wrappers
  //    back to a real YouTube embed URL. Filename is the YouTube video id.
  $entry.find("iframe[src]").each((_, el) => {
    const $f = $(el);
    const src = $f.attr("src");
    const m = src && src.match(/\/([A-Za-z0-9_-]{6,})\.html(?:[?#].*)?$/);
    if (m && (src.startsWith("./") || src.includes("_files/"))) {
      $f.attr("src", `https://www.youtube.com/embed/${m[1]}`);
      $f.attr("loading", "lazy");
      $f.removeAttr("data-ruffle-polyfilled");
      $f.removeAttr("wmode");
    } else if (src) {
      const unwrapped = unwrapWayback(src);
      if (unwrapped !== src) $f.attr("src", unwrapped);
    }
  });

  // 5. Remove the cs-content id (it's used by X Theme JS).
  $entry.find("#cs-content").removeAttr("id").removeAttr("class").addClass("cs-content");

  // 6. Per-page post-process: tweaks that aren't worth doing in the source HTML.
  if (POST_PROCESS[page.slug]) POST_PROCESS[page.slug]($, $entry);

  const body = $entry.html().trim();

  const frontmatter = [
    "---",
    "layout: page.njk",
    `title: ${JSON.stringify(page.title)}`,
    `description: ${JSON.stringify(page.description)}`,
    `permalink: ${JSON.stringify(page.permalink)}`,
    `eleventyNavigation:`,
    `  key: ${JSON.stringify(page.title)}`,
    `  order: ${PAGES.indexOf(page) + 1}`,
    "---",
    "",
  ].join("\n");

  const outPath = resolve(SRC, `${page.slug}.html`);
  writeFileSync(outPath, frontmatter + body + "\n");
  console.log(`  wrote ${outPath} (${body.length} bytes)`);
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------

for (const p of PAGES) {
  await processPage(p);
}

// Copy a few site-chrome assets the page bodies don't reference (logo).
const CHROME_ASSETS = [
  ["Home - The MetaCurrency Project_files", "BlackMetaCurrency_Logo-01.png"],
];
for (const [dir, name] of CHROME_ASSETS) {
  const abs = resolve(MANUAL, dir, name);
  if (existsSync(abs)) {
    copyFileSync(abs, join(IMG_OUT, name));
    console.log(`chrome: ${name}`);
  } else {
    console.warn(`  ! chrome asset missing: ${abs}`);
  }
}

console.log(`\nDone. ${copiedAssets.size} local + ${[...fetchedAssets.values()].filter(Boolean).length} fetched assets.`);
