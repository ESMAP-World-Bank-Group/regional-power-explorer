import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// Public URL: https://designstudio.worldbank.org/regional-power-explorer/
// Vercel (which sets VERCEL=1 at build time) still deploys main at its domain
// root, regional-power-explorer.vercel.app, so it keeps building for '/'.
const BASE = process.env.VERCEL ? '/' : '/regional-power-explorer/'

// IIS config for the Design Studio server. Uses only built-in IIS features --
// no URL Rewrite module:
//  - staticContent: IIS refuses to serve extensions it has no MIME type for,
//    and .geojson isn't one of them. `remove` first so a server that already
//    maps an extension doesn't fail on a duplicate.
//  - .geojson goes out as application/json. Which types IIS compresses is set
//    server-wide (httpCompression can't be set here), and application/json is
//    the type a server compresses when it compresses data at all; the region
//    files shrink about 11x gzipped. The app parses them as JSON either way.
//  - assets/: a year's browser cache. Vite names every file there by its
//    content hash, so a changed file is a new URL. vercel.json does the same
//    on Vercel; without it each visit re-asks the server for every file.
// Ignored by any non-IIS server.
function iisConfig() {
  return {
    name: 'iis-web-config',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'web.config',
        source: `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <staticContent>
      <remove fileExtension=".geojson" />
      <mimeMap fileExtension=".geojson" mimeType="application/json" />
      <remove fileExtension=".json" />
      <mimeMap fileExtension=".json" mimeType="application/json" />
      <remove fileExtension=".woff2" />
      <mimeMap fileExtension=".woff2" mimeType="font/woff2" />
      <remove fileExtension=".pmtiles" />
      <mimeMap fileExtension=".pmtiles" mimeType="application/octet-stream" />
    </staticContent>
  </system.webServer>
  <location path="assets">
    <system.webServer>
      <staticContent>
        <clientCache cacheControlMode="UseMaxAge" cacheControlMaxAge="365.00:00:00" cacheControlCustom="public, immutable" />
      </staticContent>
    </system.webServer>
  </location>
</configuration>
`,
      })
    },
  }
}

// Every file under public/data, as `virtual:data-manifest`: lets the app skip
// requests for optional files a region or country doesn't have. See
// src/utils/dataGuard.js.
function dataManifest() {
  const ID = 'virtual:data-manifest'
  const dir = path.resolve('public/data')
  const list = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? list(path.join(d, e.name)) : [path.relative(dir, path.join(d, e.name)).split(path.sep).join('/')])
  return {
    name: 'data-manifest',
    resolveId: id => (id === ID ? '\0' + ID : null),
    load: id => (id === '\0' + ID ? `export default ${JSON.stringify(list(dir))}` : null),
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: BASE,
  plugins: [react(), iisConfig(), dataManifest()],
})
