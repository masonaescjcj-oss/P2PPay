// Browser test build: the web app plus the real server (server/src) running in the page.
//   npm run build:demo  →  dist-demo/
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Product name for the build (VITE_APP_NAME=AriaPay npm run build:demo); also fills %VITE_APP_NAME% in index.html.
process.env.VITE_APP_NAME ||= 'P2PPay'

const here = path.dirname(fileURLToPath(import.meta.url))
const shim = (f) => path.join(here, 'demo', 'shims', f)

export default defineConfig({
  root: path.join(here, 'demo'),
  base: './',
  publicDir: false,
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^node:crypto$/, replacement: shim('crypto.js') },
      { find: /^node:fs$/, replacement: shim('fs.js') },
      { find: /^node:path$/, replacement: shim('path.js') },
      { find: /^node:async_hooks$/, replacement: shim('async_hooks.js') },
      { find: /^express$/, replacement: shim('express.js') },
      { find: /^pg$/, replacement: shim('empty.js') },
      { find: /^web-push$/, replacement: shim('empty.js') },
      // one copy, resolved for the browser
      { find: /^@electric-sql\/pglite$/, replacement: path.join(here, 'node_modules/@electric-sql/pglite/dist/index.js') },
    ],
  },
  define: {
    __dirname: JSON.stringify('/app/server/src'),
  },
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  build: {
    outDir: path.join(here, 'dist-demo'),
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4000,
  },
})
