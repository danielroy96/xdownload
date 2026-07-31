import { defineConfig } from 'vite'

// xDownload build config.
//
// Why this shape (see the migration plan):
//   • The whole point of the build is to bundle Vue from OUR OWN origin instead
//     of an unpinned unpkg CDN tag — that CDN was the site's single point of
//     failure (a blip or a breaking release = blank page = "site down").
//   • The app template lives IN THE DOM inside <div id="app"> (index.html) and
//     is compiled at runtime, exactly as the old vue.global.js build did. The
//     default `vue` npm entry is runtime-only (no compiler) and would render
//     nothing, so we alias `vue` to the esm-bundler build that ships the
//     compiler. This keeps the 1000-line template byte-for-byte — the
//     lowest-regression path (no SFC/render-function rewrite).
export default defineConfig({
  root: '.',
  // Served from the custom-domain root (https://xdownload.info/), so hashed
  // asset URLs must resolve at origin root. Do NOT use a relative base.
  base: '/',
  // Vite's default publicDir is `public/`, which used to be the app source dir.
  // Point it at `static/` so brand.css / robots.txt / sitemap.xml / ads.txt are
  // copied verbatim to dist/ root — their canonical URLs (/brand.css, /ads.txt —
  // AdSense + SEO depend on these exact paths) are never hashed or renamed.
  publicDir: 'static',
  resolve: {
    alias: {
      vue: 'vue/dist/vue.esm-bundler.js',
    },
  },
  build: {
    // The Worker serves this directory (wrangler.jsonc assets.directory).
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    rollupOptions: {
      // Multi-page: the Vue app + the static privacy page. privacy.html carries
      // no module script, so Vite just passes it through (rewriting any asset
      // refs) — keeping /privacy.html live for AdSense compliance.
      input: {
        main: 'index.html',
        privacy: 'privacy.html',
      },
    },
  },
})
