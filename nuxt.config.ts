import { cpSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-01',
  future: { compatibilityVersion: 4 },
  devtools: { enabled: true },

  modules: ['@nuxt/eslint'],

  css: ['~/assets/css/main.css'],

  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      exclude: ['pdfjs-dist'],
    },
  },

  app: {
    head: {
      htmlAttrs: { lang: 'de' },
      title: 'SARU',
      titleTemplate: '%s · SARU',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'System zur Archivierung von Reihen und Unterrichtsmaterialien' },
        { name: 'robots', content: 'noindex, nofollow' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
        },
      ],
      script: [
        {
          // Muss vor dem ersten Rendern laufen, sonst blitzt bei dunklem
          // Farbmodus kurz die helle Oberfläche auf.
          innerHTML: `(()=>{try{var m=localStorage.getItem('saru.farbmodus')||'system',p=localStorage.getItem('saru.farbdesign')||'indigo',d=m==='dunkel'||(m==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dunkel',d);document.documentElement.dataset.palette=p}catch(e){}})()`,
          tagPosition: 'head',
        },
      ],
    },
    pageTransition: { name: 'page', mode: 'out-in' },
  },

  runtimeConfig: {
    databaseUrl: '',
    sessionSecret: '',
    encryptionKey: '',
    uploadDir: './data/uploads',
    maxUploadBytes: '104857600',
    initialAdminEmail: '',
    initialAdminPassword: '',
    logLevel: 'info',
    trustProxy: 'false',
    public: {
      appName: 'SARU',
      appVersion: '1.0.0',
    },
  },

  nitro: {
    experimental: { asyncContext: true },
    // Native Bindings und pdf.js-Assets nicht in Server-Chunks bündeln –
    // sonst scheitern dlopen / cMap-/Font-/WASM-Pfade im Produktionsimage.
    externals: {
      external: [
        '@napi-rs/canvas',
        /^@napi-rs\/canvas-.*/,
        'pdfjs-dist',
        /^pdfjs-dist\/.*/,
      ],
      // NFT folgt dem dynamischen Fake-Worker-Import nicht – explizit listen.
      traceInclude: [
        'node_modules/@napi-rs/canvas/package.json',
        'node_modules/@napi-rs/canvas-linux-x64-gnu/package.json',
        'node_modules/@napi-rs/canvas-linux-arm64-gnu/package.json',
        'node_modules/pdfjs-dist/package.json',
        'node_modules/pdfjs-dist/legacy/build/pdf.mjs',
        'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      ],
    },
    hooks: {
      // Vollständiges pdfjs-dist (Worker, cmaps, Fonts, wasm) nach .output kopieren.
      // Globs in traceInclude reichen bei NFT oft nicht für dynamische Imports.
      compiled(nitro) {
        const src = join(nitro.options.rootDir, 'node_modules/pdfjs-dist')
        const dest = join(nitro.options.output.serverDir, 'node_modules/pdfjs-dist')
        if (!existsSync(src)) return
        cpSync(src, dest, { recursive: true })
      },
    },
  },

  typescript: {
    strict: true,
    typeCheck: false,
  },

  eslint: {
    config: { stylistic: false },
  },
})
